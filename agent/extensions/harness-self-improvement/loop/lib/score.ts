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
export interface TaskScoreResult {
  task: string;
  category: string;
  pass: boolean;
  durationMs: number;
  /** pi usage object; null when the nested run produced no usage events. */
  usage: ProbeUsage | null;
  /** Nested pi exit code (null when killed by signal or never exited). */
  exit: number | null;
  /** Resolved pi binary the nested run used (see probe.ts resolvePiBinary); absent on resumed pre-3 results. */
  piBinary?: {bin: string; version: string | null} | null;
  timedOut: boolean;
  /** Full checker stdout+stderr (kept for report failure excerpts). */
  checkerOutput: string;
  stderrExcerpt: string | null;
  /** Assistant trajectory of the nested run (kept for later diff steps). */
  trajectory: string;
}

export interface SuiteAggregate {
  passCount: number;
  total: number;
  /** Budget metric: sum of per-task usage.totalTokens (0 when usage is null). */
  totalTokens: number;
}

export interface ScoreSuiteOptions {
  /** Optional `--model` override passed through to every nested pi run. */
  model?: string;
}

export interface ScoreSuiteResult {
  results: TaskScoreResult[];
  aggregate: SuiteAggregate;
}

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

export interface PairedTaskDelta {
  task: string;
  basePass: boolean;
  candPass: boolean;
  baseTokens: number;
  candTokens: number;
  flip: Flip;
}

export interface PairedDeltaAggregates {
  /** cand passCount - base passCount over paired tasks. */
  passDelta: number;
  /** Number of pass→fail flips (the veto signal). */
  regressions: number;
  baseTotalTokens: number;
  candTotalTokens: number;
  /** candTotalTokens / baseTotalTokens; null when the base used 0 tokens. */
  tokenRatio: number | null;
}

export interface PairedDelta {
  perTask: PairedTaskDelta[];
  aggregates: PairedDeltaAggregates;
}

/**
 * Pair base and candidate results by task name. Tasks present in only one
 * list are skipped (a pair needs both sides); base order is preserved.
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
  return {
    perTask,
    aggregates: {
      passDelta: perTask.filter((d) => d.candPass).length - perTask.filter((d) => d.basePass).length,
      regressions: perTask.filter((d) => d.flip === "pass-to-fail").length,
      baseTotalTokens,
      candTotalTokens,
      tokenRatio: baseTotalTokens > 0 ? candTotalTokens / baseTotalTokens : null,
    },
  };
}
