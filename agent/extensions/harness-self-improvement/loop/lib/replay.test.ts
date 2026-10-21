#!/usr/bin/env bun
/**
 * Unit tests for the replay channel (Step 7): synthetic session-log fixtures
 * (a fake session.jsonl built in a tmp dir — NO real session reads),
 * materialization + dedupe, workspace staging via the runProbe hook, and
 * calibrateJudge wiring on injected results (no model calls, no probes).
 *
 *   bun test loop/lib/replay.test.ts
 */
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir, homedir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {
  areNearDuplicates,
  captureWorkspaceState,
  computeAgreement,
  dedupeKeyOf,
  isCalibrated,
  loadReplayTask,
  mineReplayTasks,
  parseSessionFile,
  probeReplayTask,
  redactHomePrefix,
  redactProvenanceText,
  redactSessionPath,
  scoreSession,
  selectReplayCandidates,
  toWorkspaceRelPath,
  type ReplayCandidate,
} from "./replay.ts";
import {calibrateJudge, type CalibrationRow} from "./replay.ts";
import {judgeTrajectory} from "./judge.ts";
import type {LoadedTask} from "./suite.ts";
import type {ProbeResult, RunProbeOptions} from "./probe.ts";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "replay-test-"));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Synthetic session.jsonl builder

type ContentItem = Record<string, unknown>;

function sessionLine(cwd: string, timestamp = "2026-10-01T10:00:00.000Z"): string {
  return JSON.stringify({type: "session", version: 3, id: "01a-test", timestamp, cwd});
}

function userMessage(text: string): string {
  return JSON.stringify({type: "message", id: "u1", message: {role: "user", content: [{type: "text", text}] as ContentItem[]}});
}

function assistantToolCall(name: string, args: Record<string, unknown>): string {
  return JSON.stringify({type: "message", id: `a-${Math.random()}`, message: {role: "assistant", content: [{type: "toolCall", id: "t1", name, arguments: args} as ContentItem]}});
}

function writeSyntheticSession(dir: string, name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, lines.map((l) => `${l}\n`).join(""));
  return path;
}

/** A session with substantial write activity (enough tool calls to qualify). */
function codingSessionLines(opts: {prompt?: string; cwd?: string; writes?: number; editOnly?: boolean} = {}): string[] {
  const prompt = opts.prompt ?? "Implement the config loader module with validation and tests";
  const cwd = opts.cwd ?? "/tmp/fake-project";
  const lines = [sessionLine(cwd), userMessage(prompt)];
  const writeCount = opts.writes ?? 12;
  if (!opts.editOnly) {
    for (let i = 0; i < writeCount; i++) {
      lines.push(assistantToolCall("write", {path: `src/mod${i}.ts`, content: `export const mod${i} = ${i};\n`}));
    }
  } else {
    // edit-only: enough edit calls, no write calls
    for (let i = 0; i < 12; i++) {
      lines.push(assistantToolCall("edit", {path: "src/existing.ts", edits: [{oldText: `old${i}`, newText: `new${i}`}]}));
    }
  }
  lines.push(assistantToolCall("read", {path: "README.md"}));
  return lines;
}

// ---------------------------------------------------------------------------
// toWorkspaceRelPath

