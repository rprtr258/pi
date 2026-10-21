#!/usr/bin/env bun
/**
 * Baseline scoring for the harness self-improvement loop.
 *
 * scoreSuite runs every suite task against a caller-staged sandbox, writing one result JSON
 * per task into <runDir>/tasks/<task-name>.json as soon as it completes — the
 * crash-safe resume basis for a later step: when the result file already
 * exists for the run, it is reused instead of re-probing.
 *
 * pairedDelta turns two result lists (baseline vs candidate) into per-task
 * flips plus the aggregates later steps use for the pass/regression veto and
 * the token-budget comparison. Budget metric is usage.totalTokens (cost.total
 * is always 0 on this gateway).
 */
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runProbe, type ProbeUsage} from "./probe.ts";
import type {LoadedTask} from "./suite.ts";

/** Scored outcome of one suite task. Serializes to <runDir>/tasks/<task>.json. */
export type TaskScoreResult = {
  task: string,
  category: string,
  pass: boolean,
  durationMs: number,
  /** pi usage object; null when the nested run produced no usage events. */
  usage: ProbeUsage | null,
  /** Nested pi exit code (null when killed by signal or never exited). */
  exit: number | null,
  /** Resolved pi binary the nested run used (see probe.ts resolvePiBinary); absent on resumed pre-3 results. */
  piBinary?: {bin: string, version: string | null} | null,
  timedOut: boolean,
  /** Full checker stdout+stderr (kept for report failure excerpts). */
  checkerOutput: string,
  stderrExcerpt: string | null,
  /** Assistant trajectory of the nested run (kept for later diff steps). */
  trajectory: string,
  /**
   * Resume binding written by the loop driver (see loop/driver.ts): a
   * `<runDir>/tasks/<task>.json` file is reused on resume only when its
   * boundTo matches the requesting (run, iteration, candidate) identity.
   * Absent in pre-S6 result files and in baseline-cache payloads.
   */
  boundTo?: string,
};

export type SuiteAggregate = {
  passCount: number,
  total: number,
  /** Budget metric: sum of per-task usage.totalTokens (0 when usage is null). */
  totalTokens: number,
};

/** Step 10: wall-time + concurrency stats for one scoreSuite run. */
export type ProbeRunStats = {
  /** Tasks in the suite (probed + reused). */
  tasks: number,
  /** Tasks actually probed this run (non-reused). */
  probed: number,
  /** Tasks served from an existing result file (resume). */
  reused: number,
  /** Highest number of probes observed in flight (≤ options.concurrency). */
  maxObservedConcurrency: number,
  /** Wall time of the whole scoreSuite call (includes resume reads). */
  wallMs: number,
}

/** Injectable probe implementation (the driver's selftest fakes this). */
export type RunProbeFn = typeof runProbe;

export type ScoreSuiteOptions = {
  /** Optional `--model` override passed through to every nested pi run. */
  model?: string,
  /** Probe implementation override (tests inject a fake); defaults to runProbe. */
  runProbeFn?: RunProbeFn,
  /**
   * Resume binding (loop/driver.ts): when set, an existing
   * `<runDir>/tasks/<task>.json` is reused only if its `boundTo` equals this
   * value — results from another run/iteration/candidate are re-probed.
   */
  boundTo?: string,
  /**
   * Step 10: max probes in flight WITHIN this suite run (same candidate
   * sandbox). Candidates themselves stay sequential (the driver scores them
   * one at a time) — only tasks inside one sandbox run concurrently. 1 (the
   * default) = serial. Every probe additionally gets its own isolated TMPDIR
   * (see RunProbeOptions.tmpDir) so concurrent checkers cannot collide in
   * the shared system temp dir.
   */
  concurrency?: number,
};

export type ScoreSuiteResult = {
  results: TaskScoreResult[],
  aggregate: SuiteAggregate,
  /** Wall-time + concurrency stats (Step 10; rendered into report.md). */
  stats: ProbeRunStats,
};

function aggregateOf(results: TaskScoreResult[]): SuiteAggregate {
  return {
    passCount: results.filter((r) => r.pass).length,
    total: results.length,
    totalTokens: results.reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0),
  };
}

/** True when `value` looks like a TaskScoreResult for `taskName`. */
function isReusableResult(value: unknown, taskName: string): value is TaskScoreResult {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.task === taskName && typeof v.pass === "boolean" && typeof v.durationMs === "number";
}

