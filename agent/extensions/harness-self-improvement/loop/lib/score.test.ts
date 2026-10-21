#!/usr/bin/env bun
/**
 * Unit tests for baseline scoring: pairedDelta fixtures, scoreSuite's
 * crash-safe resume (reuse of existing result files, no model calls),
 * fingerprintSnapshot canonical form, ledger append/read/lastRun, and
 * renderReport output.
 *
 *   bun test loop/lib/score.test.ts
 */
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {pairedDelta, scoreSuite, type RunProbeFn, type TaskScoreResult} from "./score.ts";
import {appendEntry, lastRun, newRunId, readLedger, renderReport, type LedgerEntry, type ReportTask, type RunReportData} from "./ledger.ts";
import {fingerprintSnapshot} from "../baseline.ts";
import type {LoadedTask} from "./suite.ts";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "score-test-"));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Fixtures

const USAGE = (totalTokens: number) => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
});

function result(task: string, pass: boolean, tokens: number, category = "test"): TaskScoreResult {
  return {
    task,
    category,
    pass,
    durationMs: 1000,
    usage: tokens === 0 ? null : USAGE(tokens),
    exit: pass ? 0 : 1,
    piBinary: {bin: "pi", version: "1.3.0-test"},
    timedOut: false,
    checkerOutput: pass ? "" : "checker failed",
    stderrExcerpt: null,
    trajectory: "",
  };
}

function fakeTask(name: string): LoadedTask {
  const dir = join(tempRoot(), name); // paths are never touched on the resume path
  return {
    name,
    category: name.split("-")[0] ?? name,
    paths: {dir, taskMd: join(dir, "TASK.md"), checkTs: join(dir, "check.ts"), ref: join(dir, "ref"), broken: join(dir, "broken"), setupSh: null},
    meta: {name, description: "fixture task", timeoutS: 10},
    shapeErrors: [],
  };
}

// ---------------------------------------------------------------------------
// pairedDelta

describe("pairedDelta", () => {
  test("win: fail→pass flip counted, passDelta +1", () => {
    const delta = pairedDelta([result("a", false, 100), result("b", true, 200)], [result("a", true, 150), result("b", true, 210)]);
    expect(delta.perTask.find((d) => d.task === "a")).toEqual({task: "a", basePass: false, candPass: true, baseTokens: 100, candTokens: 150, flip: "fail-to-pass"});
    expect(delta.aggregates.passDelta).toBe(1);
    expect(delta.aggregates.regressions).toBe(0);
  });

  test("regression: pass→fail flip counted in regressions (veto signal)", () => {
    const delta = pairedDelta([result("a", true, 100), result("b", false, 50)], [result("a", false, 120), result("b", true, 60)]);
    const a = delta.perTask.find((d) => d.task === "a")!;
    expect(a.flip).toBe("pass-to-fail");
    expect(delta.aggregates.regressions).toBe(1);
    // b improved, a regressed: net pass delta is 0 but the regression is visible
    expect(delta.aggregates.passDelta).toBe(0);
  });

  test("token ratio: aggregates sum tokens and divide cand/base", () => {
    const delta = pairedDelta(
      [result("a", true, 100), result("b", true, 300), result("c", false, 100)],
      [result("a", true, 150), result("b", true, 300), result("c", false, 50)],
    );
    expect(delta.aggregates.baseTotalTokens).toBe(500);
    expect(delta.aggregates.candTotalTokens).toBe(500);
    expect(delta.aggregates.tokenRatio).toBe(1);
    expect(delta.aggregates.passDelta).toBe(0);
  });

  test("equal pass on both sides: no flips, null-token usage counts as 0", () => {
    const delta = pairedDelta([result("a", true, 0), result("b", false, 80)], [result("a", true, 20), result("b", false, 0)]);
    expect(delta.perTask.map((d) => d.flip)).toEqual([null, null]);
    expect(delta.perTask[0]!.baseTokens).toBe(0);
    expect(delta.perTask[1]!.candTokens).toBe(0);
    expect(delta.aggregates).toEqual({passDelta: 0, regressions: 0, baseTotalTokens: 80, candTotalTokens: 20, tokenRatio: 0.25, pairedCount: 2, unpaired: []});
  });

  test("tokenRatio is null when the base used 0 tokens", () => {
    const delta = pairedDelta([result("a", true, 0)], [result("a", true, 0)]);
    expect(delta.aggregates.tokenRatio).toBeNull();
  });

  test("tasks missing from one side are skipped; base order preserved", () => {
    const delta = pairedDelta([result("a", true, 10), result("b", true, 10), result("c", true, 10)], [result("b", true, 10)]);
    expect(delta.perTask.map((d) => d.task)).toEqual(["b"]);
    expect(delta.aggregates.pairedCount).toBe(1);
    expect(delta.aggregates.unpaired).toEqual(["a", "c"]);
  });

  test("unpaired lists tasks present on only one side, base order then cand order", () => {
    const delta = pairedDelta([result("a", true, 10), result("b", true, 10)], [result("b", true, 10), result("c", true, 10), result("d", true, 10)]);
    expect(delta.aggregates.pairedCount).toBe(1);
    expect(delta.aggregates.unpaired).toEqual(["a", "c", "d"]);
  });
});

