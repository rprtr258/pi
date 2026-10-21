#!/usr/bin/env bun
/**
 * Unit tests for ledger.ts renderReport (Step 12): the failure-excerpts
 * section must distinguish SUSPECTED PROBE FAILURES (pass=false with null or
 * zero token usage — the nested run never produced model events) from real
 * task failures (checker output against a real trajectory).
 *
 *   bun test loop/lib/ledger.test.ts
 */
import {describe, expect, test} from "bun:test";
import {renderReport, type RunReportData, type ReportTask} from "./ledger.ts";

function task(overrides: Partial<ReportTask>): ReportTask {
  return {task: "t", category: "cat", pass: true, durationMs: 1000, tokens: 5000, ...overrides};
}

function data(tasks: ReportTask[]): RunReportData {
  return {
    runId: "r1",
    ts: "2026-01-01T00:00:00Z",
    kind: "baseline",
    model: null,
    fingerprint: null,
    tasks,
    aggregate: {passCount: tasks.filter((t) => t.pass).length, total: tasks.length, totalTokens: tasks.reduce((s, t) => s + t.tokens, 0)},
  };
}

describe("renderReport zero-usage flag (Step 12)", () => {
  test("pass=false with zero tokens is flagged as a suspected probe failure", () => {
    const report = renderReport(data([
      task({task: "probe-broke", pass: false, tokens: 0, checkerOutput: ""}),
      task({task: "healthy-pass"}),
    ]));
    expect(report).toContain("## Failure excerpts");
    expect(report).toContain("### probe-broke");
    expect(report).toContain("suspected probe failure (no usage events)");
  });

  test("pass=false with a usage object but zero totalTokens is flagged too", () => {
    const report = renderReport(data([task({task: "zero-tokens", pass: false, tokens: 0, checkerOutput: "checker failed"}), task({task: "ok"})]));
    expect(report).toContain("### zero-tokens");
    expect(report).toContain("suspected probe failure (no usage events)");
    // Checker output excerpt is still shown alongside the flag.
    expect(report).toContain("checker failed");
  });

  test("a real task failure (tokens > 0) is NOT flagged", () => {
    const report = renderReport(data([task({task: "real-fail", pass: false, tokens: 4200, checkerOutput: "assert: file missing"})]));
    expect(report).toContain("### real-fail");
    expect(report).not.toContain("suspected probe failure");
  });

  test("a zero-usage failure without checker output is still listed (flag carries the diagnosis)", () => {
    const report = renderReport(data([task({task: "spawn-dead", pass: false, tokens: 0, checkerOutput: ""})]));
    expect(report).toContain("### spawn-dead");
    expect(report).toContain("suspected probe failure (no usage events)");
    expect(report).not.toContain("~~~"); // no empty code fence
  });

  test("passing and non-failed tasks never appear in the failure section", () => {
    const report = renderReport(data([task({task: "fine", pass: true, tokens: 0})]));
    expect(report).not.toContain("## Failure excerpts");
    expect(report).not.toContain("suspected probe failure");
  });
});
