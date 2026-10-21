#!/usr/bin/env bun
/**
 * /hloop driver — the recursive optimization loop state machine (Step 6).
 *
 * runLoop(opts) chains the S1–S5 pieces per iteration:
 *   (1) snapshotReal + fingerprint (loop/lib/stage.ts + loop/baseline.ts)
 *   (2) baseline via the shared result cache (cache hit = no probes)
 *   (3) propose (loop/lib/proposer.ts) with an injected callModel — the
 *       /hloop command in index.ts binds ctx.modelRegistry, selftest fakes it
 *   (4) per validated candidate: buildSandbox under runs/<runId>/sandbox-<i>/
 *       (SELF-CREATED dirs only; buildSandbox wipes its target) and
 *       scoreSuite into runs/<runId>/iter-<n>/cand-<i>/ with per-task resume
 *       reuse bound to (runId, iteration, candidate index) via scoreSuite's
 *       `boundTo` — result files from another run/candidate are re-probed.
 *       STEP 9a: a candidate touching extensions/<name>/ FIRST runs the code
 *       gate pipeline (loop/lib/gates.ts): exactly one extension, staged into
 *       the sandbox, then `bunx tsc --noEmit` (120s) and `bun test` (120s) on
 *       the sandbox copy; the full-suite probe follows only after both pass,
 *       and a nested-pi extension load error captured from the probe output
 *       rejects the candidate post-suite. Gate failures are recorded as
 *       decision "gates-failed" with the captured output; code-bearing
 *       candidates select with config code.minWin instead of minWin.
 *   (5) selectWinner vs baseline (loop/lib/score.ts)
 *   (6) applyCandidate (winner) or appendProposalRejectedEntry (no winner)
 *   (7) ledger entries + report.md per iteration and per candidate
 *
 * STOP CONDITIONS (checked between iterations, before the proposer model
 * call, and before each probe spawn): iteration count reached; the SUM of
 * probe usage.totalTokens across the run ≥ budget.maxTotalTokens (cost.total
 * is always 0 on this gateway — tokens are the metric); the stop flag file
 * loop/.stop exists (consumed — deleted — when seen); zero validated
 * candidates in an iteration (stop reason "no-valid-candidates").
 *
 * STATE: runs/<runId>/state.json is rewritten after every mutation
 * (iteration no., phase, budget spent, per-candidate decisions, plus the
 * full proposed candidate edits once propose completes). A run whose state
 * says status "running" lets a later `/hloop start --resume <runId>` continue
 * it: completed iterations are skipped, partially scored phases reuse their
 * on-disk per-task results, and a crash between propose and scoring resumes
 * with the persisted candidates (no second proposer call).
 *
 * SINGLE-FLIGHT: a new run refuses to start while any run's state.json says
 * status "running" with a live pid (crashed runs — dead pid — are resumable,
 * not active). The fresh run's state is persisted BEFORE the guard check so
 * near-simultaneous starts serialize via the persisted state files. Resuming
 * a still-active (alive-pid) run is refused: only dead-pid runs resume. A
 * --suite on --resume must match the run's recorded suiteGlob.
 *
 * TESTABILITY: every side effect is injectable (snapshotFn, captureModelFn,
 * resolvePiBinaryFn, tasksFn, runProbeFn, callModel, configOverride,
 * runsDir/cacheDir/ledgerPath/stopFlagPath/agentDir, isPidAliveFn). The
 * selftest below runs the whole state machine on fakes — NO real model calls,
 * NO real probes, NO writes outside temp dirs.
 *
 * Usage:
 *   bun run loop/driver.ts selftest   state-machine unit checks (fakes only)
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {appendEntry, extensionRoot, ledgerPath, newRunId, readLedger, renderReport, type ReportTask} from "./lib/ledger.ts";
import {buildSandbox, captureModelFlag, realPiAgentDir, snapshotReal, type ComponentSnapshot} from "./lib/stage.ts";
import {listTaskDirs, loadTask, suiteRoot, type LoadedTask} from "./lib/suite.ts";
import {scoreSuite, selectWinner, type RunProbeFn, type SelectionConfig, type TaskScoreResult} from "./lib/score.ts";
import {buildLedgerDigest, propose, type CallModel, type ProposedCandidate} from "./lib/proposer.ts";
import {appendProposalRejectedEntry, applyCandidate, loadLoopConfig, type LoopConfig} from "./lib/apply.ts";
import {baselineCacheDir, baselineCachePath, cacheMatchesTaskSet, fingerprintSnapshot, readBaselineCache, writeBaselineCache} from "./baseline.ts";
import {resolvePiBinary, runProbe} from "./lib/probe.ts";
import {runCodeGates, scanProbeLoadErrors, selectionConfigForEdits, stageExtensionForSandbox, touchedExtensionNames} from "./lib/gates.ts";

// ---------------------------------------------------------------------------
// Public types

export type LoopStopReason = "stop-flag" | "budget-exceeded" | "no-valid-candidates";

export type IterationPhase = "baseline" | "propose" | "score" | "decide" | "done";

export type CandidateDecision =
  | "pending"           // accepted, not yet scored
  | "rejected-invalid"  // failed proposer validation
  | "gates-failed"      // failed the Step 9a code gate pipeline (tsc / bun test / load-error capture)
  | "not-scored"        // accepted but beyond candidates.maxPerIteration
  | "loser"             // scored, did not win
  | "winner-dry-run"    // won, applyCandidate returned dry-run
  | "winner-applied"    // won, applyCandidate committed
  | "apply-rejected"    // won selection, refused at apply time
  | "apply-failed"      // won selection, apply rolled back
  | "winner-not-applied"; // won but another winner was applied first

export interface IterationCandidateState {
  /** Candidate index within the proposal (0-based; = sandbox-N / cand-N index). */
  index: number;
  fingerprint: string | null;
  rationale: string;
  verdict: "accepted" | "rejected";
  /** Validation reasons (rejected candidates) or selection reasons (scored ones). */
  reasons: string[];
  /** Full proposed edits, persisted at propose time so resume never re-proposes. */
  edits: Array<{path: string; content: string | null}>;
  decision: CandidateDecision;
  /** selectWinner outcome; null until scored. */
  win: boolean | null;
  scores: {passCount: number; total: number} | null;
  totalTokens: number;
  reportPath: string | null;
}

