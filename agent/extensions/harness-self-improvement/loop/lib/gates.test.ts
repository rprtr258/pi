#!/usr/bin/env bun
/**
 * Unit tests for the Step 9a code gate pipeline (gates.ts): gate-1 validation
 * (dynamic code.allow allowlist, test-file presence, node_modules presence),
 * sandbox staging of a candidate extension, gate ordering + timeouts for tsc /
 * bun test, extension load-error capture, and the per-candidate code.minWin
 * selection override.
 *
 *   bun test loop/lib/gates.test.ts
 */
import {existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {
  extensionHasTestFile,
  extensionValidationReasons,
  isExtensionPath,
  isMcpPath,
  loadErrorLines,
  mcpListFailure,
  mcpLoadErrorLines,
  mcpServerNames,
  runCodeGates,
  runCommand,
  runStartupProbe,
  scanProbeLoadErrors,
  selectionConfigForEdits,
  stageExtensionForSandbox,
  stageMcpForSandbox,
  touchedExtensionNames,
  MCP_STARTUP_PROBE_PROMPT,
  type CommandResult,
} from "./gates.ts";
import {validateCandidate, type ProposedEdit} from "./proposer.ts";
import type {SelectionConfig} from "./score.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

/** A real extension fixture that passes gate 1: index + test file + node_modules. */
function makeGatedExtension(agentDir: string, name = "sample-ext"): string {
  const extDir = join(agentDir, "extensions", name);
  mkdirSync(extDir, {recursive: true});
  writeFileSync(join(extDir, "index.ts"), "export default function (pi: unknown) { void pi; }\n");
  writeFileSync(join(extDir, "index.test.ts"), "import {test, expect} from \"bun:test\";\ntest(\"ok\", () => { expect(1).toBe(1); });\n");
  mkdirSync(join(extDir, "node_modules"), {recursive: true});
  return extDir;
}

describe("extensions-kind path routing", () => {
  test("isExtensionPath routes extensions/<name>/... only", () => {
    expect(isExtensionPath("extensions/sample/index.ts")).toBe(true);
    expect(isExtensionPath("extensions/sample/deep/nested.ts")).toBe(true);
    expect(isExtensionPath("AGENTS.md")).toBe(false);
    expect(isExtensionPath("extensions/sample")).toBe(false); // bare dir, no file below
    expect(isExtensionPath("extensions/.hidden/x.ts")).toBe(false);
    expect(isExtensionPath("extensions/-bad/x.ts")).toBe(false);
  });

  test("touchedExtensionNames extracts distinct names", () => {
    const edits: ProposedEdit[] = [
      {path: "extensions/a/index.ts", content: "x"},
      {path: "extensions/a/util.ts", content: "x"},
      {path: "extensions/b/index.ts", content: "x"},
      {path: "AGENTS.md", content: "x"},
    ];
    expect(touchedExtensionNames(edits)).toEqual(["a", "b"]);
    expect(touchedExtensionNames([{path: "AGENTS.md", content: "x"}] as ProposedEdit[])).toEqual([]);
  });
});

describe("gate 1: extensionValidationReasons", () => {
  test("non-allowlisted extension name rejected with reason", () => {
    const agentDir = tempDir("gates1a-");
    makeGatedExtension(agentDir, "allowed");
    const reasons = extensionValidationReasons([{path: "extensions/not-allowed/index.ts", content: "x"}], {agentDir, codeAllow: ["allowed"]});
    expect(reasons.some((r) => r.includes("not-allowed") && r.includes("code.allow"))).toBe(true);
  });

  test("empty code.allow rejects every extension", () => {
    const agentDir = tempDir("gates1b-");
    makeGatedExtension(agentDir);
    const reasons = extensionValidationReasons([{path: "extensions/sample-ext/index.ts", content: "x"}], {agentDir, codeAllow: []});
    expect(reasons.some((r) => r.includes("code.allow"))).toBe(true);
  });

  test("missing test file rejected with reason", () => {
    const agentDir = tempDir("gates1c-");
    const extDir = makeGatedExtension(agentDir);
    rmSync(join(extDir, "index.test.ts"));
    const reasons = extensionValidationReasons([{path: "extensions/sample-ext/index.ts", content: "x"}], {agentDir, codeAllow: ["sample-ext"]});
    expect(reasons.some((r) => r.includes("no test file"))).toBe(true);
  });

  test("test/ directory with a file counts as a test file", () => {
    const agentDir = tempDir("gates1d-");
    const extDir = makeGatedExtension(agentDir);
    rmSync(join(extDir, "index.test.ts"));
    mkdirSync(join(extDir, "test"));
    writeFileSync(join(extDir, "test", "unit.test.ts"), "ok\n");
    expect(extensionValidationReasons([{path: "extensions/sample-ext/index.ts", content: "x"}], {agentDir, codeAllow: ["sample-ext"]})).toEqual([]);
  });

  test("missing node_modules rejected with reason (loop never runs bun install)", () => {
    const agentDir = tempDir("gates1e-");
    const extDir = makeGatedExtension(agentDir);
    rmSync(join(extDir, "node_modules"), {recursive: true});
    const reasons = extensionValidationReasons([{path: "extensions/sample-ext/index.ts", content: "x"}], {agentDir, codeAllow: ["sample-ext"]});
    expect(reasons.some((r) => r.includes("node_modules") && r.includes("bun install"))).toBe(true);
  });

  test("a fully gated extension produces no reasons", () => {
    const agentDir = tempDir("gates1f-");
    makeGatedExtension(agentDir);
    expect(extensionValidationReasons([{path: "extensions/sample-ext/index.ts", content: "x"}], {agentDir, codeAllow: ["sample-ext"]})).toEqual([]);
  });

  test("non-extension edits are ignored by gate 1", () => {
    const reasons = extensionValidationReasons([{path: "AGENTS.md", content: "x"}], {agentDir: join(tempDir("gates1g-"), "missing"), codeAllow: []});
    expect(reasons).toEqual([]);
  });

  test("candidate deleting the LAST remaining test file is rejected (review fix)", () => {
    const agentDir = tempDir("gates1h-");
    makeGatedExtension(agentDir);
    const reasons = extensionValidationReasons([{path: "extensions/sample-ext/index.test.ts", content: null}], {agentDir, codeAllow: ["sample-ext"]});
    expect(reasons.some((r) => r.includes("deletes the last remaining test file"))).toBe(true);
    // A test/ directory file counts as a test file too — deleting it when it
    // is the last one is equally rejected.
    const agentDir2 = tempDir("gates1i-");
    const extDir2 = makeGatedExtension(agentDir2);
    rmSync(join(extDir2, "index.test.ts"));
    mkdirSync(join(extDir2, "test"));
    writeFileSync(join(extDir2, "test", "unit.test.ts"), "ok\n");
    const reasons2 = extensionValidationReasons([{path: "extensions/sample-ext/test/unit.test.ts", content: null}], {agentDir: agentDir2, codeAllow: ["sample-ext"]});
    expect(reasons2.some((r) => r.includes("deletes the last remaining test file"))).toBe(true);
  });

  test("deleting one of several test files is allowed; non-delete edits never trigger the check", () => {
    const agentDir = tempDir("gates1j-");
    const extDir = makeGatedExtension(agentDir);
    writeFileSync(join(extDir, "more.test.ts"), "ok\n");
    expect(extensionValidationReasons([{path: "extensions/sample-ext/index.test.ts", content: null}], {agentDir, codeAllow: ["sample-ext"]})).toEqual([]);
    // Rewriting (not deleting) a test file never triggers the last-test-file check.
    expect(extensionValidationReasons([{path: "extensions/sample-ext/index.test.ts", content: "ok\n"}], {agentDir, codeAllow: ["sample-ext"]})).toEqual([]);
  });
});

describe("gate 1 wired into validateCandidate (proposer pipeline)", () => {
  test("non-allowlisted ext name → candidate rejected with reason", () => {
    const agentDir = tempDir("vc-a-");
    makeGatedExtension(agentDir, "allowed");
    const reasons = validateCandidate([{path: "extensions/other/index.ts", content: "x"}], {extensionEnv: {agentDir, codeAllow: ["allowed"]}});
    expect(reasons.some((r) => r.includes("code.allow"))).toBe(true);
  });

  test("package.json edit rejected via the static registry validator", () => {
    const reasons = validateCandidate([{path: "extensions/allowed/package.json", content: "{}"}], {extensionEnv: {agentDir: tempDir("vc-b-"), codeAllow: ["allowed"]}});
    expect(reasons.some((r) => r.includes("package.json is never editable"))).toBe(true);
  });

  test("bun.lock edit rejected", () => {
    const reasons = validateCandidate([{path: "extensions/allowed/bun.lock", content: "{}"}], {extensionEnv: {agentDir: tempDir("vc-c-"), codeAllow: ["allowed"]}});
    expect(reasons.some((r) => r.includes("bun.lock is never editable"))).toBe(true);
  });

  test("node_modules edit rejected", () => {
    const reasons = validateCandidate([{path: "extensions/allowed/node_modules/pkg/index.js", content: "x"}], {extensionEnv: {agentDir: tempDir("vc-d-"), codeAllow: ["allowed"]}});
    expect(reasons.some((r) => r.includes("node_modules is never editable"))).toBe(true);
  });

  test("without extensionEnv, only the static checks run (gate 1 skipped)", () => {
    const reasons = validateCandidate([{path: "extensions/anything/index.ts", content: "x"}], {});
    expect(reasons).toEqual([]);
  });

  test("100KB cap applies to extension files (101KB rejected)", () => {
    const agentDir = tempDir("vc-e-");
    makeGatedExtension(agentDir, "allowed");
    const big = "x".repeat(101 * 1024);
    const reasons = validateCandidate([{path: "extensions/allowed/index.ts", content: big}], {extensionEnv: {agentDir, codeAllow: ["allowed"]}});
    expect(reasons.some((r) => r.includes("bytes (cap"))).toBe(true);
  });
});

describe("stageExtensionForSandbox", () => {
  test("copies real files, overlays candidate edits (write + delete), symlinks node_modules", () => {
    const agentDir = tempDir("stage-a-");
    const extDir = makeGatedExtension(agentDir);
    mkdirSync(join(extDir, "lib"), {recursive: true});
    writeFileSync(join(extDir, "lib", "util.ts"), "old\n");
    writeFileSync(join(extDir, "keep.txt"), "keep\n");
    const sandboxDir = tempDir("stage-sandbox-");
    const edits: ProposedEdit[] = [
      {path: "extensions/sample-ext/index.ts", content: "export default function (pi: unknown) { void pi; }\n// edited\n"},
      {path: "extensions/sample-ext/lib/util.ts", content: "new\n"},
      {path: "extensions/sample-ext/keep.txt", content: null},
    ];
    stageExtensionForSandbox(sandboxDir, agentDir, "sample-ext", edits);
    const sbExt = join(sandboxDir, "extensions", "sample-ext");
    expect(readFileSync(join(sbExt, "index.ts"), "utf8")).toContain("// edited");
    expect(readFileSync(join(sbExt, "index.test.ts"), "utf8")).toContain("bun:test"); // real file carried over
    expect(readFileSync(join(sbExt, "lib", "util.ts"), "utf8")).toBe("new\n");
    expect(existsSync(join(sbExt, "keep.txt"))).toBe(false); // delete applied
    expect(readlinkSync(join(sbExt, "node_modules"))).toBe(join(agentDir, "extensions", "sample-ext", "node_modules"));
  });

  test("throws when the real extension dir or node_modules is missing", () => {
    const agentDir = tempDir("stage-b-");
    expect(() => stageExtensionForSandbox(tempDir("stage-sb-"), agentDir, "ghost", [])).toThrow(/does not exist/);
    const extDir = makeGatedExtension(agentDir, "half");
    rmSync(join(extDir, "node_modules"), {recursive: true});
    expect(() => stageExtensionForSandbox(tempDir("stage-sb2-"), agentDir, "half", [])).toThrow(/does not exist/);
  });

  test("symlinked real node_modules is resolved to its realpath (read-only store replication)", () => {
    const agentDir = tempDir("stage-c-");
    const extDir = makeGatedExtension(agentDir, "linked");
    rmSync(join(extDir, "node_modules"), {recursive: true});
    const store = tempDir("stage-store-");
    symlinkSync(store, join(extDir, "node_modules"));
    const sandboxDir = tempDir("stage-sb3-");
    stageExtensionForSandbox(sandboxDir, agentDir, "linked", []);
    expect(readlinkSync(join(sandboxDir, "extensions", "linked", "node_modules"))).toBe(store);
  });
});

describe("gates 2+3: runCodeGates ordering", () => {
  const fakeCmd = (status: number, timedOut = false) => (): Promise<CommandResult> => Promise.resolve({status, stdout: "out\n", stderr: "err\n", timedOut});

  function recorder(results: Array<{status: number | null; timedOut?: boolean}>) {
    const calls: string[] = [];
    const run = async (args: string[]): Promise<CommandResult> => {
      calls.push(args.join(" "));
      const next = results[calls.length - 1] ?? {status: 0};
      return {status: next.status, stdout: `stdout-of ${args.join(" ")}\n`, stderr: "", timedOut: next.timedOut ?? false};
    };
    return {calls, run};
  }

  test("both gates pass → ok", async () => {
    const {calls, run} = recorder([{status: 0}, {status: 0}]);
    const sandbox = tempDir("gates23-a-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    const res = await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(res.ok).toBe(true);
    expect(res.failedGate).toBeNull();
    expect(calls).toEqual(["bunx tsc --noEmit", "bun test"]);
  });

  test("gate ordering: tsc fails → bun test NOT run, output captured", async () => {
    const {calls, run} = recorder([{status: 2}, {status: 0}]);
    const sandbox = tempDir("gates23-b-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    const res = await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedGate).toBe("tsc");
    expect(res.output).toContain("stdout-of bunx tsc --noEmit");
    expect(calls).toEqual(["bunx tsc --noEmit"]); // bun test never ran
  });

  test("bun test failure captured with the bun-test gate name", async () => {
    const {calls, run} = recorder([{status: 0}, {status: 1}]);
    const sandbox = tempDir("gates23-c-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    const res = await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedGate).toBe("bun-test");
    expect(calls).toEqual(["bunx tsc --noEmit", "bun test"]);
  });

  test("tsc timeout kills the gate and fails the candidate", async () => {
    const {calls, run} = recorder([{status: null, timedOut: true}]);
    const sandbox = tempDir("gates23-d-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    const res = await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedGate).toBe("tsc");
    expect(res.timedOut).toBe(true);
    expect(calls).toEqual(["bunx tsc --noEmit"]);
  });

  test("synthesizes a tsconfig.json into the sandbox copy only when absent", async () => {
    const {run} = recorder([{status: 0}, {status: 0}]);
    const sandbox = tempDir("gates23-e-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    const synthesized = readFileSync(join(sandbox, "extensions", "e", "tsconfig.json"), "utf8");
    expect(JSON.parse(synthesized).compilerOptions.noEmit).toBe(true);
    // An existing tsconfig.json is never overwritten.
    const sandbox2 = tempDir("gates23-f-");
    mkdirSync(join(sandbox2, "extensions", "e"), {recursive: true});
    writeFileSync(join(sandbox2, "extensions", "e", "tsconfig.json"), '{"compilerOptions":{}}\n');
    await runCodeGates(sandbox2, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(readFileSync(join(sandbox2, "extensions", "e", "tsconfig.json"), "utf8")).toBe('{"compilerOptions":{}}\n');
  });
});

describe("runCommand timeout kill", () => {
  test("a hanging command is killed at the timeout and reports timedOut", async () => {
    const started = Date.now();
    const res = await runCommand(["sleep", "30"], {cwd: tmpdir(), timeoutS: 1});
    const elapsedS = (Date.now() - started) / 1000;
    expect(res.timedOut).toBe(true);
    expect(res.status).toBeNull();
    expect(elapsedS).toBeLessThan(10); // killed, not waited out
  }, 20_000);

  test("a fast command reports its exit code and output", async () => {
    const res = await runCommand(["echo", "hello"], {cwd: tmpdir(), timeoutS: 10});
    expect(res.timedOut).toBe(false);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("hello");
  });
});

describe("gate 4: load-error capture", () => {
  // Empirical shape captured by staging a deliberately-broken extension in a
  // test sandbox (pi 1.3.0): stderr only, no JSONL, exit 1.
  const BROKEN_STDERR = [
    "",
    `Error: Failed to load extension "/tmp/sandbox/extensions/broken-ext/index.ts": Failed to load extension: ParseError: Missing semicolon.`,
    " /tmp/sandbox/extensions/broken-ext/index.ts:2:6",
    'Hint: Start without extensions using "pi -ne".',
    "",
  ].join("\n");

  test("captures the empirical failed-to-load shape", () => {
    const lines = loadErrorLines(BROKEN_STDERR, "broken-ext");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain("Failed to load extension");
    expect(lines[0]).toContain("extensions/broken-ext/");
  });

  test("ignores errors that do not mention the staged extension", () => {
    const raw = "Error: Failed to load extension \"/x/extensions/other/index.ts\": boom\nrandom model chatter\n";
    expect(loadErrorLines(raw, "staged-ext")).toEqual([]);
  });

  test("ignores benign mentions of the extension without error wording", () => {
    expect(loadErrorLines("loaded extensions/hello/index.ts just fine", "hello")).toEqual([]);
  });

  test("scanProbeLoadErrors reads ws/*.raw.jsonl and tasks/*.json stderrExcerpts", () => {
    const candDir = tempDir("gate4-");
    mkdirSync(join(candDir, "ws"), {recursive: true});
    mkdirSync(join(candDir, "tasks"), {recursive: true});
    writeFileSync(join(candDir, "ws", "t1.raw.jsonl"), `{"type":"message_end"}\n${BROKEN_STDERR.split("\n")[1]}\n`);
    writeFileSync(join(candDir, "tasks", "t1.json"), JSON.stringify({task: "t1", pass: false, stderrExcerpt: 'Error: Failed to load extension "/s/extensions/broken-ext/index.ts": x'}));
    writeFileSync(join(candDir, "tasks", "t2.json"), JSON.stringify({task: "t2", pass: true, stderrExcerpt: null}));
    const errs = scanProbeLoadErrors(candDir, "broken-ext");
    expect(errs.length).toBe(2);
    expect(errs[0]).toContain("broken-ext");
    // Deduped across sources.
    expect(new Set(errs).size).toBe(errs.length);
  });

  test("scanProbeLoadErrors is empty for a clean candidate dir", () => {
    const candDir = tempDir("gate4-clean-");
    expect(scanProbeLoadErrors(candDir, "anything")).toEqual([]);
  });
});

describe("gate 3: vacuous test-run semantics (empirical: bun 1.4.2 exits 1 on zero tests)", () => {
  // Empirical result (scratch dir, no test files): `bun test` prints
  // "No tests found!" and EXITS 1 — so gate 3's status !== 0 check already
  // fails a run with 0 tests collected. This test pins that semantics.
  test("a zero-tests bun run ('No tests found!', exit 1) fails the gate", async () => {
    const run = async (args: string[]): Promise<CommandResult> =>
      args[0] === "bunx"
        ? {status: 0, stdout: "", stderr: "", timedOut: false}
        : {status: 1, stdout: "No tests found!\n", stderr: "error: test run failed", timedOut: false};
    const sandbox = tempDir("gates23-vac-");
    mkdirSync(join(sandbox, "extensions", "e"), {recursive: true});
    const res = await runCodeGates(sandbox, "e", {runCmd: run, tscTimeoutS: 1, testTimeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedGate).toBe("bun-test");
    expect(res.output).toContain("No tests found!");
  });
});

describe("selection: code.minWin per-candidate override", () => {
  const base: SelectionConfig = {minWin: 1, minQualityGain: null, usageFactor: 1.5};

  test("candidate touching extensions/ gets code.minWin", () => {
    const cfg = selectionConfigForEdits([{path: "extensions/sample/index.ts", content: "x"}] as ProposedEdit[], base, 2);
    expect(cfg.minWin).toBe(2);
    expect(cfg.minQualityGain).toBeNull(); // rest unchanged
    expect(cfg.usageFactor).toBe(1.5);
  });

  test("non-code candidate keeps the global minWin", () => {
    expect(selectionConfigForEdits([{path: "AGENTS.md", content: "x"}] as ProposedEdit[], base, 2).minWin).toBe(1);
    expect(selectionConfigForEdits([{path: "skills/a/SKILL.md", content: "x"}] as ProposedEdit[], base, 2).minWin).toBe(1);
    // mcp.json is code-bearing too (Step 9b).
    expect(selectionConfigForEdits([{path: "mcp.json", content: "x"}] as ProposedEdit[], base, 2).minWin).toBe(2);
    expect(selectionConfigForEdits([{path: "AGENTS.md", content: "x"}, {path: "mcp.json", content: "x"}] as ProposedEdit[], base, 2).minWin).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Step 9b: mcp kind — staging, startup probe, mcp load-error capture

describe("mcp kind path routing + staging (Step 9b)", () => {
  test("isMcpPath routes mcp.json only", () => {
    expect(isMcpPath("mcp.json")).toBe(true);
    expect(isMcpPath("AGENTS.md")).toBe(false);
    expect(isMcpPath("extensions/x/index.ts")).toBe(false);
    expect(isMcpPath("mcp.json.bak")).toBe(false);
  });

  test("stageMcpForSandbox overlays the candidate content on the staged real copy", () => {
    const sandbox = tempDir("mcp-stage-a-");
    writeFileSync(join(sandbox, "mcp.json"), '{"mcpServers":{"real":{"command":"real"}}}\n');
    writeFileSync(join(sandbox, "AGENTS.md"), "unrelated\n");
    stageMcpForSandbox(sandbox, [
      {path: "AGENTS.md", content: "rewritten"},
      {path: "mcp.json", content: '{"mcpServers":{"candidate":{"command":"c"}}}'},
    ]);
    expect(readFileSync(join(sandbox, "mcp.json"), "utf8")).toContain("candidate");
    expect(readFileSync(join(sandbox, "AGENTS.md"), "utf8")).toBe("unrelated\n"); // non-mcp paths untouched here
  });
});

describe("mcpServerNames + mcpLoadErrorLines (Step 9b keyword scan)", () => {
  test("mcpServerNames extracts the mcpServers keys, tolerating junk", () => {
    expect(mcpServerNames('{"mcpServers":{"a":{"command":"x"},"b":{"url":"https://x"}}}')).toEqual(["a", "b"]);
    expect(mcpServerNames("{ not json")).toEqual([]);
    expect(mcpServerNames("{}")).toEqual([]);
  });

  test("catches a seeded broken server's stderr (mcp + server-name keywords)", () => {
    const raw = [
      "starting mcp servers…",
      'MCP server "broken-server" failed to connect: spawn /nonexistent/binary ENOENT',
      "model chatter without the keyword",
    ].join("\n");
    const lines = mcpLoadErrorLines(raw, ["broken-server"]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("failed to connect");
    expect(lines[0]).toContain("broken-server");
  });

  test("extends the 9a load-error scan: extension-shaped lines match via the mcp/server-name keywords, non-mcp errors do not", () => {
    // An extension load error that ALSO mentions the mcp layer (e.g. pi's
    // mcp extension failing) is caught; a generic non-mcp error is not.
    const raw = [
      'Error: Failed to load extension "/s/extensions/mcp-loader/index.ts": boom',
      "Error: something unrelated failed",
    ].join("\n");
    expect(mcpLoadErrorLines(raw, []).length).toBe(1);
    expect(mcpLoadErrorLines(raw, ["mcp-loader"]).length).toBe(1);
    // The 9a scanner itself is unchanged.
    expect(loadErrorLines(raw, "mcp-loader").length).toBe(1);
  });

  test("benign mcp mentions (tool listings in the OK run's JSONL) are ignored", () => {
    const raw = '{"type":"agent_start"}\n- mcp__broken_server (codemode)\nMCP servers whose tools are not declared';
    expect(mcpLoadErrorLines(raw, ["broken-server"])).toEqual([]);
  });

  test("server names match on word boundaries only (review fix)", () => {
    // A server named "log" must not match a line that only mentions
    // "logging" — the substring match false-positived on name prefixes.
    // (The line must avoid the "mcp" keyword, which would match on its own.)
    const raw = 'server "logging" failed to connect: nope';
    expect(mcpLoadErrorLines(raw, ["log"])).toEqual([]);
    expect(mcpLoadErrorLines(raw, ["logging"]).length).toBe(1);
    // Boundaries are the [A-Za-z0-9_-] class edges: "log-x" still matches
    // a line about the server "log-x" itself.
    expect(mcpLoadErrorLines('server "log-x" failed: nope', ["log-x"]).length).toBe(1);
  });
});

describe("mcpListFailure (pi mcp list --json interpretation)", () => {
  test("config errors fail", () => {
    const report = {servers: [], errors: ["/s/mcp.json: Expected property name in JSON at position 2"]};
    const failure = mcpListFailure(JSON.stringify(report));
    expect(failure).toContain("config error:");
    expect(failure).toContain("Expected property name");
  });

  test("a failed enabled server fails with its captured error; needs-auth/connected/disabled pass", () => {
    const report = {
      servers: [
        {name: "ok", enabled: true, state: "connected"},
        {name: "oauth-one", enabled: true, state: "needs-auth"},
        {name: "off", enabled: false, state: "disabled"},
        {name: "broken", enabled: true, state: "failed", error: "spawn /nonexistent/binary ENOENT\nstderr tail here"},
      ],
      errors: [],
    };
    const failure = mcpListFailure(JSON.stringify(report));
    expect(failure).toContain('MCP server "broken" failed to connect');
    expect(failure).toContain("spawn /nonexistent/binary ENOENT");
    // Only the FIRST stderr line is carried (the tail is noise).
    expect(failure).not.toContain("stderr tail here");
    expect(mcpListFailure(JSON.stringify({servers: report.servers.slice(0, 3), errors: []}))).toBeNull();
  });

  test("unparseable / non-object output fails", () => {
    expect(mcpListFailure("")).toContain("did not print a JSON report");
    expect(mcpListFailure("[]")).toContain("not an object");
  });
});

describe("runStartupProbe ordering + capture (fake runner)", () => {
  const OK_LIST = JSON.stringify({servers: [{name: "s", enabled: true, state: "connected"}], errors: []});

  function recorder(listResult: Partial<CommandResult>, promptResult: Partial<CommandResult>) {
    const calls: string[] = [];
    const run = async (args: string[], opts: {cwd: string; timeoutS: number; env?: NodeJS.ProcessEnv}): Promise<CommandResult> => {
      calls.push(args.join(" "));
      const isList = args[1] === "mcp";
      const base = isList ? listResult : promptResult;
      return {status: 0, stdout: "", stderr: "", timedOut: false, ...base};
    };
    return {calls, run};
  }

  test("both phases pass → ok; phase-b usage is returned (review fix)", async () => {
    const {calls, run} = recorder({stdout: OK_LIST}, {
      status: 0,
      stdout: [
        '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}],"usage":{"totalTokens":321,"cost":{}}}}',
        '{"type":"agent_end"}',
      ].join("\n"),
    });
    const sandbox = tempDir("startup-a-");
    writeFileSync(join(sandbox, "mcp.json"), '{"mcpServers":{"s":{"command":"x"}}}');
    const res = await runStartupProbe(sandbox, {runCmd: run, piBin: "fake-pi", timeoutS: 1});
    expect(res.ok).toBe(true);
    expect(res.failedPhase).toBeNull();
    expect(res.usageTokens).toBe(321);
    expect(calls[0]).toContain("mcp list --json");
    expect(calls[1]).toContain(`-- ${MCP_STARTUP_PROBE_PROMPT}`);
  });

  test("absent sandbox mcp.json: no throw, empty server-name list (review fix)", async () => {
    const {run} = recorder({stdout: OK_LIST}, {status: 0, stdout: '{"type":"agent_end"}'});
    const sandbox = tempDir("startup-no-mcp-"); // no mcp.json staged
    const res = await runStartupProbe(sandbox, {runCmd: run, piBin: "fake-pi", timeoutS: 1});
    expect(res.ok).toBe(true);
    expect(res.usageTokens).toBe(0); // no usage in the fake's JSONL
  });

  test("gate ordering: mcp-list failure → the OK prompt run is NOT executed", async () => {
    const {calls, run} = recorder(
      {stdout: JSON.stringify({servers: [{name: "b", enabled: true, state: "failed", error: "spawn ENOENT"}], errors: []})},
      {status: 0},
    );
    const sandbox = tempDir("startup-b-");
    writeFileSync(join(sandbox, "mcp.json"), '{"mcpServers":{"b":{"command":"x"}}}');
    const res = await runStartupProbe(sandbox, {runCmd: run, piBin: "fake-pi", timeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedPhase).toBe("mcp-list");
    expect(res.error).toContain("spawn ENOENT");
    expect(calls).toHaveLength(1); // the OK prompt never ran
  });

  test("prompt-phase failure: non-zero exit captured; mcp load error captured", async () => {
    const {run} = recorder({stdout: OK_LIST}, {status: 1, stderr: "boom"});
    const sandbox = tempDir("startup-c-");
    writeFileSync(join(sandbox, "mcp.json"), '{"mcpServers":{"s":{"command":"x"}}}');
    const res = await runStartupProbe(sandbox, {runCmd: run, piBin: "fake-pi", timeoutS: 1});
    expect(res.ok).toBe(false);
    expect(res.failedPhase).toBe("prompt");
    expect(res.error).toContain("exited 1");
    expect(res.error).toContain("boom");

    const {run: run2} = recorder({stdout: OK_LIST}, {status: 0, stderr: 'MCP server "s" failed to connect: nope'});
    const res2 = await runStartupProbe(sandbox, {runCmd: run2, piBin: "fake-pi", timeoutS: 1});
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain("failed to connect");
  });

  test("timeout kill: a hanging pi mcp list is killed at the timeout (real process)", async () => {
    // A real hanging "pi" stand-in: an executable script that ignores its
    // args and sleeps — the 9a runCommand timeout-kill pattern applied to the
    // startup probe's first phase.
    const dir = tempDir("startup-timeout-");
    const fakePi = join(dir, "fake-pi-sleep");
    writeFileSync(fakePi, "#!/bin/sh\nsleep 30\n");
    chmodSync(fakePi, 0o755);
    const started = Date.now();
    const res = await runStartupProbe(dir, {piBin: fakePi, timeoutS: 1});
    const elapsedS = (Date.now() - started) / 1000;
    expect(res.ok).toBe(false);
    expect(res.failedPhase).toBe("mcp-list");
    expect(res.timedOut).toBe(true);
    expect(elapsedS).toBeLessThan(10); // killed, not waited out
  }, 20_000);
});
