/**
 * Negative tests for the suite runner: `validateSuite` must catch broken task
 * fixtures. Builds throwaway suites in a private temp dir — deterministic, no
 * network, no fixtures committed to the repo. The last test validates the
 * committed suite in loop/suite/ so real checkers can't silently regress.
 */
import {afterAll, describe, expect, test} from "bun:test";
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {suiteRoot, validateSuite, type TaskCheckResult} from "./suite.ts";

const CLEANUPS: string[] = [];
afterAll(() => {
  for (const dir of CLEANUPS)
    rmSync(dir, {recursive: true, force: true});
});

function makeSuite(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-suite-test-"));
  CLEANUPS.push(root);
  mkdirSync(join(root, "suite"), {recursive: true});
  return root;
}

// A fully valid control task: ref/ has marker.txt, broken/ does not.
function addControlTask(root: string): void {
  const dir = join(root, "suite", "shell-control");
  mkdirSync(join(dir, "ref"), {recursive: true});
  mkdirSync(join(dir, "broken"), {recursive: true});
  writeFileSync(
    join(dir, "TASK.md"),
    "---\nname: shell-control\ndescription: control task that must pass validation\ntimeout_s: 120\n---\nBody.\n",
  );
  writeFileSync(join(dir, "ref", "marker.txt"), "present\n");
  writeFileSync(join(dir, "broken", "placeholder.txt"), "no marker here\n");
  const check = [
    "#!/usr/bin/env bun",
    'import {existsSync} from "node:fs";',
    "const ws = process.argv[2]!;",
    'if (!existsSync(ws + "/marker.txt")) {',
    '  console.log("FAIL: marker.txt missing");',
    "  process.exit(1);",
    "}",
    "",
  ].join("\n");
  writeFileSync(join(dir, "check.ts"), check);
  chmodSync(join(dir, "check.ts"), 0o755);
}

function failures(results: TaskCheckResult[]): string[] {
  return results.filter((r) => !r.ok).map((r) => r.name);
}

/**
 * Full report for a failing task: shape errors plus every failing checker run
 * with exit code, error and output tail. Returned as a string so it lands in
 * the expect() diff — a CI failure names the task and shows why it failed.
 */
function describeResult(r: TaskCheckResult): string {
  const lines = [`== ${r.name} [${r.category}]`];
  for (const err of r.shapeErrors) lines.push(`  shape: ${err}`);
  for (const [label, run] of [["ref", r.ref], ["broken", r.broken]] as const) {
    if (!run || run.ok)
      continue;
    const how = [
      run.exitCode !== null ? `exit ${run.exitCode}` : null,
      run.signal ? `signal ${run.signal}` : null,
      run.error,
    ].filter(Boolean).join(", ");
    lines.push(`  ${label}: FAIL (${how || "no run result"})`);
    for (const line of run.output.split("\n").slice(-10))
      lines.push(`    | ${line}`);
  }
  return lines.join("\n");
}