/**
 * Run every task against `sandboxDir`, writing per-task result JSON
 * incrementally. A task whose <runDir>/tasks/<name>.json already exists (same
 * run resumed after a crash) is reused without re-probing; corrupt or
 * mismatched result files are overwritten by a fresh probe.
 *
 * Step 10: with options.concurrency > 1, up to that many probes run
 * concurrently INSIDE this suite run (same sandbox; candidates stay
 * sequential — the driver never parallelizes across candidates/sandboxes).
 * Results are order-independent: the returned array follows the input task
 * order, per-task durationMs measures that task's own probe (never the wall
 * time), and every field except durationMs is identical to the serial run on
 * the same suite + probe data (regression-tested in score.test.ts).
 */
export async function scoreSuite(tasks: LoadedTask[], sandboxDir: string, runDir: string, options: ScoreSuiteOptions = {}): Promise<ScoreSuiteResult> {
  const started = performance.now();
  const tasksDir = join(runDir, "tasks");
  const wsRoot = join(runDir, "ws");
  mkdirSync(tasksDir, {recursive: true});
  mkdirSync(wsRoot, {recursive: true});
  const probe = options.runProbeFn ?? runProbe;
  const results: Array<TaskScoreResult | undefined> = new Array(tasks.length);
  const pending: Array<{task: LoadedTask, index: number}> = [];
  let reused = 0;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const resultPath = join(tasksDir, `${task.name}.json`);
    if (existsSync(resultPath)) {
      try {
        const cached = JSON.parse(readFileSync(resultPath, "utf8")) as unknown;
        // When boundTo is set, the result must also carry the same binding —
        // a result file from another run/iteration/candidate is never reused.
        if (isReusableResult(cached, task.name) && (options.boundTo === undefined || cached.boundTo === options.boundTo)) {
          console.log(`[score] ${task.name}: reused existing result (resume)`);
          results[i] = cached;
          reused++;
          continue;
        }
      } catch {
        // Corrupt result file: fall through and re-probe.
      }
    }
    pending.push({task, index: i});
  }
  let probed = 0;
  let maxObservedConcurrency = 0;
  let failure: unknown = null;
  if (pending.length > 0) {
    // Worker pool: exactly min(concurrency, pending) workers pull from the
    // shared queue, so the in-flight cap is enforced structurally. A probe
    // error (e.g. the driver budget guard's abort) stops NEW spawns
    // immediately; in-flight probes finish and their results (real spend)
    // are still written and budget-accounted before the error rethrows.
    const limit = Math.max(1, Math.min(options.concurrency ?? 1, pending.length));
    let next = 0;
    let inFlight = 0;
    const runOne = async (item: {task: LoadedTask, index: number}): Promise<void> => {
      // Per-probe TMPDIR isolation (Step 10): each probe — nested pi AND its
      // checker — sees its own temp dir, unique per probe, cleaned up after.
      const probeTmpDir = mkdtempSync(join(tmpdir(), "harness-probe-tmp-"));
      try {
        const probeStarted = performance.now();
        const probeResult = await probe(item.task, sandboxDir, join(wsRoot, item.task.name), {
          timeoutS: item.task.meta?.timeoutS,
          model: options.model,
          // Sibling of the workspace, never inside it: checkers must not see it.
          rawJsonlPath: join(wsRoot, `${item.task.name}.raw.jsonl`),
          tmpDir: probeTmpDir,
        });
        const result: TaskScoreResult = {
          task: item.task.name,
          category: item.task.category,
          pass: probeResult.checkerResult.pass,
          // Per-task duration, not wall time: parallel results stay comparable
          // to serial ones (task-level duration semantics unchanged).
          durationMs: Math.round(performance.now() - probeStarted),
          usage: probeResult.usage,
          exit: probeResult.exit,
          piBinary: probeResult.piBinary,
          timedOut: probeResult.timedOut,
          checkerOutput: probeResult.checkerResult.output,
          stderrExcerpt: probeResult.stderrExcerpt,
          trajectory: probeResult.trajectory,
        };
        if (options.boundTo !== undefined) result.boundTo = options.boundTo;
        // Written as soon as the task completes: a crash between probes
        // leaves every completed task's result on disk for resume.
        writeFileSync(join(tasksDir, `${item.task.name}.json`), `${JSON.stringify(result, null, 2)}\n`);
        console.log(`[score] ${item.task.name}: ${result.pass ? "PASS" : "FAIL"} (${result.durationMs}ms, ${result.usage?.totalTokens ?? 0} tokens)`);
        results[item.index] = result;
        probed++;
      } finally {
        rmSync(probeTmpDir, {recursive: true, force: true});
      }
    };
    const worker = async (): Promise<void> => {
      while (failure === null) {
        const i = next++;
        if (i >= pending.length) return;
        inFlight++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlight);
        try {
          await runOne(pending[i]!);
        } catch (err) {
          failure = err; // stop spawning; other in-flight probes finish first
        } finally {
          inFlight--;
        }
      }
    };
    await Promise.all(Array.from({length: limit}, () => worker()));
  }
  if (failure !== null) throw failure;
  const filled = results as TaskScoreResult[]; // failure === null ⇒ every slot filled
  return {
    results: filled,
    aggregate: aggregateOf(filled),
    stats: {tasks: tasks.length, probed, reused, maxObservedConcurrency, wallMs: Math.round(performance.now() - started)},
  };
}