// ---------------------------------------------------------------------------
// scoreSuite: crash-safe resume (no model calls — existing results are reused)

describe("scoreSuite resume", () => {
  test("reuses an existing per-task result file instead of re-probing", async () => {
    const runDir = tempRoot();
    const task = fakeTask("fixture-task");
    const tasksDir = join(runDir, "tasks");
    mkdirSync(tasksDir, {recursive: true});
    // Stored WITHOUT piBinary: resume must accept pre-piBinary result files.
    const stored = {...result("fixture-task", true, 4242), piBinary: undefined};
    writeFileSync(join(tasksDir, "fixture-task.json"), JSON.stringify(stored, null, 2));

    const {results, aggregate} = await scoreSuite([task], join(tempRoot(), "sandbox-unused"), runDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.task).toBe("fixture-task");
    expect(results[0]!.pass).toBe(true);
    expect(results[0]!.usage?.totalTokens).toBe(4242);
    expect(aggregate).toEqual({passCount: 1, total: 1, totalTokens: 4242});
  });

  test("overwrites a corrupt result file with a fresh (failed, model-less) probe", async () => {
    const runDir = tempRoot();
    const task = fakeTask("broken-task"); // paths point at a non-existent TASK.md
    const tasksDir = join(runDir, "tasks");
    mkdirSync(tasksDir, {recursive: true});
    writeFileSync(join(tasksDir, "broken-task.json"), "{not json");

    const {results} = await scoreSuite([task], join(tempRoot(), "sandbox-unused"), runDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.pass).toBe(false); // probe ran and failed without a task file
    // The corrupt file was replaced by a parseable per-task result (resume basis).
    const rewritten = JSON.parse(readFileSync(join(tasksDir, "broken-task.json"), "utf8")) as TaskScoreResult;
    expect(rewritten.task).toBe("broken-task");
  });

  test("writes per-task result JSON incrementally (one file per task)", async () => {
    const runDir = tempRoot();
    const task = fakeTask("fixture-task");
    const tasksDir = join(runDir, "tasks");
    mkdirSync(tasksDir, {recursive: true});
    writeFileSync(join(tasksDir, "fixture-task.json"), JSON.stringify(result("fixture-task", false, 1), null, 2));

    await scoreSuite([task], join(tempRoot(), "sandbox-unused"), runDir);
    expect(existsSync(join(tasksDir, "fixture-task.json"))).toBe(true);
    const parsed = JSON.parse(readFileSync(join(tasksDir, "fixture-task.json"), "utf8")) as TaskScoreResult;
    expect(parsed.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fingerprintSnapshot

describe("fingerprintSnapshot", () => {
  const snap = (agentsMd: string, skills: Array<{relPath: string; content: string}>) => ({
    kinds: {
      agents: [{relPath: "AGENTS.md", content: agentsMd}],
      skills: skills.map((s) => ({relPath: `skills/${s.relPath}`, content: s.content})),
      templates: [] as Array<{relPath: string; content: string}>,
      subagents: [] as Array<{relPath: string; content: string}>,
      extensions: [] as Array<{relPath: string; content: string}>,
      mcp: [] as Array<{relPath: string; content: string}>,
    },
  });

  test("is deterministic for identical snapshots", () => {
    const a = fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: "1.3.0"});
    const b = fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: "1.3.0"});
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes when AGENTS.md, a skill, the model, or the pi version changes", () => {
    const base = fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: "1.3.0"});
    expect(fingerprintSnapshot(snap("md2", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: "1.3.0"})).not.toBe(base);
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x2"}]), "prov/model", {bin: "pi", version: "1.3.0"})).not.toBe(base);
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model2", {bin: "pi", version: "1.3.0"})).not.toBe(base);
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), undefined, {bin: "pi", version: "1.3.0"})).not.toBe(base);
    // A different pi binary version must invalidate the fingerprint: a cache
    // written under one version is never reused under another.
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: "1.4.0"})).not.toBe(base);
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", {bin: "pi", version: null})).not.toBe(base);
    expect(fingerprintSnapshot(snap("md", [{relPath: "s/SKILL.md", content: "x"}]), "prov/model", undefined)).not.toBe(base);
    // Step 9b review fix: a mutating mcp.json content must invalidate the
    // fingerprint (the baseline cache is keyed on it — a changed MCP config
    // must never reuse cached results probed against the old config).
    const mcpFp = (content: string) =>
      fingerprintSnapshot({kinds: {...snap("md", []).kinds, mcp: [{relPath: "mcp.json", content}]}}, "prov/model", {bin: "pi", version: "1.3.0"});
    expect(mcpFp('{"mcpServers":{"fs":{"command":"fs-server"}}}')).not.toBe(base);
    expect(mcpFp('{"mcpServers":{}}')).not.toBe(mcpFp('{"mcpServers":{"fs":{"command":"fs-server"}}}'));
  });

  test("is order-independent over skills and separator-ambiguity-safe", () => {
    const base = fingerprintSnapshot(snap("md", [{relPath: "a/SKILL.md", content: "x"}, {relPath: "b/SKILL.md", content: "y"}]), "m", {bin: "pi", version: "1.3.0"});
    // Same skills in reverse input order → same fingerprint (canonical sort).
    expect(fingerprintSnapshot(snap("md", [{relPath: "b/SKILL.md", content: "y"}, {relPath: "a/SKILL.md", content: "x"}]), "m", {bin: "pi", version: "1.3.0"})).toBe(base);
    // relPath and content are separate fields: a relPath/content boundary
    // shift cannot collide ("s" + content "x\0skill\0y" vs two skills).
    const sneaky = fingerprintSnapshot(snap("md", [{relPath: "s", content: "x\0skill\0y"}]), "m", {bin: "pi", version: "1.3.0"});
    expect(sneaky).not.toBe(fingerprintSnapshot(snap("md", [{relPath: "s", content: "x"}, {relPath: "skill", content: "y"}]), "m", {bin: "pi", version: "1.3.0"}));
    expect(sneaky).not.toBe(fingerprintSnapshot(snap("md", [{relPath: "s\0skill", content: "y"}]), "m", {bin: "pi", version: "1.3.0"}));
  });

  test("changes when a prompt template or subagent changes (S8 kinds)", () => {
    const withTemplate = (t: Array<{relPath: string; content: string}>) => ({
      kinds: {...snap("md", []).kinds, templates: t},
    });
    const withSubagent = (a: Array<{relPath: string; content: string}>) => ({
      kinds: {...snap("md", []).kinds, subagents: a},
    });
    const base = fingerprintSnapshot(withTemplate([{relPath: "prompts/a.md", content: "x"}]), "m", {bin: "pi", version: "1.3.0"});
    expect(fingerprintSnapshot(withTemplate([{relPath: "prompts/a.md", content: "x2"}]), "m", {bin: "pi", version: "1.3.0"})).not.toBe(base);
    expect(fingerprintSnapshot(withTemplate([{relPath: "prompts/b.md", content: "x"}]), "m", {bin: "pi", version: "1.3.0"})).not.toBe(base);
    // Canonical sort: reverse input order, same fingerprint.
    expect(fingerprintSnapshot(withTemplate([{relPath: "prompts/a.md", content: "x"}, {relPath: "prompts/b.md", content: "y"}]), "m", {bin: "pi", version: "1.3.0"}))
      .toBe(fingerprintSnapshot(withTemplate([{relPath: "prompts/b.md", content: "y"}, {relPath: "prompts/a.md", content: "x"}]), "m", {bin: "pi", version: "1.3.0"}));
    const subBase = fingerprintSnapshot(withSubagent([{relPath: "agents/a.md", content: "x"}]), "m", {bin: "pi", version: "1.3.0"});
    expect(fingerprintSnapshot(withSubagent([{relPath: "agents/a.md", content: "x2"}]), "m", {bin: "pi", version: "1.3.0"})).not.toBe(subBase);
  });
});

