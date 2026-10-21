#!/usr/bin/env bun
/**
 * Unit tests for the probe runner's non-model paths: process-group kill
 * (timeout path), JSONL event parsing, frontmatter stripping, and the Step 12
 * provider-failure retry (one retry after a backoff, driven by a FAKE pi
 * binary via PI_BIN — no real model calls).
 *
 *   bun test loop/lib/probe.test.ts
 */
import {spawn} from "node:child_process";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, test} from "bun:test";
import {isProviderishFailure, killProcessGroup, nestedPiEnv, parseJsonlEvents, redact, runProbe, stripFrontmatter, type ProbeResult} from "./probe.ts";
import type {LoadedTask} from "./suite.ts";

/** True when the process group is still alive. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("nestedPiEnv (S8)", () => {
  test("sets PI_OFFLINE=1 by default and lets an explicit extra override it", () => {
    expect(nestedPiEnv().PI_OFFLINE).toBe("1");
    expect(nestedPiEnv({PI_OFFLINE: "0"}).PI_OFFLINE).toBe("0");
    // Extra vars pass through.
    expect(nestedPiEnv({PI_CODING_AGENT_DIR: "/tmp/sbx"}).PI_CODING_AGENT_DIR).toBe("/tmp/sbx");
  });
});

describe("killProcessGroup (timeout path)", () => {
  test("kills the child and its grandchildren", async () => {
    // The shell puts two sleeps in the same process group as grandchildren.
    const child = spawn("bash", ["-c", "sleep 60 & sleep 60 & wait"], {detached: true, stdio: "ignore"});
    await Bun.sleep(300); // let the shell fork the sleeps
    expect(groupAlive(child.pid!)).toBe(true);
    expect(killProcessGroup(child.pid!)).toBe(true);
    // The whole group (child + grandchildren) must be gone shortly after.
    await Bun.sleep(300);
    expect(groupAlive(child.pid!)).toBe(false);
  });

  test("returns false for a dead/nonexistent pid instead of throwing", () => {
    expect(killProcessGroup(999_999_999)).toBe(false);
  });
});

describe("parseJsonlEvents", () => {
  test("extracts assistant text and the LAST message_update usage", () => {
    const msg = (text: string, usage: object) => ({role: "assistant", content: [{type: "text", text}], usage});
    const raw = [
      {type: "session_header", id: "x"},
      // Streaming: cumulative message_update events, then one message_end per message.
      {type: "message_update", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_update", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_end", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_update", message: msg("line two", {input: 20, output: 9, cacheRead: 1, cacheWrite: 0, totalTokens: 30, cost: {input: 2, output: 4, cacheRead: 0.1, cacheWrite: 0, total: 6.1}})},
      {type: "message_end", message: msg("line two", {input: 20, output: 9, cacheRead: 1, cacheWrite: 0, totalTokens: 30, cost: {input: 2, output: 4, cacheRead: 0.1, cacheWrite: 0, total: 6.1}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed).toEqual({
      trajectoryLines: ["line one", "line two"],
      usage: {
        totalTokens: 30,
        cacheRead: 1,
        cacheWrite: 0,
        cost: {
          cacheRead: 0.1,
          cacheWrite: 0,
          input: 2,
          output: 4,
          total: 6.1,
        },
        input: 20,
        output: 9,
      },
    });
  });

  test("falls back to message_end usage and tolerates junk lines", () => {
    const raw = [
      "not json at all",
      JSON.stringify({type: "message_end", message: {role: "assistant", content: [{type: "text", text: "done"}], usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}}}),
    ].join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.trajectoryLines).toEqual(["done"]);
    expect(parsed.usage!.totalTokens).toBe(2);
  });

  test("ignores non-assistant messages and returns null usage when absent", () => {
    const parsed = parseJsonlEvents(JSON.stringify({type: "message_update", message: {role: "user", content: "hi"}}));
    expect(parsed.trajectoryLines).toEqual([]);
    expect(parsed.usage).toBeNull();
  });

  test("skips a message_end whose message is JSON null instead of throwing", () => {
    const raw = [
      {type: "message_end", message: null},
      {type: "message_update", message: null},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.trajectoryLines).toEqual([]);
    expect(parsed.usage).toBeNull();
  });

  test("a later message_end usage overwrites an earlier message_update usage", () => {
    const msg = (usage: object) => ({role: "assistant", content: [{type: "text", text: "hi"}], usage});
    const raw = [
      {type: "message_update", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
      {type: "message_end", message: msg({input: 2, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.usage!.totalTokens).toBe(20);
  });

  test("in fallback-only streams the LAST message_end usage wins", () => {
    const msg = (usage: object) => ({role: "assistant", content: [{type: "text", text: "hi"}], usage});
    const raw = [
      {type: "message_end", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
      {type: "message_end", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 22, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.usage!.totalTokens).toBe(22);
  });
});

describe("redact", () => {
  test("redacts sk- style API keys", () => {
    expect(redact("error with key sk-abc123DEF_-xyz456 at position 0")).toBe("error with key sk-*** at position 0");
  });

  test("redacts bearer tokens, case-insensitively", () => {
    expect(redact("Authorization: Bearer eyJhbGciOi.abc-123_x")).toBe("Authorization: Bearer ***");
  });

  test("redacts api_key assignments but keeps the key reference", () => {
    expect(redact('api_key = "supersecret123"')).toBe('api_key = "***"');
    expect(redact("apiKey: hunter2value")).toBe("apiKey: ***");
    expect(redact("api-key=abc123def")).toBe("api-key=***");
  });

  test("leaves ordinary text untouched", () => {
    expect(redact("plain stderr output with no secrets")).toBe("plain stderr output with no secrets");
  });
});

describe("stripFrontmatter", () => {
  test("strips the frontmatter and keeps the body", () => {
    const text = "---\nname: x\ntimeout_s: 10\n---\nDo the thing.\n";
    expect(stripFrontmatter(text)).toBe("Do the thing.");
  });

  test("returns the text untouched without frontmatter", () => {
    expect(stripFrontmatter("just a prompt")).toBe("just a prompt");
  });
});

// ---------------------------------------------------------------------------
// Step 12: provider-failure retry — one retry after a backoff, driven by a
// fake pi binary (PI_BIN) whose behavior per invocation is scripted in bash.
// The fake writes JSONL events when the scenario needs a "real" attempt; the
// checker is a trivial always-pass/always-fail script.

/** The JSONL event line the fake pi emits for a healthy attempt. */
const FAKE_EVENT = JSON.stringify({
  type: "message_end",
  message: {role: "assistant", content: [{type: "text", text: "done"}], usage: {input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}},
});