// ---------------------------------------------------------------------------
// Paired deltas (baseline vs candidate)

export type Flip = "fail-to-pass" | "pass-to-fail" | null;

export type PairedTaskDelta = {
  task: string,
  basePass: boolean,
  candPass: boolean,
  baseTokens: number,
  candTokens: number,
  flip: Flip,
};

export type PairedDeltaAggregates = {
  /** cand passCount - base passCount over paired tasks. */
  passDelta: number,
  /** Number of pass→fail flips (the veto signal). */
  regressions: number,
  baseTotalTokens: number,
  candTotalTokens: number,
  /** candTotalTokens / baseTotalTokens; null when the base used 0 tokens. */
  tokenRatio: number | null,
  /** Number of tasks present on both sides (the pairs aggregated above). */
  pairedCount: number,
  /** Task names present on only one side, base order first then cand order. */
  unpaired: string[],
};

export type PairedDelta = {
  perTask: PairedTaskDelta[],
  aggregates: PairedDeltaAggregates,
};

/**
 * Selection thresholds (subset of LoopConfig in loop/lib/apply.ts; passed
 * separately so selection stays decoupled from apply machinery).
 */
export type SelectionConfig = {
  /** Minimum passDelta for a straight pass-count win. */
  minWin: number,
  /**
   * Minimum relative duration improvement required for a pass-equal candidate
   * to win; null disables the duration branch entirely (the DEFAULT: a
   * pass-equal candidate NEVER wins by default). Improvement is defined as
   * (sum of paired base durations − sum of paired cand durations) /
   * sum of paired base durations; undefined (null) when the base total
   * duration is 0.
   */
  minQualityGain: number | null,
  /** Maximum allowed candTotalTokens / baseTotalTokens (veto above it). */
  usageFactor: number,
}

export type SelectionResult = {
  win: boolean,
  /** ALL reasons, both why-win and why-not — never just a boolean. */
  reasons: string[],
}

/**
 * Decide whether the candidate run wins over the baseline run (Step 5).
 *
 * WIN iff ALL of:
 *   1. aggregates.passDelta ≥ minWin, OR (passDelta === 0 AND
 *      minQualityGain !== null AND duration improvement ≥ minQualityGain —
 *      duration branch, see SelectionConfig.minQualityGain; disabled by
 *      default since the default minQualityGain is null)
 *   2. aggregates.regressions === 0 (pass→fail flips are an absolute veto)
 *   3. tokenRatio === null OR tokenRatio ≤ usageFactor
 *   4. aggregates.unpaired is empty (the candidate must be scored on the
 *      exact same suite; a partial run is refused outright)
 *
 * Durations are re-paired here (by task name, pairs only) because
 * pairedDelta deliberately carries tokens but not durations.
 */