export interface IterationBaselineState {
  cached: boolean;
  taskCount: number;
  passCount: number;
  total: number;
  totalTokens: number;
}

export interface IterationState {
  index: number;
  phase: IterationPhase;
  fingerprint: string | null;
  baseline: IterationBaselineState | null;
  proposalFingerprint: string | null;
  candidates: IterationCandidateState[];
  /** Iteration-level outcome: "applied" | "dry-run" | "no-winner" | "apply-rejected" | "apply-failed" | "no-valid-candidates". */
  decision: string | null;
}

export interface LoopState {
  runId: string;
  status: "running" | "completed" | "stopped" | "failed";
  stopReason: string | null;
  startedTs: string;
  updatedTs: string;
  pid: number;
  /** Captured --model flag for nested runs; null = pi default. */
  model: string | null;
  /** --suite glob filter, or null for the full suite. */
  suiteGlob: string | null;
  config: {
    maxIterations: number;
    maxCandidates: number;
    maxTotalTokens: number;
    dryRun: boolean;
    minWin: number;
    minQualityGain: number | null;
    usageFactor: number;
    /** Snapshotted at run start (Step 9a review fix) so resumed runs keep the same code thresholds/allowlist. */
    code: {
      allow: string[];
      minWin: number;
    };
  };
  /** SUM of fresh probe usage.totalTokens across the run (budget metric). */
  budgetSpent: number;
  iterations: IterationState[];
}

export interface LoopRunResult {
  ok: boolean;
  runId: string | null;
  status: "completed" | "stopped" | "failed" | "refused";
  stopReason: string | null;
  budgetSpent: number;
  iterationsCompleted: number;
  statePath: string | null;
}

export interface RunLoopOptions {
  /** Override config.budget.maxIterations for this run. */
  iterations?: number;
  /** Override config.candidates.maxPerIteration for this run. */
  maxCandidates?: number;
  /** Glob filter over task names, e.g. "smoke-*" (default: full suite). */
  suiteGlob?: string;
  /** Continue a run whose state.json says status "running". */
  resumeRunId?: string;
  /** The model call for the Proposer (real: ctx-bound adapter in index.ts). */
  callModel: CallModel;
  /** Progress sink; default console.log. */
  log?: (line: string) => void;
  // --- injectable dependencies (defaults = real implementations) ---
  snapshotFn?: () => ComponentSnapshot;
  captureModelFn?: () => string | undefined;
  resolvePiBinaryFn?: () => {bin: string; version: string | null};
  tasksFn?: () => LoadedTask[];
  runProbeFn?: RunProbeFn;
  configPath?: string;
  /** Full config override (selftest); wins over configPath. */
  configOverride?: LoopConfig;
  runsDir?: string;
  cacheDir?: string;
  ledgerPath?: string;
  stopFlagPath?: string;
  /** agentDir override for applyCandidate (tests; default = real ~/.pi/agent). */
  agentDir?: string;
  isPidAliveFn?: (pid: number) => boolean;
  /** Code gate runner override (selftest); default = the real gates pipeline. */
  codeGatesFn?: typeof runCodeGates;
}

// ---------------------------------------------------------------------------
// Internals

/** Thrown by guards to unwind into a clean "stopped" finish. */
class LoopAbort extends Error {
  constructor(readonly reason: LoopStopReason) {
    super(`loop abort: ${reason}`);
  }
}

/** `smoke-*` style glob → anchored RegExp (* = any run, ? = one char). */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists but not ours
  }
}

/**
 * The runId of any run whose state.json says "running" with a live pid.
 * `excludeRunId` skips one run (the driver's own just-persisted fresh state,
 * which must not make the run refuse itself).
 */
