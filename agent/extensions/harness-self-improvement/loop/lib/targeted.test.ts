#!/usr/bin/env bun
/**
 * Unit tests for Step 11 targeted-iteration subset selection
 * (loop/lib/targeted.ts) and the selection-on-union math (the normal
 * selectWinner rule applied to the union cut of the baseline).
 *
 *   bun test loop/lib/targeted.test.ts
 */
import {describe, expect, test} from "bun:test";
import {regressionSampleOf, selectTargetedTasks} from "./targeted.ts";
import {selectWinner, type SelectionConfig, type TaskScoreResult} from "./score.ts";

const SELECTION: SelectionConfig = {minWin: 1, minQualityGain: null, usageFactor: 1.5};

function result(task: string, pass: boolean, tokens = 100): TaskScoreResult {
  return {
    task,
    category: "smoke",
    pass,
    durationMs: 10,
    usage: {input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
    exit: 0,
    timedOut: false,
    checkerOutput: pass ? "" : "checker failed",
    stderrExcerpt: null,
    trajectory: "",
  };
}

const BASELINE = [
  result("t-a", false),
  result("t-b", true),
  result("t-c", false),
  result("t-d", true),
  result("t-e", true),
  result("t-f", true),
  result("t-g", true),
  result("t-h", true),
];

describe("regressionSampleOf", () => {
  test("deterministic: same inputs + iteration index → same sample", () => {
    const passing = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    expect(regressionSampleOf(passing, 4, 3)).toEqual(regressionSampleOf(passing, 4, 3));
    expect(regressionSampleOf([...passing].reverse(), 4, 3)).toEqual(regressionSampleOf(passing, 4, 3)); // sorted internally
  });

  test("seeded by iteration index: a different index rotates the picks", () => {
    const passing = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    expect(regressionSampleOf(passing, 4, 0)).toEqual(["p1", "p3", "p5", "p7"]);
    expect(regressionSampleOf(passing, 4, 1)).toEqual(["p2", "p4", "p6", "p8"]);
  });

  test("sampleSize ≥ passing count → ALL passing tasks", () => {
    const passing = ["p1", "p2", "p3"];
    expect(regressionSampleOf(passing, 6, 0)).toEqual(["p1", "p2", "p3"]);
    expect(regressionSampleOf(passing, 3, 5)).toEqual(["p1", "p2", "p3"]);
  });

  test("no passing tasks or sampleSize < 1 → empty sample", () => {
    expect(regressionSampleOf([], 6, 0)).toEqual([]);
    expect(regressionSampleOf(["p1"], 0, 0)).toEqual([]);
  });
});

describe("selectTargetedTasks", () => {
  test("failing subset + deterministic sample form the union", () => {
    const sel = selectTargetedTasks(BASELINE, 2, 0);
    expect(sel.failing).toEqual(["t-a", "t-c"]);
    // 6 passing, sample 2, offset 0 → picks at floor(i*6/2) = 0, 3 → t-b, t-f.
    expect(sel.regressionSample).toEqual(["t-b", "t-f"]);
    expect(sel.union).toEqual(["t-a", "t-b", "t-c", "t-f"]);
  });

  test("sampleSize larger than the passing count takes every passing task", () => {
    const sel = selectTargetedTasks(BASELINE, 100, 1);
    expect(sel.regressionSample).toEqual(["t-b", "t-d", "t-e", "t-f", "t-g", "t-h"]);
    expect(sel.union).toEqual(["t-a", "t-b", "t-c", "t-d", "t-e", "t-f", "t-g", "t-h"]); // full suite
  });

  test("determinism: identical inputs + index reproduce the exact union (resume-safe)", () => {
    expect(selectTargetedTasks(BASELINE, 6, 4)).toEqual(selectTargetedTasks([...BASELINE].reverse(), 6, 4));
  });
});

describe("selection on the targeted union (selectWinner applied to the union cut)", () => {
  test("win: passDelta cleared on the union (subset fixed, sample intact)", () => {
    const base = [result("fail-1", false), result("fail-2", false), result("pass-1", true), result("pass-2", true)];
    const sel = selectTargetedTasks(base, 2, 0);
    const union = new Set(sel.union);
    const baseUnion = base.filter((r) => union.has(r.task));
    // Candidate fixes both failing tasks; the sampled passing tasks stay green.
    const cand = baseUnion.map((r) => result(r.task, true));
    const out = selectWinner(baseUnion, cand, SELECTION);
    expect(out.win).toBe(true);
    expect(out.reasons.some((r) => r.startsWith("WIN-MET"))).toBe(true);
  });

  test("veto: a regression on the regression sample vetoes the win", () => {
    const base = [result("fail-1", false), result("pass-1", true), result("pass-2", true)];
    const sel = selectTargetedTasks(base, 2, 0);
    const union = new Set(sel.union);
    const baseUnion = base.filter((r) => union.has(r.task));
    // Fixes fail-1 but breaks a sampled passing task → passDelta 0 + regression veto.
    const cand = [
      result("fail-1", true),
      result("pass-1", false),
      result("pass-2", true),
    ];
    const out = selectWinner(baseUnion, cand, SELECTION);
    expect(out.win).toBe(false);
    expect(out.reasons.some((r) => r.includes("VETO") && r.includes("regression"))).toBe(true);
  });

  test("no win when the failing subset is only partially fixed (passDelta below minWin 2)", () => {
    const base = [result("fail-1", false), result("fail-2", false), result("pass-1", true)];
    const sel = selectTargetedTasks(base, 1, 0);
    const union = new Set(sel.union);
    const baseUnion = base.filter((r) => union.has(r.task));
    const cand = [
      result("fail-1", true),
      result("fail-2", false),
      result("pass-1", true),
    ];
    // Union passDelta +1 is below minWin 2 → no win (subset wins must clear
    // the same threshold as full-suite wins).
    const out = selectWinner(baseUnion, cand, {...SELECTION, minWin: 2});
    expect(out.win).toBe(false);
    expect(out.reasons.some((r) => r.includes("minWin 2"))).toBe(true);
  });
});