let retryRoot: string | null = null;

afterEach(() => {
  delete process.env.PI_BIN;
  delete process.env.FAKE_PI_MODE;
  delete process.env.FAKE_PI_COUNT_FILE;
  delete process.env.FAKE_PI_EVENT;
  if (retryRoot !== null) {
    rmSync(retryRoot, {recursive: true, force: true});
    retryRoot = null;
  }
});

/** Build a temp fixture: fake pi script, TASK.md, check.ts; wire PI_BIN. */
function setupRetryFixture(script: string, checkTs: string): {task: LoadedTask, wsDir: string, countFile: string} {
  retryRoot = mkdtempSync(join(tmpdir(), "hloop-probe-retry-"));
  const binPath = join(retryRoot, "fake-pi.sh");
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);
  const taskDir = join(retryRoot, "task");
  mkdirSync(taskDir, {recursive: true});
  writeFileSync(join(taskDir, "TASK.md"), "---\nname: retry-fixture\ndescription: retry fixture\ntimeout_s: 30\n---\nDo the thing.\n");
  const checkPath = join(taskDir, "check.ts");
  // Same style as real suite checkers: #!/usr/bin/env bun + a TS body. A
  // shebang is mandatory — Bun's spawnSync has no execvp /bin/sh ENOEXEC
  // fallback for shebang-less executables.
  writeFileSync(checkPath, `#!/usr/bin/env bun\n${checkTs}`);
  chmodSync(checkPath, 0o755);
  const countFile = join(retryRoot, "spawn-count");
  writeFileSync(countFile, "0");
  process.env.PI_BIN = binPath;
  const task: LoadedTask = {
    name: "retry-fixture",
    category: "retry",
    paths: {dir: taskDir, taskMd: join(taskDir, "TASK.md"), checkTs: checkPath, ref: join(taskDir, "ref"), broken: join(taskDir, "broken"), setupSh: null},
    meta: {name: "retry-fixture", description: "retry fixture", timeoutS: 30},
    shapeErrors: [],
  };
  return {task, wsDir: join(retryRoot, "ws"), countFile};
}

function spawnCount(countFile: string): number {
  return Number(readFileSync(countFile, "utf8").trim());
}

/** The fake pi: answers --version without counting, counts real invocations, behaves per $FAKE_PI_MODE. */
const FAKE_PI = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake-pi 1.0"; exit 0; fi
count_file="$FAKE_PI_COUNT_FILE"
n=$(($(cat "$count_file" 2>/dev/null || echo 0) + 1))
echo "$n" > "$count_file"
case "$FAKE_PI_MODE" in
  exit1)          exit 1 ;;                                   # provider-ish: non-zero, no output
  silent)         exit 0 ;;                                   # provider-ish: no events parsed
  fail-then-ok)   if [ "$n" = "1" ]; then exit 1; fi
                  echo "$FAKE_PI_EVENT"; exit 0 ;;
  silent-then-ok) if [ "$n" = "1" ]; then exit 0; fi
                  echo "$FAKE_PI_EVENT"; exit 0 ;;
  ok)             echo "$FAKE_PI_EVENT"; exit 0 ;;            # healthy attempt
  ok-then-exit3)  if [ "$n" = "1" ]; then echo "$FAKE_PI_EVENT"; exit 3; fi
                  echo "$FAKE_PI_EVENT"; exit 0 ;;
  hang)           sleep 30; exit 0 ;;
  *)              echo "unknown FAKE_PI_MODE" >&2; exit 9 ;;