export function selectWinner(baselineResults: TaskScoreResult[], candidateResults: TaskScoreResult[], config: SelectionConfig): SelectionResult {
  const reasons: string[] = [];
  const delta = pairedDelta(baselineResults, candidateResults);
  const agg = delta.aggregates;

  if (agg.unpaired.length > 0) {
    reasons.push(`REFUSE: unpaired tasks (candidate must be scored on the same suite): ${agg.unpaired.join(", ")}`);
  }

  const baseDurByName = new Map(baselineResults.map((r) => [r.task, r.durationMs]));
  const candDurByName = new Map(candidateResults.map((r) => [r.task, r.durationMs]));
  const paired = delta.perTask;
  const baseTotalDurationMs = paired.reduce((sum, d) => sum + (baseDurByName.get(d.task) ?? 0), 0);
  const candTotalDurationMs = paired.reduce((sum, d) => sum + (candDurByName.get(d.task) ?? 0), 0);

  // Branch 1: pass-count win or (pass-equal) duration win.
  let passWin = false;
  let durationWin = false;
  if (agg.passDelta >= config.minWin) {
    passWin = true;
    reasons.push(`WIN-MET: pass delta ${agg.passDelta} ≥ minWin ${config.minWin}`);
  } else if (agg.passDelta !== 0) {
    // Below minWin AND not pass-equal (covers negative deltas and
    // 0 < passDelta < minWin): the duration branch is pass-equal only, so a
    // fast partial pass improvement must never win here.
    reasons.push(`NOT-WIN: pass delta ${agg.passDelta} is below minWin ${config.minWin} and not pass-equal`);
  } else if (config.minQualityGain === null) {
    reasons.push("NOT-WIN: pass-equal (passDelta 0) and minQualityGain is null — pass-equal candidates never win by default");
  } else if (baseTotalDurationMs <= 0) {
    reasons.push(`NOT-WIN: pass-equal (passDelta 0), but duration improvement cannot be evaluated (base total duration is ${baseTotalDurationMs}ms)`);
  } else {
    const improvement = (baseTotalDurationMs - candTotalDurationMs) / baseTotalDurationMs;
    if (improvement >= config.minQualityGain) {
      durationWin = true;
      reasons.push(`WIN-MET: duration improvement ${(improvement * 100).toFixed(1)}% (base ${baseTotalDurationMs}ms → cand ${candTotalDurationMs}ms) ≥ minQualityGain ${config.minQualityGain}`);
    } else {
      reasons.push(`NOT-WIN: duration improvement ${(improvement * 100).toFixed(1)}% (base ${baseTotalDurationMs}ms → cand ${candTotalDurationMs}ms) < minQualityGain ${config.minQualityGain}`);
    }
  }

  // Branch 2: regression veto.
  if (agg.regressions !== 0) {
    reasons.push(`VETO: ${agg.regressions} regression(s) (pass→fail flips)`);
  }

  // Branch 3: token budget veto.
  if (agg.tokenRatio === null) {
    reasons.push(`token ratio unknown (base used 0 tokens over ${agg.pairedCount} paired tasks) — token veto skipped`);
  } else if (agg.tokenRatio > config.usageFactor) {
    reasons.push(`VETO: token ratio ${agg.tokenRatio.toFixed(2)} > usageFactor ${config.usageFactor} (base ${agg.baseTotalTokens} → cand ${agg.candTotalTokens} tokens)`);
  }

  const win = (passWin || durationWin) && agg.regressions === 0 && (agg.tokenRatio === null || agg.tokenRatio <= config.usageFactor) && agg.unpaired.length === 0;
  return {win, reasons};
}

/**
 * Pair base and candidate results by task name. Tasks present in only one
 * list are excluded from the pairs (a pair needs both sides) but reported in
 * aggregates.unpaired; base order is preserved.
 */
export function pairedDelta(baseResults: TaskScoreResult[], candResults: TaskScoreResult[]): PairedDelta {
  const candByName = new Map(candResults.map((r) => [r.task, r]));
  const perTask: PairedTaskDelta[] = [];
  for (const base of baseResults) {
    const cand = candByName.get(base.task);
    if (cand === undefined) continue;
    const baseTokens = base.usage?.totalTokens ?? 0;
    const candTokens = cand.usage?.totalTokens ?? 0;
    perTask.push({
      task: base.task,
      basePass: base.pass,
      candPass: cand.pass,
      baseTokens,
      candTokens,
      flip: !base.pass && cand.pass ? "fail-to-pass" : base.pass && !cand.pass ? "pass-to-fail" : null,
    });
  }
  const baseTotalTokens = perTask.reduce((sum, d) => sum + d.baseTokens, 0);
  const candTotalTokens = perTask.reduce((sum, d) => sum + d.candTokens, 0);
  const paired = new Set(perTask.map((d) => d.task));
  return {
    perTask,
    aggregates: {
      passDelta: perTask.filter((d) => d.candPass).length - perTask.filter((d) => d.basePass).length,
      regressions: perTask.filter((d) => d.flip === "pass-to-fail").length,
      baseTotalTokens,
      candTotalTokens,
      tokenRatio: baseTotalTokens > 0 ? candTotalTokens / baseTotalTokens : null,
      pairedCount: perTask.length,
      unpaired: [
        ...baseResults.filter((r) => !paired.has(r.task)).map((r) => r.task),
        ...candResults.filter((r) => !paired.has(r.task)).map((r) => r.task),
      ],
    },
  };
}