describe("suite validate negative fixtures", () => {
  test("flags a task with malformed frontmatter", () => {
    const root = makeSuite();
    addControlTask(root);
    const dir = join(root, "suite", "ts-bad-frontmatter");
    mkdirSync(join(dir, "ref"), {recursive: true});
    mkdirSync(join(dir, "broken"), {recursive: true});
    // No closing '---' delimiter.
    writeFileSync(
      join(dir, "TASK.md"),
      "---\nname: ts-bad-frontmatter\ndescription: broken task\ntimeout_s: 120\n",
    );
    writeFileSync(join(dir, "ref", "x.txt"), "x\n");
    writeFileSync(join(dir, "broken", "x.txt"), "x\n");
    const check = "#!/usr/bin/env bun\nprocess.exit(0);\n";
    writeFileSync(join(dir, "check.ts"), check);
    chmodSync(join(dir, "check.ts"), 0o755);

    const {ok, results} = validateSuite(join(root, "suite"));
    expect(ok).toBe(false);
    expect(failures(results)).toContain("ts-bad-frontmatter");
    expect(failures(results)).not.toContain("shell-control");
    const bad = results.find((r) => r.name === "ts-bad-frontmatter")!;
    expect(bad.shapeErrors.join(" ")).toContain("closing '---'");
  });

  test("flags a task with a non-executable check.ts", () => {
    const root = makeSuite();
    addControlTask(root);
    const dir = join(root, "suite", "jq-noexec-check");
    mkdirSync(join(dir, "ref"), {recursive: true});
    mkdirSync(join(dir, "broken"), {recursive: true});
    writeFileSync(
      join(dir, "TASK.md"),
      "---\nname: jq-noexec-check\ndescription: broken task\ntimeout_s: 60\n---\nBody.\n",
    );
    writeFileSync(join(dir, "ref", "x.txt"), "x\n");
    writeFileSync(join(dir, "broken", "x.txt"), "x\n");
    writeFileSync(join(dir, "check.ts"), "#!/usr/bin/env bun\nprocess.exit(0);\n");
    // No chmod: check.ts stays non-executable.

    const {ok, results} = validateSuite(join(root, "suite"));
    expect(ok).toBe(false);
    expect(failures(results)).toContain("jq-noexec-check");
    const bad = results.find((r) => r.name === "jq-noexec-check")!;
    expect(bad.shapeErrors.join(" ")).toContain("not executable");
  });

  test("flags a task whose broken fixture passes the checker", () => {
    const root = makeSuite();
    addControlTask(root);
    const dir = join(root, "suite", "git-never-fails");
    mkdirSync(join(dir, "ref"), {recursive: true});
    mkdirSync(join(dir, "broken"), {recursive: true});
    writeFileSync(
      join(dir, "TASK.md"),
      "---\nname: git-never-fails\ndescription: broken task\ntimeout_s: 120\n---\nBody.\n",
    );
    writeFileSync(join(dir, "ref", "x.txt"), "x\n");
    writeFileSync(join(dir, "broken", "x.txt"), "x\n");
    // Always exits 0: broken/ is not distinguished from ref/.
    const check = "#!/usr/bin/env bun\nprocess.exit(0);\n";
    writeFileSync(join(dir, "check.ts"), check);
    chmodSync(join(dir, "check.ts"), 0o755);

    const {ok, results} = validateSuite(join(root, "suite"));
    expect(ok).toBe(false);
    expect(failures(results)).toContain("git-never-fails");
    const bad = results.find((r) => r.name === "git-never-fails")!;
    expect(bad.broken?.error ?? "").toContain("non-zero exit on broken fixture");
  });

  test("flags a checker that mutates the workspace", () => {
    const root = makeSuite();
    addControlTask(root);
    const dir = join(root, "suite", "shell-writes-workspace");
    mkdirSync(join(dir, "ref"), {recursive: true});
    mkdirSync(join(dir, "broken"), {recursive: true});
    writeFileSync(
      join(dir, "TASK.md"),
      "---\nname: shell-writes-workspace\ndescription: broken task\ntimeout_s: 120\n---\nBody.\n",
    );
    writeFileSync(join(dir, "ref", "x.txt"), "x\n");
    writeFileSync(join(dir, "broken", "x.txt"), "x\n");
    // Writes a file into $1: the checker must be reported as mutating the workspace.
    const check = [
      "#!/usr/bin/env bun",
      'import {writeFileSync} from "node:fs";',
      "writeFileSync(process.argv[2]! + \"/out.txt\", \"mutated\\n\");",
      "",
    ].join("\n");
    writeFileSync(join(dir, "check.ts"), check);
    chmodSync(join(dir, "check.ts"), 0o755);

    const {ok, results} = validateSuite(join(root, "suite"));
    expect(ok).toBe(false);
    expect(failures(results)).toContain("shell-writes-workspace");
    const bad = results.find((r) => r.name === "shell-writes-workspace")!;
    expect(bad.ref?.mutated).toBe(true);
    expect(bad.ref?.error ?? "").toContain("modified the workspace");
  });

  test("flags a checker that exceeds the timeout", () => {
    const root = makeSuite();
    addControlTask(root);
    const dir = join(root, "suite", "shell-never-terminates");
    mkdirSync(join(dir, "ref"), {recursive: true});
    mkdirSync(join(dir, "broken"), {recursive: true});
    writeFileSync(
      join(dir, "TASK.md"),
      "---\nname: shell-never-terminates\ndescription: broken task\ntimeout_s: 120\n---\nBody.\n",
    );
    writeFileSync(join(dir, "ref", "x.txt"), "x\n");
    writeFileSync(join(dir, "broken", "x.txt"), "x\n");
    // Sleeps far longer than the injected timeout.
    const check = "#!/usr/bin/env bun\nawait Bun.sleep(30_000);\n";
    writeFileSync(join(dir, "check.ts"), check);
    chmodSync(join(dir, "check.ts"), 0o755);

    const {ok, results} = validateSuite(join(root, "suite"), {checkerTimeoutMs: 1_000});
    expect(ok).toBe(false);
    expect(failures(results)).toContain("shell-never-terminates");
    const bad = results.find((r) => r.name === "shell-never-terminates")!;
    expect(bad.ref?.error ?? "").toContain("timed out after 1s");
  });

  test("passes a valid suite unchanged", () => {
    const root = makeSuite();
    addControlTask(root);
    const {ok, results} = validateSuite(join(root, "suite"));
    expect(ok).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("shell-control");
  });

  test("the committed suite in loop/suite passes validation", () => {
    const {ok, results} = validateSuite(suiteRoot());
    // Guard against a silently empty suite: ok would be trivially true.
    expect(results.length).toBeGreaterThan(0);
    // On failure the received string is the full report (task name, shape
    // errors, failing checker runs with exit code and output tail) instead of
    // an opaque count.
    expect(results.filter((r) => !r.ok).map(describeResult).join("\n\n")).toBe("");
    expect(ok).toBe(true);
  }, 120_000);
});
