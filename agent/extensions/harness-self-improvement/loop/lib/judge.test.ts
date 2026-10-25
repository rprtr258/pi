#!/usr/bin/env bun
/**
 * Unit tests for the LLM judge (Step 7): parse/clamp/abstain matrix with
 * fakes, prompt build caps, judgeTrajectory error handling, and the
 * suite-agreement computation + calibration wiring in replay.ts (fixtures
 * only — no real model calls).
 *
 *   bun test loop/lib/judge.test.ts
 */
import {describe, expect, test} from "bun:test";
import {
  ABSTAIN_SCORE,
  PROMPT_CAP_CHARS,
  RATIONALE_MAX_CHARS,
  TRAJECTORY_CAP_CHARS,
  WORKSPACE_CAP_CHARS,
  buildJudgePrompt,
  judgeSystemPrompt,
  judgeTrajectory,
  parseJudgeVerdict,
  type JudgeVerdict,
} from "./judge.ts";
import {computeAgreement, isCalibrated} from "./replay.ts";
import type {LedgerEntry as BaseLedgerEntry} from "./ledger.ts";

// ---------------------------------------------------------------------------
// parseJudgeVerdict — the parse/clamp/abstain matrix

function verdictOf(text: string): JudgeVerdict {
  return parseJudgeVerdict(text);
}

