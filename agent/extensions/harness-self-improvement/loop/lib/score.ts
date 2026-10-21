#!/usr/bin/env bun
/**
 * Baseline scoring for the harness self-improvement loop.
 *
 * scoreSuite runs every suite task (serial execution; parallelism is a later
 * step) with runProbe against a caller-staged sandbox, writing one result JSON
 * per task into <runDir>/tasks/<task-name>.json as soon as it completes — the
 * crash-safe resume basis for a later step: when the result file already
 * exists for the run, it is reused instead of re-probing.
 *
 * pairedDelta turns two result lists (baseline vs candidate) into per-task
 * flips plus the aggregates later steps use for the pass/regression veto and
 * the token-budget comparison. Budget metric is usage.totalTokens (cost.total
 * is always 0 on this gateway).
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
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
};

export type SuiteAggregate = {
  passCount: number,
  total: number,
  /** Budget metric: sum of per-task usage.totalTokens (0 when usage is null). */
  totalTokens: number,
};

export type ScoreSuiteOptions = {
  /** Optional `--model` override passed through to every nested pi run. */
  model?: string,
};

export type ScoreSuiteResult = {
  results: TaskScoreResult[],
  aggregate: SuiteAggregate,
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
 * Run every task serially against `sandboxDir`, writing per-task result JSON
 * incrementally. A task whose <runDir>/tasks/<name>.json already exists (same
 * run resumed after a crash) is reused without re-probing; corrupt or
 * mismatched result files are overwritten by a fresh probe.
 */
export async function scoreSuite(tasks: LoadedTask[], sandboxDir: string, runDir: string, options: ScoreSuiteOptions = {}): Promise<ScoreSuiteResult> {
  const tasksDir = join(runDir, "tasks");
  const wsRoot = join(runDir, "ws");
  mkdirSync(tasksDir, {recursive: true});
  mkdirSync(wsRoot, {recursive: true});
  const results: TaskScoreResult[] = [];
  for (const task of tasks) {
    const resultPath = join(tasksDir, `${task.name}.json`);
    if (existsSync(resultPath)) {
      try {
        const cached = JSON.parse(readFileSync(resultPath, "utf8")) as unknown;
        if (isReusableResult(cached, task.name)) {
          console.log(`[score] ${task.name}: reused existing result (resume)`);
          results.push(cached);
          continue;
        }
      } catch {
        // Corrupt result file: fall through and re-probe.
      }
    }
    const started = performance.now();
    const probe = await runProbe(task, sandboxDir, join(wsRoot, task.name), {
      timeoutS: task.meta?.timeoutS,
      model: options.model,
      // Sibling of the workspace, never inside it: checkers must not see it.
      rawJsonlPath: join(wsRoot, `${task.name}.raw.jsonl`),
    });
    const result: TaskScoreResult = {
      task: task.name,
      category: task.category,
      pass: probe.checkerResult.pass,
      durationMs: Math.round(performance.now() - started),
      usage: probe.usage,
      exit: probe.exit,
      piBinary: probe.piBinary,
      timedOut: probe.timedOut,
      checkerOutput: probe.checkerResult.output,
      stderrExcerpt: probe.stderrExcerpt,
      trajectory: probe.trajectory,
    };
    // Written before moving on: a crash between probes leaves every completed
    // task's result on disk for resume.
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`[score] ${task.name}: ${result.pass ? "PASS" : "FAIL"} (${result.durationMs}ms, ${result.usage?.totalTokens ?? 0} tokens)`);
    results.push(result);
  }
  return {results, aggregate: aggregateOf(results)};
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