esac
`;

describe("runProbe provider-failure retry (Step 12)", () => {
  test("non-zero exit with empty trajectory on attempt 1 → exactly one retry after backoff, second attempt wins", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.FAKE_PI_MODE = "fail-then-ok";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    process.env.FAKE_PI_EVENT = FAKE_EVENT;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(2); // retried exactly once
    expect(result.exit).toBe(0);
    expect(result.checkerResult.pass).toBe(true);
    expect(result.usage?.totalTokens).toBe(10);
    expect(result.attemptedRetry).toBe(true);
    expect(result.firstError).toContain("first attempt: exit 1");
  });

  test("no events parsed (silent exit 0) → retried once; healthy second attempt recorded", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.FAKE_PI_MODE = "silent-then-ok";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    process.env.FAKE_PI_EVENT = FAKE_EVENT;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(2);
    expect(result.trajectory).toBe("done");
    expect(result.usage).not.toBeNull();
    expect(result.attemptedRetry).toBe(true);
    expect(result.firstError).toContain("first attempt: exit 0");
  });

  test("both attempts provider-fail → failure recorded with attemptedRetry + firstError", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.FAKE_PI_MODE = "exit1";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(2); // never more than one retry
    expect(result.exit).toBe(1);
    expect(result.trajectory).toBe("");
    expect(result.usage).toBeNull();
    expect(result.attemptedRetry).toBe(true);
    expect(result.firstError).toContain("first attempt: exit 1");
  });

  test("task timeout is deterministic → NO retry", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.FAKE_PI_MODE = "hang";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {timeoutS: 1, retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(1);
    expect(result.timedOut).toBe(true);
    expect(result.attemptedRetry).toBeUndefined();
  });

  test("checker failure against a real trajectory is deterministic → NO retry", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, 'console.error("checker says no");\nprocess.exit(1);\n');
    process.env.FAKE_PI_MODE = "ok";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    process.env.FAKE_PI_EVENT = FAKE_EVENT;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(1);
    expect(result.checkerResult.pass).toBe(false);
    expect(result.trajectory).toBe("done");
    expect(result.attemptedRetry).toBeUndefined();
  });

  test("non-zero exit WITH trajectory is a genuine task failure → NO retry", async () => {
    const {task, wsDir, countFile} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.FAKE_PI_MODE = "ok-then-exit3";
    process.env.FAKE_PI_COUNT_FILE = countFile;
    process.env.FAKE_PI_EVENT = FAKE_EVENT;
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(spawnCount(countFile)).toBe(1);
    expect(result.exit).toBe(3);
    expect(result.trajectory).toBe("done");
    expect(result.attemptedRetry).toBeUndefined();
  });

  test("setup errors (bad PI_BIN) are deterministic → NO retry", async () => {
    const {task, wsDir} = setupRetryFixture(FAKE_PI, "process.exit(0);\n");
    process.env.PI_BIN = join(retryRoot!, "no-such-pi");
    const result = await runProbe(task, join(retryRoot!, "sbx"), wsDir, {retryBackoffMs: 10});
    expect(result.exit).toBeNull();
    expect(result.stderrExcerpt).toContain("PI_BIN");
    expect(result.attemptedRetry).toBeUndefined();
  });

  test("isProviderishFailure classifies each shape", () => {
    const base: ProbeResult = {
      trajectory: "", usage: null, exit: 0, checkerResult: {pass: false, output: ""},
      piBinary: null, timedOut: false, stderrExcerpt: null, rawJsonlPath: null,
    };
    const usage = {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};
    expect(isProviderishFailure(base)).toBe(true); // no events parsed
    expect(isProviderishFailure({...base, exit: 1})).toBe(true); // non-zero, empty trajectory, no usage
    expect(isProviderishFailure({...base, exit: null})).toBe(true); // spawn error / signal, no usage
    expect(isProviderishFailure({...base, exit: null, usage})).toBe(false); // signal-killed WITH usage → real model work, NO retry
    expect(isProviderishFailure({...base, exit: 3, usage})).toBe(false); // non-zero exit WITH usage → NO retry
    expect(isProviderishFailure({...base, timedOut: true})).toBe(false); // deterministic timeout
    expect(isProviderishFailure({...base, trajectory: "did it", usage})).toBe(false);
    expect(isProviderishFailure({...base, exit: 3, trajectory: "did it"})).toBe(false); // real failure
  });
});