describe("parseJudgeVerdict", () => {
  test("plain JSON object accepted", () => {
    const v = verdictOf('{"score": 7, "rationale": "goal done"}');
    expect(v).toEqual({score: 7, rationale: "goal done", abstained: false});
  });

  test("fenced json block accepted", () => {
    const v = verdictOf(' preamble\n```json\n{"score": 3, "rationale": "partial"}\n```\n trailing');
    expect(v).toEqual({score: 3, rationale: "partial", abstained: false});
  });

  test("bare object inside prose accepted (outermost span)", () => {
    const v = verdictOf('The verdict is {"score": 0, "rationale": "abandoned"} as scored.');
    expect(v.score).toBe(0);
    expect(v.abstained).toBe(false);
  });

  test("boundary scores 0 and 10 are in range", () => {
    expect(verdictOf('{"score": 0, "rationale": ""}').abstained).toBe(false);
    expect(verdictOf('{"score": 10, "rationale": ""}').abstained).toBe(false);
  });

  test("numeric string score accepted", () => {
    const v = verdictOf('{"score": "8", "rationale": "fine"}');
    expect(v).toEqual({score: 8, rationale: "fine", abstained: false});
  });

  test("out-of-range score → abstain with neutral 5", () => {
    for (const bad of ["-1", "11", "85", "100"]) {
      const v = verdictOf(`{"score": ${bad}, "rationale": "x"}`);
      expect(v.score).toBe(ABSTAIN_SCORE);
      expect(v.abstained).toBe(true);
    }
  });

  test("non-numeric score → abstain", () => {
    const v = verdictOf('{"score": "high", "rationale": "x"}');
    expect(v.score).toBe(ABSTAIN_SCORE);
    expect(v.abstained).toBe(true);
  });

  test("missing score → abstain", () => {
    const v = verdictOf('{"rationale": "forgot the score"}');
    expect(v.score).toBe(ABSTAIN_SCORE);
    expect(v.abstained).toBe(true);
  });

  test("explicit null score = model abstain, rationale kept", () => {
    const v = verdictOf('{"score": null, "rationale": "abstain: empty trajectory"}');
    expect(v.score).toBe(ABSTAIN_SCORE);
    expect(v.rationale).toBe("abstain: empty trajectory");
    expect(v.abstained).toBe(true);
  });

  test("NaN/Infinity score → abstain (not JSON-parseable numbers anyway)", () => {
    expect(verdictOf('{"score": NaN, "rationale": "x"}').abstained).toBe(true);
  });

  test("no JSON at all → abstain", () => {
    const v = verdictOf("I think the run was good.");
    expect(v.score).toBe(ABSTAIN_SCORE);
    expect(v.abstained).toBe(true);
  });

  test("rationale truncated to 200 chars; missing rationale → empty string", () => {
    const long = "r".repeat(500);
    expect(verdictOf(`{"score": 5, "rationale": "${long}"}`).rationale.length).toBe(RATIONALE_MAX_CHARS);
    expect(verdictOf('{"score": 5}').rationale).toBe("");
  });

  test("empty string output → abstain", () => {
    expect(verdictOf("").abstained).toBe(true);
  });

  test("first valid fenced block wins over later garbage", () => {
    const v = verdictOf('```json\n{"score": 6, "rationale": "a"}\n```\nand also {"score": 999}');
    expect(v.score).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Prompt build + caps

describe("buildJudgePrompt", () => {
  test("contains the three sections verbatim-ish and marks empty trajectory", () => {
    const built = buildJudgePrompt({prompt: "do X", trajectory: "", workspaceState: "(none)"}, "RUBRIC");
    expect(built.system).toBe("RUBRIC");
    expect(built.user).toContain("## ORIGINAL PROMPT");
    expect(built.user).toContain("## TRAJECTORY");
    expect(built.user).toContain("(empty — consider abstaining per the rubric)");
    expect(built.user).toContain("## WORKSPACE STATE");
    expect(built.user).toContain("do X");
  });

  test("trajectory/workspace tails are capped at the documented caps", () => {
    const bigTraj = "t".repeat(TRAJECTORY_CAP_CHARS + 5000);
    const bigWs = "w".repeat(WORKSPACE_CAP_CHARS + 5000);
    const built = buildJudgePrompt({prompt: "p".repeat(PROMPT_CAP_CHARS + 5000), trajectory: bigTraj, workspaceState: bigWs}, "R");
    expect(built.user.length).toBeLessThan(PROMPT_CAP_CHARS + TRAJECTORY_CAP_CHARS + WORKSPACE_CAP_CHARS + 5000);
    expect(built.user).toContain("truncated");
  });
});

// ---------------------------------------------------------------------------
// judgeTrajectory with fake callModel

const TEMPLATE = judgeSystemPrompt();

describe("judgeTrajectory", () => {
  test("passes rubric system prompt + user content to callModel; parses verdict", async () => {
    const calls: Array<{system: string, user: string, options?: {temperature?: number, maxTokens?: number}}> = [];
    const v = await judgeTrajectory(
      {prompt: "write foo.txt", trajectory: "assistant did it", workspaceState: "foo.txt exists"},
      {callModel: async (system, user, options) => {
        calls.push({system, user, options});
        return '{"score": 9, "rationale": "clean"}';
      }, systemPromptTemplate: TEMPLATE},
    );
    expect(v).toEqual({score: 9, rationale: "clean", abstained: false});
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain("Score rubric");
    expect(calls[0]!.user).toContain("write foo.txt");
    expect(calls[0]!.options?.temperature).toBe(0);
  });

  test("model throws → abstain verdict, never throws", async () => {
    const v = await judgeTrajectory(
      {prompt: "p", trajectory: "t", workspaceState: "w"},
      {callModel: async () => {
        throw new Error("gateway down");
      }, systemPromptTemplate: TEMPLATE},
    );
    expect(v.abstained).toBe(true);
    expect(v.score).toBe(ABSTAIN_SCORE);
    expect(v.rationale).toContain("gateway down");
  });

  test("model returns garbage → abstain", async () => {
    const v = await judgeTrajectory(
      {prompt: "p", trajectory: "t", workspaceState: "w"},
      {callModel: async () => "score was pretty good I guess", systemPromptTemplate: TEMPLATE},
    );
    expect(v.abstained).toBe(true);
    expect(v.score).toBe(ABSTAIN_SCORE);
  });
});

// ---------------------------------------------------------------------------
// computeAgreement + isCalibrated (fixtures)

describe("computeAgreement", () => {
  test("empty rows → null agreement", () => {
    expect(computeAgreement([])).toEqual({agreement: null, matches: 0, total: 0, abstained: 0});
  });

  test("binarizes judge ≥ 7 vs checker verdict", () => {
    const rows = [
      {checkerPass: true, judgeScore: 8},   // agree
      {checkerPass: true, judgeScore: 5},   // disagree (judge fail, checker pass)
      {checkerPass: false, judgeScore: 3},  // agree
      {checkerPass: false, judgeScore: 7},  // disagree (judge pass, checker fail)
      {checkerPass: true, judgeScore: 7},   // agree (boundary)
    ];
    const result = computeAgreement(rows);
    expect(result.total).toBe(5);
    expect(result.matches).toBe(3);
    expect(result.agreement).toBeCloseTo(0.6);
  });

  test("perfect agreement fixture", () => {
    const rows = [
      {checkerPass: true, judgeScore: 9},
      {checkerPass: false, judgeScore: 2},
    ];
    expect(computeAgreement(rows).agreement).toBe(1);
  });

  test("abstained rows are excluded from the denominator and reported separately", () => {
    const rows = [
      {checkerPass: true, judgeScore: 8, abstained: false},   // agree
      {checkerPass: true, judgeScore: 5, abstained: true},    // abstained — excluded
      {checkerPass: false, judgeScore: 3, abstained: false},  // agree
    ];
    const result = computeAgreement(rows);
    expect(result.total).toBe(2);
    expect(result.matches).toBe(2);
    expect(result.abstained).toBe(1);
    expect(result.agreement).toBe(1);
  });

  test("all rows abstained → null agreement", () => {
    const rows = [{checkerPass: false, judgeScore: 5, abstained: true}];
    expect(computeAgreement(rows)).toEqual({agreement: null, matches: 0, total: 0, abstained: 1});
  });
});

describe("isCalibrated", () => {
  /** Ledger entry fixture carrying the gate fields (sample + condition). */
  const entry = (kind: string, agreement: unknown, extra: Record<string, unknown> = {}): BaseLedgerEntry =>
    ({runId: "r", ts: "t", kind, agreement, sample: 8, condition: "fresh", ...extra} as unknown as BaseLedgerEntry);

  test("calibrated when latest judge-calibration agreement ≥ threshold", () => {
    const entries: BaseLedgerEntry[] = [
      entry("baseline", undefined),
      entry("judge-calibration", 0.75),
      entry("judge-calibration", 0.9),
    ] as unknown as BaseLedgerEntry[];
    expect(isCalibrated(entries)).toEqual({calibrated: true, agreement: 0.9, ts: "t"});
  });

  test("advisory below threshold, and respects a custom minAgreement", () => {
    const entries: BaseLedgerEntry[] = [entry("judge-calibration", 0.6)] as unknown as BaseLedgerEntry[];
    expect(isCalibrated(entries).calibrated).toBe(false);
    const mid: BaseLedgerEntry[] = [entry("judge-calibration", 0.85)] as unknown as BaseLedgerEntry[];
    expect(isCalibrated(mid).calibrated).toBe(true);
    expect(isCalibrated(mid, 0.9).calibrated).toBe(false);
  });

  test("no calibration entries → not calibrated, null agreement", () => {
    expect(isCalibrated([entry("baseline", undefined)] as unknown as BaseLedgerEntry[])).toEqual({calibrated: false, agreement: null, ts: null});
    expect(isCalibrated([]).calibrated).toBe(false);
  });

  test("malformed agreement field is skipped, earlier valid entry wins", () => {
    const entries: BaseLedgerEntry[] = [
      entry("judge-calibration", 0.9),
      entry("judge-calibration", "not-a-number"),
    ] as unknown as BaseLedgerEntry[];
    const gate = isCalibrated(entries);
    expect(gate.agreement).toBe(0.9);
    expect(gate.calibrated).toBe(true);
  });

  test("sample below MIN_CALIBRATION_SAMPLE (8) never calibrates", () => {
    const entries: BaseLedgerEntry[] = [entry("judge-calibration", 1, {sample: 7})] as unknown as BaseLedgerEntry[];
    expect(isCalibrated(entries)).toEqual({calibrated: false, agreement: 1, ts: "t"});
  });

  test("cache-only calibration (condition cached-trajectories) never calibrates", () => {
    const entries: BaseLedgerEntry[] = [entry("judge-calibration", 1, {condition: "cached-trajectories"})] as unknown as BaseLedgerEntry[];
    expect(isCalibrated(entries)).toEqual({calibrated: false, agreement: 1, ts: "t"});
  });

  test("legacy entries without a sample field stay advisory (fail-closed)", () => {
    const legacy = {runId: "r", ts: "t", kind: "judge-calibration", agreement: 1} as unknown as BaseLedgerEntry;
    expect(isCalibrated([legacy]).calibrated).toBe(false);
  });
});