// ---------------------------------------------------------------------------
// Step 10: parallel probing (concurrency cap, TMPDIR isolation, determinism)

describe("scoreSuite parallel probing", () => {
  /** A fake probe that overlaps work via a sleep and records concurrency. */
  function makeConcurrencyProbe(state: {inFlight: number; max: number; tmpDirs: string[]}, passMap: Record<string, boolean>, sleepMs = 20): RunProbeFn {
    return async (task, _sandboxDir, _wsDir, options = {}) => {
      state.tmpDirs.push(options.tmpDir ?? "<none>");
      state.inFlight++;
      state.max = Math.max(state.max, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      state.inFlight--;
      return {
        trajectory: "",
        usage: {input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
        exit: 0,
        checkerResult: {pass: passMap[task.name] ?? true, output: ""},
        piBinary: {bin: "fake-pi", version: "parallel-test"},
        timedOut: false,
        stderrExcerpt: null,
        rawJsonlPath: null,
      };
    };
  }

  function manyTasks(count: number): LoadedTask[] {
    return Array.from({length: count}, (_, i) => fakeTask(`par-${String(i).padStart(2, "0")}`));
  }

  test("cap respected under contention: max in-flight probes ≤ concurrency", async () => {
    const state = {inFlight: 0, max: 0, tmpDirs: [] as string[]};
    const runDir = tempRoot();
    const {stats} = await scoreSuite(manyTasks(8), join(tempRoot(), "sandbox"), runDir, {
      concurrency: 2,
      runProbeFn: makeConcurrencyProbe(state, {}),
    });
    expect(state.max).toBe(2); // exactly the cap: workers overlap, never exceed
    expect(stats.maxObservedConcurrency).toBe(2);
    expect(stats.tasks).toBe(8);
    expect(stats.probed).toBe(8);
    expect(stats.reused).toBe(0);
    expect(stats.wallMs).toBeGreaterThan(0);
  });

  test("parallel-vs-serial golden: same fake probe data → identical aggregate and per-task results", async () => {
    const passMap: Record<string, boolean> = {"par-00": true, "par-01": false, "par-02": true, "par-03": true, "par-04": false};
    const tasks = manyTasks(5);
    const serialState = {inFlight: 0, max: 0, tmpDirs: [] as string[]};
    const parallelState = {inFlight: 0, max: 0, tmpDirs: [] as string[]};
    const serial = await scoreSuite(tasks, join(tempRoot(), "sb"), tempRoot(), {concurrency: 1, runProbeFn: makeConcurrencyProbe(serialState, passMap)});
    const parallel = await scoreSuite(tasks, join(tempRoot(), "sb"), tempRoot(), {concurrency: 3, runProbeFn: makeConcurrencyProbe(parallelState, passMap)});
    // Same aggregate...
    expect(parallel.aggregate).toEqual(serial.aggregate);
    // ...same result order (input task order, independent of completion order)...
    expect(parallel.results.map((r) => r.task)).toEqual(tasks.map((t) => t.name));
    // ...and identical per-task fields. durationMs is a per-task wall measurement
    // and legitimately differs run-to-run; every ordering-independent field matches.
    const strip = (r: TaskScoreResult) => {
      const {durationMs: _durationMs, ...rest} = r;
      return rest;
    };
    expect(parallel.results.map(strip)).toEqual(serial.results.map(strip));
    expect(parallelState.max).toBe(3);
    expect(serialState.max).toBe(1);
  });

  test("per-probe TMPDIR: unique per probe, cleaned up after the run", async () => {
    const state = {inFlight: 0, max: 0, tmpDirs: [] as string[]};
    const tmpDirs = state.tmpDirs;
    await scoreSuite(manyTasks(6), join(tempRoot(), "sandbox"), tempRoot(), {
      concurrency: 3,
      runProbeFn: makeConcurrencyProbe(state, {}),
    });
    expect(new Set(tmpDirs).size).toBe(6); // every probe got its OWN temp dir
    for (const dir of tmpDirs) {
      expect(dir).not.toBe("<none>");
      expect(existsSync(dir)).toBe(false); // cleaned up after the probe
    }
  });

  test("resume still works under concurrency: pre-existing result files are reused, not re-probed", async () => {
    const runDir = tempRoot();
    const tasks = manyTasks(3);
    const tasksDir = join(runDir, "tasks");
    mkdirSync(tasksDir, {recursive: true});
    const state = {inFlight: 0, max: 0, tmpDirs: [] as string[]};
    // First (parallel) run fills all three result files.
    await scoreSuite(tasks, join(tempRoot(), "sandbox"), runDir, {concurrency: 2, runProbeFn: makeConcurrencyProbe(state, {})});
    // Second run: everything reused (no probes), stats reflect it.
    const second = await scoreSuite(tasks, join(tempRoot(), "sandbox"), runDir, {concurrency: 2, runProbeFn: makeConcurrencyProbe(state, {})});
    expect(second.stats.reused).toBe(3);
    expect(second.stats.probed).toBe(0);
    expect(second.aggregate.totalTokens).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ledger

describe("ledger", () => {
  test("newRunId has the <YYYYMMDD>-<HHMMSS>-<4 hex> shape", () => {
    expect(newRunId(new Date("2025-06-07T08:09:10"))).toMatch(/^20250607-080910-[0-9a-f]{4}$/);
    expect(newRunId()).not.toBe(newRunId()); // random suffix differs
  });

  test("append + read + lastRun round-trip on a temp ledger", () => {
    const path = join(tempRoot(), "run-history.jsonl");
    const entry = (runId: string, kind: string, tokens: number): LedgerEntry => ({
      runId,
      ts: "2025-06-07T08:09:10.000Z",
      kind,
      fingerprint: "fp",
      scores: {passCount: 1, total: 2},
      usage: {totalTokens: tokens},
    });
    appendEntry(entry("20250607-080910-aaaa", "baseline", 100), path);
    appendEntry(entry("20250607-080911-bbbb", "baseline-cached", 100), path);
    appendEntry(entry("20250607-080912-cccc", "baseline", 200), path);

    const all = readLedger(path);
    expect(all).toHaveLength(3);
    expect(all[2]!.usage!.totalTokens).toBe(200);
    expect(lastRun(undefined, path)!.runId).toBe("20250607-080912-cccc");
    expect(lastRun("baseline", path)!.runId).toBe("20250607-080912-cccc");
    expect(lastRun("baseline-cached", path)!.runId).toBe("20250607-080911-bbbb");
    expect(lastRun("nonexistent", path)).toBeNull();
  });

  test("readLedger on a missing file returns [], torn lines are skipped", () => {
    expect(readLedger(join(tempRoot(), "missing.jsonl"))).toEqual([]);
    const path = join(tempRoot(), "torn.jsonl");
    writeFileSync(path, `{"runId":"a","ts":"t","kind":"baseline","scores":{"passCount":1,"total":1},"usage":{"totalTokens":1}}\n{"runId":"torn\n`);
    const entries = readLedger(path);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.runId).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// renderReport

describe("renderReport", () => {
  const row = (task: string, pass: boolean, tokens: number, checkerOutput = ""): ReportTask => ({
    task,
    category: task.split("-")[0] ?? task,
    pass,
    durationMs: 2500,
    tokens,
    checkerOutput,
  });
  const data = (over: Partial<RunReportData>): RunReportData => ({
    runId: "20250607-080910-abcd",
    ts: "2025-06-07T08:09:10.000Z",
    kind: "baseline",
    model: "ozan-real/AgentLLM-big",
    fingerprint: "deadbeef",
    tasks: [],
    aggregate: {passCount: 0, total: 0, totalTokens: 0},
    ...over,
  });

  test("baseline mode: header, cached flag, per-task table, aggregate line", () => {
    const report = renderReport(data({
      cached: true,
      piBinary: {bin: "pi", version: "1.3.0"},
      tasks: [row("git-merge-conflict", true, 500), row("jq-csv-to-json", false, 700, "expected 3 rows, got 2\nmismatch at row 1")],
      aggregate: {passCount: 1, total: 2, totalTokens: 1200},
    }));
    expect(report).toContain("# Run 20250607-080910-abcd");
    expect(report).toContain("- **kind:** baseline");
    expect(report).toContain("- **cached:** true");
    expect(report).toContain("- **pi:** pi (1.3.0) [cached run]");
    expect(report).toContain("- **fingerprint:** deadbeef");
    expect(report).toContain("**Aggregate:** 1/2 pass, 1200 tokens");
    expect(report).toContain("| git-merge-conflict | git | true | 2.5s | 500 |");
    expect(report).toContain("| jq-csv-to-json | jq | false | 2.5s | 700 |");
  });

  test("comparison mode: base pass vs cand pass columns", () => {
    const report = renderReport(data({
      kind: "comparison",
      tasks: [row("git-merge-conflict", false, 500)],
      base: [row("git-merge-conflict", true, 480)],
      aggregate: {passCount: 0, total: 1, totalTokens: 500},
    }));
    expect(report).toContain("| base pass | cand pass |");
    expect(report).toContain("| git-merge-conflict | git | true | false |");
    expect(report).not.toContain("cached:");
  });

  test("failure excerpts: checker output tail (last ~10 lines) for failed tasks", () => {
    const lines = Array.from({length: 15}, (_, i) => `line-${i + 1}`);
    const report = renderReport(data({
      tasks: [row("jq-csv-to-json", false, 700, lines.join("\n"))],
      aggregate: {passCount: 0, total: 1, totalTokens: 700},
    }));
    expect(report).toContain("## Failure excerpts");
    expect(report).toContain("### jq-csv-to-json");
    expect(report).toContain("line-15");
    expect(report).not.toContain("line-1\n"); // head lines dropped, tail kept
    expect(report).not.toContain("line-5");
  });
});