export function findActiveRunId(runsDir: string, isPidAlive: (pid: number) => boolean = defaultIsPidAlive, excludeRunId?: string): string | null {
  if (!existsSync(runsDir)) return null;
  for (const entry of readdirSync(runsDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    if (entry.name === excludeRunId) continue;
    const statePath = join(runsDir, entry.name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as Partial<LoopState>;
      if (state.status === "running" && typeof state.pid === "number" && isPidAlive(state.pid)) return entry.name;
    } catch {
      // unreadable state file — not evidence of an active run
    }
  }
  return null;
}

function loadSuiteTasks(suiteGlob: string | null): LoadedTask[] {
  const root = suiteRoot();
  const tasks = listTaskDirs(root).map((dirName) => loadTask(root, dirName));
  const invalid = tasks.filter((t) => t.meta === null || t.shapeErrors.length > 0);
  if (invalid.length > 0) {
    const names = invalid.map((t) => `${t.name} (${t.shapeErrors[0] ?? "invalid TASK.md"})`).join(", ");
    throw new Error(`suite has invalid tasks — run \`bun run loop/lib/suite.ts validate\` first: ${names}`);
  }
  if (suiteGlob === null || suiteGlob === undefined) return tasks;
  const re = globToRegExp(suiteGlob);
  const filtered = tasks.filter((t) => re.test(t.name));
  if (filtered.length === 0) throw new Error(`suite glob '${suiteGlob}' matched no tasks (suite has ${tasks.length})`);
  return filtered;
}

/** Materialize result JSONs into <dir>/tasks/<task>.json (cache-hit layout). */
function writeResultFiles(dir: string, results: TaskScoreResult[]): void {
  const tasksDir = join(dir, "tasks");
  mkdirSync(tasksDir, {recursive: true});
  for (const r of results) writeFileSync(join(tasksDir, `${r.task}.json`), `${JSON.stringify(r, null, 2)}\n`);
}

/** Read back per-task results written by scoreSuite/writeResultFiles. */
function readResultDir(dir: string): TaskScoreResult[] {
  const tasksDir = join(dir, "tasks");
  if (!existsSync(tasksDir)) return [];
  const out: TaskScoreResult[] = [];
  for (const file of readdirSync(tasksDir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(tasksDir, file), "utf8")) as unknown;
      if (parsed !== null && typeof parsed === "object" && typeof (parsed as TaskScoreResult).task === "string" && typeof (parsed as TaskScoreResult).pass === "boolean") {
        out.push(parsed as TaskScoreResult);
      }
    } catch {
      // corrupt result file — invisible here; scoreSuite resume would re-probe it
    }
  }
  return out;
}

function aggregateOf(results: TaskScoreResult[]): {passCount: number; total: number; totalTokens: number} {
  return {
    passCount: results.filter((r) => r.pass).length,
    total: results.length,
    totalTokens: results.reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0),
  };
}

function toReportTasks(results: TaskScoreResult[]): ReportTask[] {
  return results.map((r) => ({
    task: r.task,
    category: r.category,
    pass: r.pass,
    durationMs: r.durationMs,
    tokens: r.usage?.totalTokens ?? 0,
    checkerOutput: r.checkerOutput,
  }));
}

function readHarnessFindings(): string | undefined {
  const candidates = [join(extensionRoot(), "harness-findings.md"), join(realPiAgentDir(), "harness-findings.md")];
  const path = candidates.find((p) => existsSync(p));
  return path !== undefined ? readFileSync(path, "utf8") : undefined;
}

// ---------------------------------------------------------------------------
// runLoop