describe("toWorkspaceRelPath", () => {
  test("relative path passes through", () => {
    expect(toWorkspaceRelPath("src/a.ts", "/proj")).toBe("src/a.ts");
  });
  test("absolute path under cwd made relative", () => {
    expect(toWorkspaceRelPath("/proj/src/a.ts", "/proj")).toBe("src/a.ts");
  });
  test("absolute path outside cwd falls back to last two segments", () => {
    expect(toWorkspaceRelPath("/etc/nginx/conf.d/x.conf", "/proj")).toBe("conf.d/x.conf");
  });
  test("traversal path rejected", () => {
    expect(toWorkspaceRelPath("../escape.ts", "/proj")).toBeNull();
  });
  test("empty path rejected", () => {
    expect(toWorkspaceRelPath("", "/proj")).toBeNull();
  });
  test("absolute path rejected when cwd is unknown", () => {
    expect(toWorkspaceRelPath("/etc/nginx/conf.d/x.conf", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSessionFile

describe("parseSessionFile", () => {
  test("extracts the verbatim first user prompt and reconstructed writes", async () => {
    const dir = tempRoot();
    const path = writeSyntheticSession(dir, "2026-10-01T10-00-00-000Z_01a九aaa1111-2222-3333-4444-555555555555.jsonl", codingSessionLines());
    const parsed = await parseSessionFile(path);
    expect(parsed.prompt).toBe("Implement the config loader module with validation and tests");
    expect(parsed.promptTruncated).toBe(false);
    expect(parsed.cwd).toBe("/tmp/fake-project");
    expect(parsed.writeCalls).toBe(12);
    expect(parsed.toolCalls).toBe(13);
    expect(parsed.writtenFiles.get("src/mod3.ts")).toBe("export const mod3 = 3;\n");
    expect(parsed.editedOnlyPaths).toEqual([]);
  });

  test("prompt truncated at 4000 chars with the flag set", async () => {
    const dir = tempRoot();
    const path = writeSyntheticSession(dir, "2026-10-01T10-00-01-000Z_01abbb2222-2222-3333-4444-555555555555.jsonl", codingSessionLines({prompt: "x".repeat(5000)}));
    const parsed = await parseSessionFile(path);
    expect(parsed.prompt.length).toBe(4000);
    expect(parsed.promptTruncated).toBe(true);
  });

  test("last write wins per path", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine("/proj"),
      userMessage("Refactor the retry helper into its own module"),
      assistantToolCall("write", {path: "retry.ts", content: "v1\n"}),
      assistantToolCall("write", {path: "retry.ts", content: "v2\n"}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "s1.jsonl", lines));
    expect(parsed.writtenFiles.get("retry.ts")).toBe("v2\n");
  });

  test("edits replay onto written content when oldText matches", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine("/proj"),
      userMessage("Fix the off-by-one in the parser loop"),
      assistantToolCall("write", {path: "parser.ts", content: "for (i = 0; i <= n; i++) {}\n"}),
      assistantToolCall("edit", {path: "parser.ts", edits: [{oldText: "i <= n", newText: "i < n"}]}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "s2.jsonl", lines));
    expect(parsed.writtenFiles.get("parser.ts")).toBe("for (i = 0; i < n; i++) {}\n");
    expect(parsed.editCalls).toBe(1);
  });

  test("edit on a never-written path lands in editedOnlyPaths (unreliable)", async () => {
    const dir = tempRoot();
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "s3.jsonl", codingSessionLines({editOnly: true, prompt: "Patch the failing importer test"})));
    expect(parsed.writtenFiles.size).toBe(0);
    expect(parsed.editCalls).toBe(12);
    expect(parsed.editedOnlyPaths).toEqual(["src/existing.ts"]);
  });

  test("edit with failing oldText on a written path degrades that file to editedOnly", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine("/proj"),
      userMessage("Fix the flaky backup rotation script"),
      assistantToolCall("write", {path: "rotate.sh", content: "echo hi\n"}),
      assistantToolCall("edit", {path: "rotate.sh", edits: [{oldText: "NOT PRESENT", newText: "x"}]}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "s4.jsonl", lines));
    expect(parsed.writtenFiles.has("rotate.sh")).toBe(false);
    expect(parsed.editedOnlyPaths).toContain("rotate.sh");
  });

  test("slash-command first user message → no prompt extracted", async () => {
    const dir = tempRoot();
    const lines = [sessionLine("/proj"), userMessage("/hloop status"), ...Array.from({length: 10}, (_, i) => assistantToolCall("read", {path: `f${i}`}))];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "s5.jsonl", lines));
    expect(parsed.prompt).toBe("");
  });

  test("line budget respected (session capped at MAX_SESSION_LINES)", async () => {
    const dir = tempRoot();
    const lines: string[] = [sessionLine("/proj"), userMessage("A very long task prompt that clearly states the goal of the work")];
    for (let i = 0; i < 50; i++) lines.push(assistantToolCall("read", {path: `f${i}`}));
    const path = writeSyntheticSession(dir, "s6.jsonl", lines);
    const {MAX_SESSION_LINES} = await import("./replay.ts");
    const parsed = await parseSessionFile(path);
    // Just a sanity check that a normal short session parses fully under the cap.
    expect(MAX_SESSION_LINES).toBeGreaterThan(lines.length);
    expect(parsed.toolCalls).toBe(50);
  });

  test("write via absolute and equivalent relative paths does NOT collide", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine("/proj"),
      userMessage("Write the same module twice through different path spellings"),
      assistantToolCall("write", {path: "/proj/src/same.ts", content: "v1\n"}),
      assistantToolCall("write", {path: "src/same.ts", content: "v2\n"}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "nocollide.jsonl", lines));
    expect(parsed.writtenFiles.get("src/same.ts")).toBe("v2\n");
    expect(parsed.collidedPaths).toEqual([]);
  });

  test("two DISTINCT absolute sources collapsing onto one relPath collide (unreliable)", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine("/proj"),
      userMessage("Touch two different files that map to the same workspace path"),
      assistantToolCall("write", {path: "/etc/app/conf.d/a.ts", content: "from etc\n"}),
      assistantToolCall("write", {path: "/var/lib/conf.d/a.ts", content: "from var\n"}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "collide.jsonl", lines));
    expect(parsed.writtenFiles.has("conf.d/a.ts")).toBe(false);
    expect(parsed.collidedPaths).toEqual(["conf.d/a.ts"]);
    expect(parsed.editedOnlyPaths).toContain("conf.d/a.ts");
  });

  test("absolute write with no session cwd event is rejected (no workspace placement)", async () => {
    const dir = tempRoot();
    const lines = [
      sessionLine(""),
      userMessage("Write a file while the session log has no cwd"),
      assistantToolCall("write", {path: "/somewhere/else/file.ts", content: "hi\n"}),
      assistantToolCall("read", {path: "x"}),
      assistantToolCall("read", {path: "y"}),
      assistantToolCall("read", {path: "z"}),
    ];
    const parsed = await parseSessionFile(writeSyntheticSession(dir, "nocwd.jsonl", lines));
    expect(parsed.writtenFiles.size).toBe(0);
    expect(parsed.writeCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreSession + dedupe + selection

function candidateFromSession(session: Awaited<ReturnType<typeof parseSessionFile>>, sourceSession: string): ReplayCandidate {
  const c = scoreSession(session, sourceSession);
  if (c === null) throw new Error("expected a candidate");
  return c;
}

describe("scoreSession + selection", () => {
  test("substantial coding session qualifies; facet success boosts the score", async () => {
    const dir = tempRoot();
    const path = writeSyntheticSession(dir, "s.jsonl", codingSessionLines());
    const session = await parseSessionFile(path);
    const bare = scoreSession(session, path)!;
    const facetted = scoreSession(session, path, {sessionId: "s", type: "feature", outcome: "success"})!;
    expect(bare.score).toBeGreaterThan(0);
    expect(facetted.score).toBe(bare.score + 4); // success +3, coding type +1
  });

  test("low-activity session rejected", async () => {
    const dir = tempRoot();
    const lines = [sessionLine("/proj"), userMessage("quick question about bash quoting"), assistantToolCall("read", {path: "x"})];
    const session = await parseSessionFile(writeSyntheticSession(dir, "low.jsonl", lines));
    expect(scoreSession(session, "low.jsonl")).toBeNull();
  });

  test("edit-only session qualifies with degraded evidence (no write calls)", async () => {
    const dir = tempRoot();
    const session = await parseSessionFile(writeSyntheticSession(dir, "eo.jsonl", codingSessionLines({editOnly: true})));
    const candidate = scoreSession(session, "eo.jsonl")!;
    expect(candidate.writeCalls).toBe(0);
    expect(candidate.editedOnlyPaths.length).toBeGreaterThan(0);
  });

  test("selectReplayCandidates dedupes near-identical prompts", async () => {
    const dir = tempRoot();
    const a = candidateFromSession(await parseSessionFile(writeSyntheticSession(dir, "a.jsonl", codingSessionLines({prompt: "Implement the config loader module with validation and tests"}))), "a.jsonl");
    const b = candidateFromSession(await parseSessionFile(writeSyntheticSession(dir, "b.jsonl", codingSessionLines({prompt: "Implement the config loader module with validation and tests!!!"}))), "b.jsonl");
    const c = candidateFromSession(await parseSessionFile(writeSyntheticSession(dir, "c.jsonl", codingSessionLines({prompt: "Write a migration script for the users table to add indexes"}))), "c.jsonl");
    expect(areNearDuplicates(a.prompt, b.prompt)).toBe(true);
    expect(areNearDuplicates(a.prompt, c.prompt)).toBe(false);
    const picked = selectReplayCandidates([a, b, c], 8);
    expect(picked).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// mineReplayTasks (synthetic sessions root + facets file, materialized to tmp)

describe("mineReplayTasks", () => {
  test("materializes TASK.md-compatible layout with reconstructed workspace; degrades edit-only sessions", async () => {
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    // Facets file matching one session by uuid (facets PRESENT case).
    const goodName = "2026-10-02T10-00-00-000Z_01a11111-1111-1111-1111-111111111111.jsonl";
    const editOnlyName = "2026-10-02T11-00-00-000Z_01a22222-2222-2222-2222-222222222222.jsonl";
    writeSyntheticSession(root, goodName, codingSessionLines({prompt: "Build the CSV export endpoint with streaming and error handling"}));
    writeSyntheticSession(root, editOnlyName, codingSessionLines({editOnly: true, prompt: "Refactor the duplicated query builders into one shared helper module"}));
    const facetsPath = join(tempRoot(), "harness-facets.json");
    writeFileSync(facetsPath, JSON.stringify({sessions: [{sessionId: "01a11111-1111-1111-1111-111111111111", type: "feature", outcome: "success", satisfaction: "high", goal: "csv export"}]}));

    const tasks = await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir, facetsPath});
    expect(tasks).toHaveLength(2);

    const reconstructed = tasks.find((t) => t.quality === "reconstructed")!;
    expect(reconstructed).toBeDefined();
    expect(reconstructed.prompt).toBe("Build the CSV export endpoint with streaming and error handling");
    expect(reconstructed.facet?.outcome).toBe("success");

    const taskDir = join(outDir, reconstructed.id);
    const taskMd = readFileSync(join(taskDir, "TASK.md"), "utf8");
    expect(taskMd.startsWith("---\n")).toBe(true);
    expect(taskMd).toContain(`name: ${reconstructed.id}`);
    expect(taskMd).toContain("timeout_s: 300");
    // Prompt body after the frontmatter is verbatim.
    expect(taskMd.split("---\n")[2]!.startsWith("Build the CSV export endpoint")).toBe(true);
    // check.ts exists + executable.
    expect(statSync(join(taskDir, "check.ts")).mode & 0o111).toBeTruthy();
    expect(existsSync(join(taskDir, "PROVENANCE.json"))).toBe(true);
    // Workspace files reconstructed.
    expect(existsSync(join(taskDir, "workspace", "src", "mod0.ts"))).toBe(true);
    expect(readFileSync(join(taskDir, "workspace", "src", "mod5.ts"), "utf8")).toBe("export const mod5 = 5;\n");

    const degraded = tasks.find((t) => t.quality === "described-from-log")!;
    expect(degraded).toBeDefined();
    expect(degraded.workspace).toHaveLength(0);
    const readme = readFileSync(join(outDir, degraded.id, "workspace", "README.md"), "utf8");
    expect(readme).toContain("described-from-log");
    expect(readme).toContain("src/existing.ts");
  });

  test("absent facets file is fine (no facet bonus, no crash)", async () => {
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    writeSyntheticSession(root, "2026-10-03T10-00-00-000Z_01a33333-3333-3333-3333-333333333333.jsonl", codingSessionLines());
    const tasks = await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.facet).toBeUndefined();
  });

  test("re-mining wipes stale task dirs", async () => {
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    mkdirSync(join(outDir, "stale-task"), {recursive: true});
    writeSyntheticSession(root, "2026-10-04T10-00-00-000Z_01a44444-4444-4444-4444-444444444444.jsonl", codingSessionLines());
    await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir});
    expect(existsSync(join(outDir, "stale-task"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Privacy redaction (S7 review)

describe("privacy redaction", () => {
  test("redactHomePrefix rewrites the literal home dir to ~", () => {
    expect(redactHomePrefix("see /home/someuser/proj and ~/rel", "/home/someuser")).toBe("see ~/proj and ~/rel");
    expect(redactHomePrefix("/home/someuser/proj")).toBe("/home/someuser/proj"); // only the LITERAL home dir is scrubbed
  });

  test("redactSessionPath collapses absolute session paths to the basename", () => {
    expect(redactSessionPath("/home/someuser/.pi/agent/sessions/--x--/2026-01-01T00-00-00-000Z_abcd1234-1111-2222-3333-444444444444.jsonl"))
      .toBe("2026-01-01T00-00-00-000Z_abcd1234-1111-2222-3333-444444444444.jsonl");
    expect(redactSessionPath("rel/dir/file.jsonl")).toBe("rel/dir/file.jsonl"); // relative passes through
  });

  test("redactProvenanceText redacts session paths + home prefix, keeps the rest", () => {
    const text = "session /home/someuser/.pi/agent/sessions/--tmp-tmp-x--/2026-01-01T00-00-00-000Z_abcd1234-1111-2222-3333-444444444444.jsonl, 308 tool calls (11 write, 38 edit), cwd /tmp/tmp-x, logs under /home/someuser/data";
    const redacted = redactProvenanceText(text, "/home/someuser");
    expect(redacted).toContain("session 2026-01-01T00-00-00-000Z_abcd1234-1111-2222-3333-444444444444.jsonl,");
    expect(redacted).toContain("cwd /tmp/tmp-x");
    expect(redacted).toContain("logs under ~/data");
    expect(redacted).not.toContain("someuser");
  });

  test("materialized artifacts carry no absolute home paths (PROVENANCE, TASK.md, workspace, provenance string)", async () => {
    const home = homedir();
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    // Prompt + written content both mention the real home dir; cwd lives under it.
    const lines = [
      sessionLine(join(home, "projects", "widget")),
      userMessage(`Refactor the widget loader; config lives in ${home}/.config/widget`),
      assistantToolCall("write", {path: "loader.ts", content: `const cfg = readConfig("${home}/.config/widget/config.json");\n`}),
      ...Array.from({length: 9}, (_, i) => assistantToolCall("read", {path: `f${i}`})),
    ];
    writeSyntheticSession(root, "2026-10-06T10-00-00-000Z_01a66666-6666-6666-6666-666666666666.jsonl", lines);
    const [task] = await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir});
    const taskDir = join(outDir, task!.id);
    const provenanceJson = readFileSync(join(taskDir, "PROVENANCE.json"), "utf8");
    const taskMd = readFileSync(join(taskDir, "TASK.md"), "utf8");
    const loader = readFileSync(join(taskDir, "workspace", "loader.ts"), "utf8");
    for (const artifact of [provenanceJson, taskMd, loader]) {
      expect(artifact).not.toContain(home);
      expect(artifact).not.toContain("/home/");
    }
    // Provenance structure survives: cwd redacted to ~/, source session is a basename.
    const provenance = JSON.parse(provenanceJson) as {cwd: string; sourceSession: string};
    expect(provenance.cwd).toBe(join("~", "projects", "widget"));
    expect(provenance.sourceSession).toBe("2026-10-06T10-00-00-000Z_01a66666-6666-6666-6666-666666666666.jsonl");
    expect(task!.provenance).not.toContain(home);
  });

  test("collided paths degrade a mined task to described-from-log", async () => {
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    const lines = [
      sessionLine("/proj"),
      userMessage("Two different absolute files collapse onto one workspace path"),
      assistantToolCall("write", {path: "/etc/app/conf.d/a.ts", content: "from etc\n"}),
      assistantToolCall("write", {path: "/var/lib/conf.d/a.ts", content: "from var\n"}),
      ...Array.from({length: 7}, (_, i) => assistantToolCall("read", {path: `f${i}`})),
    ];
    writeSyntheticSession(root, "2026-10-07T10-00-00-000Z_01a77777-7777-7777-7777-777777777777.jsonl", lines);
    const tasks = await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.quality).toBe("described-from-log");
    const readme = readFileSync(join(outDir, tasks[0]!.id, "workspace", "README.md"), "utf8");
    expect(readme).toContain("conf.d/a.ts");
  });
});

// ---------------------------------------------------------------------------
// loadReplayTask + probeReplayTask (fake probe)

function fakeProbeResult(): ProbeResult {
  return {
    trajectory: "did the thing",
    usage: null,
    exit: 0,
    checkerResult: {pass: true, output: ""},
    piBinary: null,
    timedOut: false,
    stderrExcerpt: null,
    rawJsonlPath: null,
  };
}

describe("loadReplayTask + probeReplayTask", () => {
  test("loadReplayTask returns a LoadedTask for runProbe; probe stages workspace before the run", async () => {
    const root = join(tempRoot(), "sessions");
    const outDir = join(tempRoot(), "suite-replay");
    mkdirSync(root, {recursive: true});
    writeSyntheticSession(root, "2026-10-05T10-00-00-000Z_01a55555-5555-5555-5555-555555555555.jsonl", codingSessionLines());
    const [task] = await mineReplayTasks({mine: 8, sessionsRootOverride: root, outDir});

    const loaded = loadReplayTask(task!.id, outDir);
    expect(loaded.name).toBe(task!.id);
    expect(loaded.category).toBe("replay");
    expect(loaded.meta?.timeoutS).toBe(300);
    expect(existsSync(loaded.paths.checkTs)).toBe(true);

    // Fake probe captures the stageWorkspace hook and the options.
    const seenWsDirs: string[] = [];
    const fakeRunProbe = async (t: LoadedTask, sandboxDir: string, wsDir: string, options?: RunProbeOptions): Promise<ProbeResult> => {
      seenWsDirs.push(wsDir);
      options?.stageWorkspace?.(wsDir);
      return fakeProbeResult();
    };
    const wsDir = join(tempRoot(), "ws");
    const result = await probeReplayTask(loaded, join(tempRoot(), "sandbox"), wsDir, {runProbeFn: fakeRunProbe});
    expect(result.trajectory).toBe("did the thing");
    // The task's reconstructed workspace files were staged into wsDir BEFORE the probe.
    expect(readFileSync(join(wsDir, "src", "mod0.ts"), "utf8")).toBe("export const mod0 = 0;\n");
    expect(seenWsDirs).toEqual([wsDir]);
  });

  test("captureWorkspaceState renders the final workspace for the judge", () => {
    const ws = join(tempRoot(), "capws");
    mkdirSync(join(ws, "sub"), {recursive: true});
    writeFileSync(join(ws, "a.txt"), "alpha");
    writeFileSync(join(ws, "sub", "b.txt"), "beta");
    const state = captureWorkspaceState(ws);
    expect(state).toContain("a.txt");
    expect(state).toContain("alpha");
    expect(state).toContain("sub/b.txt");
    expect(state).toContain("beta");
    expect(captureWorkspaceState(join(tempRoot(), "missing"))).toContain("missing");
  });
});

// ---------------------------------------------------------------------------
// calibrateJudge (resultsOverride + fake judge — no probes, no model calls)

describe("calibrateJudge", () => {
  function fakeJudgeFn(score: number, abstained = false) {
    return async (): Promise<{score: number; rationale: string; abstained: boolean}> => ({score, rationale: abstained ? "abstain: test" : "test rationale", abstained});
  }

  test("computes agreement, writes report + ledger entry, gate flips on threshold", async () => {
    const runDir = join(tempRoot(), "run");
    const ledgerPath = join(tempRoot(), "ledger.jsonl");
    const results = [
      {task: "a", pass: true, trajectory: "traj a"},
      {task: "b", pass: false, trajectory: "traj b"},
      {task: "c", pass: true, trajectory: "traj c"},
      {task: "d", pass: false, trajectory: "traj d"},
    ];
    // Judge: a=9 (agree), b=3 (agree), c=5 (disagree), d=8 (disagree) → 0.5
    let call = 0;
    const judgeScores = [9, 3, 5, 8];
    const result = await calibrateJudge({
      callModel: async () => {
        throw new Error("should not call the model when judgeFn is injected");
      },
      judgeFn: (async () => {
        const score = judgeScores[call++]!;
        return {score, rationale: "fixture", abstained: false};
      }) as unknown as typeof judgeTrajectory,
      runDir,
      resultsOverride: results,
      ledgerPath,
      minAgreement: 0.8,
    });
    expect(result.rows).toHaveLength(4);
    expect(result.agreement).toBeCloseTo(0.5);
    expect(result.calibrated).toBe(false);
    expect(result.cacheHits).toBe(4);
    // Cache-only basis (resultsOverride defaults to "cache"): never CALIBRATED.
    expect(result.condition).toBe("cached-trajectories");
    expect(existsSync(result.reportPath)).toBe(true);
    const report = readFileSync(result.reportPath, "utf8");
    expect(report).toContain("# Judge calibration");
    expect(report).toContain("ADVISORY");
    expect(report).toContain("cached-trajectories");
    expect(report).toContain("sample too small (N<8)");
    expect(report).toContain("| a | pass | 9 |");
    // Ledger entry kind judge-calibration with agreement + judgeModel + condition.
    const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
    const entry = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
    expect(entry["kind"]).toBe("judge-calibration");
    expect(entry["agreement"]).toBeCloseTo(0.5);
    expect(entry["judgeModel"]).toBeNull();
    expect(entry["condition"]).toBe("cached-trajectories");
    expect(typeof entry["note"]).toBe("string");
    // Gate reads it back from the ledger: cache-only 4-row run stays advisory.
    expect(isCalibrated(require("./ledger.ts").readLedger(ledgerPath)).calibrated).toBe(false);
  });

  test("cache-only basis with high agreement is labeled cached-trajectories and stays advisory", async () => {
    const runDir = join(tempRoot(), "run-cached");
    const ledgerPath = join(tempRoot(), "ledger-cached.jsonl");
    const results = Array.from({length: 8}, (_, i) => ({task: `t${i}`, pass: true, trajectory: "t", source: "cache" as const}));
    const result = await calibrateJudge({
      callModel: async () => "",
      judgeFn: (async () => ({score: 9, rationale: "good", abstained: false})) as unknown as typeof judgeTrajectory,
      runDir,
      resultsOverride: results,
      ledgerPath,
    });
    expect(result.rows).toHaveLength(8);
    expect(result.agreement).toBe(1);
    // Even 8/8 agreement cannot calibrate on cached trajectories alone.
    expect(result.calibrated).toBe(false);
    expect(result.condition).toBe("cached-trajectories");
    const report = readFileSync(result.reportPath, "utf8");
    expect(report).toContain("cached-trajectories");
    expect(report).toContain("ADVISORY");
  });

  test("fresh-probe calibration with ≥8 rows and agreement ≥ threshold calibrates", async () => {
    const runDir = join(tempRoot(), "run-fresh");
    const ledgerPath = join(tempRoot(), "ledger-fresh.jsonl");
    const results = Array.from({length: 8}, (_, i) => ({task: `t${i}`, pass: true, trajectory: "t", source: "fresh" as const}));
    // Judge passes every task → agreement 1.0 with the all-pass checker.
    const result = await calibrateJudge({
      callModel: async () => "",
      judgeFn: (async () => ({score: 9, rationale: "good", abstained: false})) as unknown as typeof judgeTrajectory,
      runDir,
      resultsOverride: results,
      ledgerPath,
    });
    expect(result.calibrated).toBe(true);
    expect(result.condition).toBe("fresh");
    expect(computeAgreement(result.rows as CalibrationRow[]).agreement).toBe(1);
    const report = readFileSync(result.reportPath, "utf8");
    expect(report).toContain("CALIBRATED");
    const entry = JSON.parse(readFileSync(ledgerPath, "utf8").trim().split("\n").pop()!) as Record<string, unknown>;
    expect(entry["condition"]).toBe("fresh");
    expect(entry["calibrated"]).toBe(true);
  });

  test("fresh-probe sample below 8 rows stays advisory even at full agreement", async () => {
    const runDir = join(tempRoot(), "run-small");
    const ledgerPath = join(tempRoot(), "ledger-small.jsonl");
    const results = Array.from({length: 7}, (_, i) => ({task: `t${i}`, pass: true, trajectory: "t", source: "fresh" as const}));
    const result = await calibrateJudge({
      callModel: async () => "",
      judgeFn: (async () => ({score: 9, rationale: "good", abstained: false})) as unknown as typeof judgeTrajectory,
      runDir,
      resultsOverride: results,
      ledgerPath,
    });
    expect(result.calibrated).toBe(false);
    expect(result.condition).toBe("fresh");
    expect(readFileSync(result.reportPath, "utf8")).toContain("sample too small (N<8)");
  });

  test("Step 11: calibration is keyed by judge model — agreement for model A does not calibrate model B", async () => {
    const runDir = join(tempRoot(), "run-judgemodel");
    const ledgerPath = join(tempRoot(), "ledger-judgemodel.jsonl");
    const results = Array.from({length: 8}, (_, i) => ({task: `t${i}`, pass: true, trajectory: "t", source: "fresh" as const}));
    const result = await calibrateJudge({
      callModel: async () => "",
      judgeFn: (async () => ({score: 9, rationale: "good", abstained: false})) as unknown as typeof judgeTrajectory,
      runDir,
      resultsOverride: results,
      ledgerPath,
      judgeModel: "prov/judge-a",
    });
    expect(result.calibrated).toBe(true);
    expect(result.judgeModel).toBe("prov/judge-a");
    const entry = JSON.parse(readFileSync(ledgerPath, "utf8").trim().split("\n").pop()!) as Record<string, unknown>;
    expect(entry["judgeModel"]).toBe("prov/judge-a");

    const entries = JSON.parse(`[${readFileSync(ledgerPath, "utf8").trim().split("\n").join(",")}]`) as Parameters<typeof isCalibrated>[0];
    // The recorded judge model IS calibrated...
    expect(isCalibrated(entries, 0.8, "prov/judge-a").calibrated).toBe(true);
    // ...a DIFFERENT judge model is NOT (agreement never measured with it)...
    const other = isCalibrated(entries, 0.8, "prov/judge-b");
    expect(other.calibrated).toBe(false);
    expect(other.agreement).toBeNull();
    // ...and a pre-S11 style unkeyed gate still finds the entry (back-compat).
    expect(isCalibrated(entries, 0.8).calibrated).toBe(true);
  });

  test("abstained rows are excluded from the agreement denominator and reported separately", () => {
    const rows: CalibrationRow[] = [
      {task: "a", checkerPass: false, judgeScore: 5, judgePass: false, abstained: true, rationale: "abstain", trajectorySource: "cache"},
      {task: "b", checkerPass: true, judgeScore: 8, judgePass: true, abstained: false, rationale: "ok", trajectorySource: "cache"},
      {task: "c", checkerPass: true, judgeScore: 3, judgePass: false, abstained: false, rationale: "miss", trajectorySource: "cache"},
    ];
    const result = computeAgreement(rows);
    expect(result.total).toBe(2); // abstained row excluded from the denominator
    expect(result.abstained).toBe(1);
    expect(result.matches).toBe(1);
    expect(result.agreement).toBe(0.5);
  });
});