export async function runLoop(opts: RunLoopOptions): Promise<LoopRunResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const runsDir = opts.runsDir ?? join(extensionRoot(), "runs");
  const cacheDir = opts.cacheDir ?? baselineCacheDir();
  const ledger = opts.ledgerPath ?? ledgerPath();
  const stopFlagPath = opts.stopFlagPath ?? join(extensionRoot(), "loop", ".stop");
  const config = opts.configOverride ?? loadLoopConfig(opts.configPath);
  const maxIterations = opts.iterations ?? config.budget.maxIterations;
  const maxCandidates = opts.maxCandidates ?? config.candidates.maxPerIteration;
  const isPidAlive = opts.isPidAliveFn ?? defaultIsPidAlive;
  const now = (): string => new Date().toISOString();

  const refused = (reason: string, statePath: string | null = null): LoopRunResult =>
    ({ok: false, runId: null, status: "refused", stopReason: reason, budgetSpent: 0, iterationsCompleted: 0, statePath});

  let runId: string;
  let state: LoopState;
  if (opts.resumeRunId !== undefined) {
    runId = opts.resumeRunId;
    const resumeStatePath = join(runsDir, runId, "state.json");
    if (!existsSync(resumeStatePath)) return refused(`cannot resume: no state.json for run ${runId} (expected ${resumeStatePath})`);
    try {
      state = JSON.parse(readFileSync(resumeStatePath, "utf8")) as LoopState;
    } catch (err) {
      return refused(`cannot resume run ${runId}: state.json is unreadable: ${err instanceof Error ? err.message : String(err)}`, resumeStatePath);
    }
    if (state.status !== "running") {
      return refused(`cannot resume run ${runId}: status is "${state.status}" (${state.stopReason ?? "no stop reason"}) — start a new run instead`, resumeStatePath);
    }
    // A run whose pid is alive is still ACTIVE, not resumable: resuming it
    // would run two loops against the same state.json. Only a crashed run
    // (dead pid) may be resumed.
    if (typeof state.pid === "number" && isPidAlive(state.pid)) {
      return refused(`cannot resume: run ${runId} is still active (pid ${state.pid}) — use /hloop stop`, resumeStatePath);
    }
    // A --suite that differs from the recorded one would silently score a
    // different task set against the persisted partial results — refuse.
    if (opts.suiteGlob !== undefined && opts.suiteGlob !== state.suiteGlob) {
      return refused(`cannot resume run ${runId}: --suite '${opts.suiteGlob}' does not match the run's recorded suite '${state.suiteGlob ?? "<full suite>"}' — resume without --suite (or with the recorded one), or start a new run`, resumeStatePath);
    }
    if (opts.iterations !== undefined) state.config.maxIterations = maxIterations;
    if (opts.maxCandidates !== undefined) state.config.maxCandidates = maxCandidates;
    log(`[hloop] resuming run ${runId}: ${state.iterations.filter((i) => i.phase === "done").length} iteration(s) done, ${state.budgetSpent} tokens spent`);
  } else {
    runId = newRunId();
    state = {
      runId,
      status: "running",
      stopReason: null,
      startedTs: now(),
      updatedTs: now(),
      pid: process.pid,
      model: opts.captureModelFn?.() ?? captureModelFlag() ?? null,
      suiteGlob: opts.suiteGlob ?? null,
      config: {
        maxIterations,
        maxCandidates,
        maxTotalTokens: config.budget.maxTotalTokens,
        dryRun: config.apply.dryRun,
        minWin: config.minWin,
        minQualityGain: config.minQualityGain,
        usageFactor: config.usageFactor,
        code: {allow: [...config.code.allow], minWin: config.code.minWin},
      },
      budgetSpent: 0,
      iterations: [],
    };
  }

  const runDir = join(runsDir, runId);
  const statePath = join(runDir, "state.json");
  mkdirSync(runDir, {recursive: true});
  const model = state.model;
  // Resume uses the code config SNAPSHOTTED at run start (state.config.code) so
  // a resumed run keeps the same allowlist + minWin threshold; states persisted
  // before this snapshot existed fall back to the freshly loaded config.
  const codeConfig = state.config.code ?? {allow: [...config.code.allow], minWin: config.code.minWin};
  const runConfig: LoopConfig = {...config, code: codeConfig};
  const selectionConfig: SelectionConfig = {
    minWin: state.config.minWin,
    minQualityGain: state.config.minQualityGain,
    usageFactor: state.config.usageFactor,
  };

  const persist = (): void => {
    state.updatedTs = now();
    mkdirSync(runDir, {recursive: true});
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  };

  // Persist the fresh run's state BEFORE the single-flight guard: two
  // near-simultaneous starts then serialize via the persisted state files
  // (the loser sees the winner's live state.json and refuses).
  const fresh = opts.resumeRunId === undefined;
  if (fresh) persist();

  // Single-flight: never start (or resume a DIFFERENT run) while another run
  // is live. A crashed run (dead pid) is resumable, not active. The fresh
  // run's own just-persisted state is excluded from the scan and removed
  // again on refusal (a refused start leaves no run directory behind).
  const active = findActiveRunId(runsDir, isPidAlive, fresh ? runId : undefined);
  if (active !== null && active !== opts.resumeRunId) {
    if (fresh) rmSync(runDir, {recursive: true, force: true});
    return refused(`another loop run appears active: ${active} (its state.json says "running" and its pid is alive) — wait for it to finish or stop it with /hloop stop`, join(runsDir, active, "state.json"));
  }

  const finish = (status: "completed" | "stopped", stopReason: string): LoopRunResult => {
    if (stopReason === "stop-flag") rmSync(stopFlagPath, {force: true}); // consume the flag
    state.status = status;
    state.stopReason = stopReason;
    persist();
    return {
      ok: status === "completed",
      runId,
      status,
      stopReason,
      budgetSpent: state.budgetSpent,
      iterationsCompleted: state.iterations.filter((i) => i.phase === "done").length,
      statePath,
    };
  };

  // Stop conditions, checked before the proposer call and before every probe
  // spawn (between iterations the runLoop loop below checks them too).
  const checkGuards = (): void => {
    if (existsSync(stopFlagPath)) throw new LoopAbort("stop-flag");
    if (state.budgetSpent >= state.config.maxTotalTokens) throw new LoopAbort("budget-exceeded");
  };

  // Suite tasks (injectable; default reads loop/suite/ and applies the glob).
  const tasksFn = opts.tasksFn ?? (() => loadSuiteTasks(state.suiteGlob));

  // Every FRESH probe goes through here: guard, then budget accounting
  // (reused results never pass through — their tokens were already counted
  // by the attempt that wrote them).
  const probeImpl: RunProbeFn = opts.runProbeFn ?? runProbe;
  const guardedProbe: RunProbeFn = async (task, sandboxDir, wsDir, options) => {
    checkGuards();
    const result = await probeImpl(task, sandboxDir, wsDir, options);
    state.budgetSpent += result.usage?.totalTokens ?? 0;
    persist();
    return result;
  };

  const runIteration = async (index: number): Promise<void> => {
    let iter = state.iterations.find((it) => it.index === index);
    const iterDir = join(runDir, `iter-${index}`);
    if (iter === undefined) {
      iter = {index, phase: "baseline", fingerprint: null, baseline: null, proposalFingerprint: null, candidates: [], decision: null};
      state.iterations.push(iter);
    }
    persist();

    // (1)+(2) snapshot, fingerprint, baseline via shared cache (hit = no probes).
    if (iter.phase === "baseline") {
      const snapshot = opts.snapshotFn?.() ?? snapshotReal();
      const piBinary = opts.resolvePiBinaryFn?.() ?? resolvePiBinary();
      iter.fingerprint = fingerprintSnapshot(snapshot, model ?? undefined, piBinary);
      const tasks = tasksFn();
      const taskNames = tasks.map((t) => t.name);
      const cachePath = baselineCachePath(iter.fingerprint, taskNames, cacheDir);
      const hit = readBaselineCache(cachePath);
      let baselineResults: TaskScoreResult[];
      let cached: boolean;
      if (hit !== null && cacheMatchesTaskSet(hit.results, taskNames)) {
        // Cache payloads carry the probing run's boundTo (score.ts stamps it
        // on every probed result); strip it so the materialized baseline
        // results can never be reused by THIS run's resume as if it probed
        // them itself.
        baselineResults = hit.results.map((r) => {
          const stripped = {...r};
          delete stripped.boundTo;
          return stripped;
        });
        cached = true;
        log(`[hloop] iter ${index}: baseline cache hit (${taskNames.length} tasks) — no probes`);
        // Materialize into the iteration dir so resume and /hloop status see
        // the same layout as a probed baseline.
        writeResultFiles(join(iterDir, "baseline"), baselineResults);
      } else {
        const sandboxDir = join(runDir, "sandbox"); // self-created; buildSandbox wipes it
        buildSandbox(snapshot, sandboxDir);
        log(`[hloop] iter ${index}: baseline probing ${taskNames.length} task(s)...`);
        const scored = await scoreSuite(tasks, sandboxDir, join(iterDir, "baseline"), {
          model: model ?? undefined,
          runProbeFn: guardedProbe,
          boundTo: `${runId}/iter-${index}/baseline`,
        });
        baselineResults = scored.results;
        cached = false;
        writeBaselineCache({fingerprint: iter.fingerprint, model, ts: now(), results: baselineResults}, cachePath);
      }
      const aggregate = aggregateOf(baselineResults);
      iter.baseline = {cached, taskCount: taskNames.length, ...aggregate};
      // Per-iteration report (baseline side; candidate comparison reports go
      // to iter-<n>/cand-<i>/report.md) — one report.md per iteration, always.
      writeFileSync(join(iterDir, "report.md"), renderReport({
        runId,
        ts: now(),
        kind: cached ? "baseline-cached" : "baseline",
        model,
        fingerprint: iter.fingerprint,
        cached,
        piBinary: baselineResults.find((r) => r.piBinary)?.piBinary ?? null,
        tasks: toReportTasks(baselineResults),
        aggregate,
      }));
      appendEntry({
        runId,
        ts: now(),
        kind: cached ? "baseline-cached" : "baseline",
        iteration: index,
        fingerprint: iter.fingerprint,
        scores: {passCount: aggregate.passCount, total: aggregate.total},
        usage: {totalTokens: aggregate.totalTokens},
        cached,
      }, ledger);
      persist();
      iter.phase = "propose";
      persist();
    }

    // (3) propose — the only model call of an iteration.
    if (iter.phase === "propose") {
      checkGuards();
      const baselineResults = readResultDir(join(iterDir, "baseline"));
      if (baselineResults.length === 0) throw new Error(`baseline results missing under ${iterDir}/baseline — cannot propose`);
      const ledgerDigest = buildLedgerDigest(readLedger(ledger));
      log(`[hloop] iter ${index}: proposing candidates (model call, baseline ${iter.baseline?.passCount}/${iter.baseline?.total})...`);
      const result = await propose({
        snapshot: opts.snapshotFn?.() ?? snapshotReal(),
        baseline: {
          tasks: baselineResults.map((r) => ({
            task: r.task,
            category: r.category,
            pass: r.pass,
            durationMs: r.durationMs,
            tokens: r.usage?.totalTokens ?? 0,
            checkerOutput: r.checkerOutput,
          })),
          aggregate: {passCount: baselineResults.filter((r) => r.pass).length, total: baselineResults.length},
        },
        ledgerDigest,
        harnessFindings: readHarnessFindings(),
        model: model ?? undefined,
      }, {
        callModel: opts.callModel,
        // Gate 1 (Step 9a) at propose time: dynamic extensions-kind checks
        // against the same agent dir apply later re-validates against.
        validationLimits: {extensionEnv: {agentDir: opts.agentDir ?? realPiAgentDir(), codeAllow: runConfig.code.allow}},
      });
      if (result.parseError !== undefined) log(`[hloop] iter ${index}: proposer parse error: ${result.parseError}`);
      iter.proposalFingerprint = result.proposalFingerprint;
      iter.candidates = result.candidates.map((c, idx) => ({
        index: idx,
        fingerprint: c.fingerprint,
        rationale: c.rationale,
        verdict: c.verdict,
        reasons: c.reasons,
        // Full edits persisted BEFORE any scoring: a crash after this point
        // resumes with the exact same candidates and can safely reuse
        // (runId, iter, cand-index)-bound partial results.
        edits: c.edits,
        decision: c.verdict === "accepted" ? "pending" : "rejected-invalid",
        win: null,
        scores: null,
        totalTokens: 0,
        reportPath: null,
      }));
      persist();
      const validCount = iter.candidates.filter((c) => c.verdict === "accepted").length;
      log(`[hloop] iter ${index}: ${validCount}/${iter.candidates.length} candidate(s) validated`);
      if (validCount === 0) {
        iter.decision = "no-valid-candidates";
        persist();
        throw new LoopAbort("no-valid-candidates");
      }
      iter.phase = "score";
      persist();
    }

    // (4)+(5) score each validated candidate (capped) and select winners.
    if (iter.phase === "score") {
      // Mid-resume drift guard: candidate results are paired against this
      // iteration's recorded fingerprint. If the snapshot changed between the
      // crash and the resume, pairing would compare mismatched runs — fail
      // the run instead.
      const scoreSnapshot = opts.snapshotFn?.() ?? snapshotReal();
      const scoreFingerprint = fingerprintSnapshot(scoreSnapshot, model ?? undefined, opts.resolvePiBinaryFn?.() ?? resolvePiBinary());
      if (iter.fingerprint !== null && scoreFingerprint !== iter.fingerprint) {
        throw new Error(`snapshot changed between crash and resume: iteration ${index} was fingerprinted ${iter.fingerprint.slice(0, 12)}…, the current snapshot is ${scoreFingerprint.slice(0, 12)}… — refusing to pair results from different snapshots`);
      }
      const baselineResults = readResultDir(join(iterDir, "baseline"));
      const accepted = iter.candidates.filter((c) => c.verdict === "accepted");
      // Cap: deterministic by candidate index, so resume picks the same set.
      for (const c of accepted.slice(maxCandidates)) {
        if (c.decision === "pending") c.decision = "not-scored";
      }
      const toScore = accepted.slice(0, maxCandidates).filter((c) => c.decision === "pending");
      /** Write a gate-failure report for a code candidate (captured gate/probe output). */
      const writeGateFailureReport = (candIdx: number, title: string, reasons: string[]): string => {
        const reportPath = join(iterDir, `cand-${candIdx}`, "report.md");
        mkdirSync(join(iterDir, `cand-${candIdx}`), {recursive: true});
        writeFileSync(reportPath, [
          `# run ${runId} — candidate ${candIdx} — ${title}`, "", "```", ...reasons, "```", "",
        ].join("\n"));
        return reportPath;
      };
      for (const cState of toScore) {
        const candIdx = cState.index;
        const sandboxDir = join(runDir, `sandbox-${candIdx}`); // self-created; buildSandbox wipes it
        buildSandbox(scoreSnapshot, sandboxDir);
        log(`[hloop] iter ${index}: scoring candidate ${candIdx + 1}...`);
        // Step 9a code gates (BEFORE the suite probe). A candidate touching
        // extensions/<name>/ must touch exactly one extension, be staged into
        // the sandbox, then pass gates 2+3 (tsc, bun test) — any failure
        // rejects the candidate with the captured output and skips the probe.
        const touchedExts = touchedExtensionNames(cState.edits);
        let gateExt: string | null = null;
        if (touchedExts.length > 0) {
          if (touchedExts.length > 1) {
            const reasons = [`candidate touches ${touchedExts.length} extensions (${touchedExts.join(", ")}) — at most one extension per code candidate`];
            cState.decision = "gates-failed";
            cState.reasons = reasons;
            cState.reportPath = writeGateFailureReport(candIdx, "code gates failed", reasons);
            appendEntry({runId, ts: now(), kind: "code-gate-failed", iteration: index, candidateIndex: candIdx, reasons}, ledger);
            log(`[hloop] iter ${index}: candidate ${candIdx + 1} REJECTED by code gates — ${reasons[0]}`);
            persist();
            continue;
          }
          gateExt = touchedExts[0]!;
          try {
            stageExtensionForSandbox(sandboxDir, opts.agentDir ?? realPiAgentDir(), gateExt, cState.edits);
          } catch (err) {
            const reasons = [`sandbox staging of extension "${gateExt}" failed: ${err instanceof Error ? err.message : String(err)}`];
            cState.decision = "gates-failed";
            cState.reasons = reasons;
            cState.reportPath = writeGateFailureReport(candIdx, "code gates failed", reasons);
            appendEntry({runId, ts: now(), kind: "code-gate-failed", iteration: index, candidateIndex: candIdx, reasons}, ledger);
            log(`[hloop] iter ${index}: candidate ${candIdx + 1} REJECTED by code gates — ${reasons[0]}`);
            persist();
            continue;
          }
          log(`[hloop] iter ${index}: running code gates on extensions/${gateExt} (tsc, bun test)...`);
          const gates = await (opts.codeGatesFn ?? runCodeGates)(sandboxDir, gateExt);
          if (!gates.ok) {
            const reasons = [`code gate '${gates.failedGate}' failed for extensions/${gateExt}${gates.timedOut ? " (timed out, process group killed)" : ""}:\n${gates.output}`];
            cState.decision = "gates-failed";
            cState.reasons = reasons;
            cState.reportPath = writeGateFailureReport(candIdx, `code gate '${gates.failedGate}' failed`, reasons);
            appendEntry({runId, ts: now(), kind: "code-gate-failed", iteration: index, candidateIndex: candIdx, reasons, gate: gates.failedGate ?? undefined}, ledger);
            log(`[hloop] iter ${index}: candidate ${candIdx + 1} REJECTED by code gates — gate '${gates.failedGate}' failed`);
            persist();
            continue;
          }
        }
        const scored = await scoreSuite(tasksFn(), sandboxDir, join(iterDir, `cand-${candIdx}`), {
          model: model ?? undefined,
          runProbeFn: guardedProbe,
          // Resume reuse is bound to (runId, iteration, candidate index): a
          // result file only counts when its boundTo matches exactly.
          boundTo: `${runId}/iter-${index}/cand-${candIdx}`,
        });
        // Gate 4 capture: after the suite, scan the probe output for nested-pi
        // extension LOAD ERRORS mentioning the staged extension.
        if (gateExt !== null) {
          const loadErrors = scanProbeLoadErrors(join(iterDir, `cand-${candIdx}`), gateExt);
          if (loadErrors.length > 0) {
            const reasons = [`nested pi failed to load the staged extension "${gateExt}":\n${loadErrors.slice(0, 5).join("\n")}`];
            cState.decision = "gates-failed";
            cState.reasons = reasons;
            cState.reportPath = writeGateFailureReport(candIdx, "extension load error", reasons);
            appendEntry({runId, ts: now(), kind: "code-gate-failed", iteration: index, candidateIndex: candIdx, reasons, gate: "load-error"}, ledger);
            log(`[hloop] iter ${index}: candidate ${candIdx + 1} REJECTED by code gates — extension load error`);
            persist();
            continue;
          }
        }
        cState.scores = {passCount: scored.aggregate.passCount, total: scored.aggregate.total};
        cState.totalTokens = scored.aggregate.totalTokens;
        // Step 9a selection: code-bearing candidates need code.minWin passes
        // (default 2) instead of the global minWin.
        const selection = selectWinner(baselineResults, scored.results, selectionConfigForEdits(cState.edits, selectionConfig, runConfig.code.minWin));
        cState.win = selection.win;
        cState.reasons = selection.reasons;
        const reportPath = join(iterDir, `cand-${candIdx}`, "report.md");
        writeFileSync(reportPath, renderReport({
          runId,
          ts: now(),
          kind: `candidate-${candIdx}`,
          model,
          fingerprint: iter.fingerprint,
          piBinary: scored.results.find((r) => r.piBinary)?.piBinary ?? null,
          tasks: toReportTasks(scored.results),
          base: toReportTasks(baselineResults),
          aggregate: scored.aggregate,
        }));
        cState.reportPath = reportPath;
        appendEntry({
          runId,
          ts: now(),
          kind: "candidate",
          iteration: index,
          candidateIndex: candIdx,
          fingerprint: cState.fingerprint ?? undefined,
          proposalFingerprint: iter.proposalFingerprint ?? undefined,
          win: selection.win,
          scores: cState.scores,
          usage: {totalTokens: cState.totalTokens},
          reasons: selection.reasons,
        }, ledger);
        log(`[hloop] iter ${index}: candidate ${candIdx + 1} ${selection.win ? "WINS" : "loses"} — ${selection.reasons[0] ?? ""}`);
        persist();
      }
      iter.phase = "decide";
      persist();
    }

    // (6) apply the first winner (or record the proposal as rejected).
    if (iter.phase === "decide") {
      const winners = iter.candidates.filter((c) => c.win === true);
      if (winners.length === 0) {
        const scoredCandidates = iter.candidates.filter((c) => c.scores !== null);
        const best = [...scoredCandidates].sort((a, b) => (b.scores!.passCount - a.scores!.passCount) || (a.totalTokens - b.totalTokens))[0];
        appendProposalRejectedEntry({
          runId,
          proposalFingerprint: iter.proposalFingerprint ?? "",
          candidateFingerprints: iter.candidates.map((c) => c.fingerprint ?? "").filter((f) => f !== ""),
          scores: best?.scores ?? {passCount: 0, total: 0},
          usage: {totalTokens: best?.totalTokens ?? 0},
          reasons: iter.candidates.flatMap((c) => (c.win === false ? c.reasons.slice(0, 2) : [])),
          ledgerPath: ledger,
        });
        for (const c of iter.candidates) if (c.decision === "pending") c.decision = "loser";
        iter.decision = "no-winner";
        log(`[hloop] iter ${index}: no candidate won — proposal recorded as rejected`);
      } else {
        const winner = winners[0]!;
        const allCandidates: ProposedCandidate[] = iter.candidates
          .filter((c) => c.verdict === "accepted")
          .map((c) => ({rationale: c.rationale, edits: c.edits, fingerprint: c.fingerprint, verdict: c.verdict, reasons: c.reasons}));
        const winnerCandidate: ProposedCandidate = {
          rationale: winner.rationale,
          edits: winner.edits,
          fingerprint: winner.fingerprint,
          verdict: "accepted",
          reasons: [],
        };
        log(`[hloop] iter ${index}: applying winning candidate ${winner.index + 1} (dryRun: ${state.config.dryRun})...`);
        const applied = applyCandidate({
          candidates: allCandidates,
          winner: winnerCandidate,
          runId,
          config: runConfig,
          scores: winner.scores ?? undefined,
          usage: {totalTokens: winner.totalTokens},
          agentDir: opts.agentDir,
          ledgerPath: ledger,
        });
        if (applied.decision === "applied") {
          winner.decision = "winner-applied";
          iter.decision = "applied";
        } else if (applied.decision === "dry-run") {
          winner.decision = "winner-dry-run";
          iter.decision = "dry-run";
        } else if (applied.decision === "rejected") {
          winner.decision = "apply-rejected";
          iter.decision = "apply-rejected";
          // Feed the apply-time rejection into the proposer's dedupe digest.
          appendProposalRejectedEntry({
            runId,
            proposalFingerprint: iter.proposalFingerprint ?? "",
            candidateFingerprints: iter.candidates.map((c) => c.fingerprint ?? "").filter((f) => f !== ""),
            scores: winner.scores ?? {passCount: 0, total: 0},
            usage: {totalTokens: winner.totalTokens},
            reasons: applied.reasons,
            ledgerPath: ledger,
          });
        } else {
          winner.decision = "apply-failed";
          iter.decision = "apply-failed";
        }
        log(`[hloop] iter ${index}: apply outcome ${applied.decision}${applied.reasons.length > 0 ? ` — ${applied.reasons.join("; ")}` : ""}`);
        // Additional winners (beyond the first) were not applied.
        for (const c of iter.candidates) {
          if (c.win === true && c.decision === "pending") c.decision = "winner-not-applied";
        }
      }
      iter.phase = "done";
      persist();
    }
  };

  try {
    while (true) {
      const last = state.iterations[state.iterations.length - 1];
      // Resume point: a non-done trailing iteration is redone in place (its
      // on-disk partial results are reused); a done one means the next index.
      const nextIndex = last === undefined ? 1 : last.phase === "done" ? last.index + 1 : last.index;
      if (nextIndex > state.config.maxIterations) return finish("completed", "iterations-reached");
      if (existsSync(stopFlagPath)) return finish("stopped", "stop-flag");
      if (state.budgetSpent >= state.config.maxTotalTokens) return finish("stopped", "budget-exceeded");
      await runIteration(nextIndex);
    }
  } catch (err) {
    if (err instanceof LoopAbort) {
      log(`[hloop] stopping: ${err.reason}`);
      return finish("stopped", err.reason);
    }
    const message = err instanceof Error ? err.message : String(err);
    state.status = "failed";
    state.stopReason = message;
    persist();
    log(`[hloop] run failed: ${message}`);
    return {
      ok: false,
      runId,
      status: "failed",
      stopReason: message,
      budgetSpent: state.budgetSpent,
      iterationsCompleted: state.iterations.filter((i) => i.phase === "done").length,
      statePath,
    };
  }
}

// ---------------------------------------------------------------------------
// Selftest — state-machine checks with fakes. No real model calls, no real
// probes; every path lives under a temp dir.

// ---------------------------------------------------------------------------
// CLI

function selftestUsage(): number {
  console.error("usage: bun run loop/driver.ts selftest");
  return 2;
}

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "selftest") {
    const {runSelftest} = await import("./driver-selftest.ts");
    process.exitCode = await runSelftest();
  } else {
    process.exitCode = selftestUsage();
  }
}
