#!/usr/bin/env bun
/**
 * Unit tests for Step 10 winner composition (loop/lib/merge.ts): disjoint
 * merges, per-file conflict resolution by rank, composed-out records, the
 * single-winner / fully-overlapping no-op rules, and strictest-threshold
 * inheritance for mixed-kind compositions.
 *
 *   bun test loop/lib/merge.test.ts
 */
import {describe, expect, test} from "bun:test";
import {composeWinners, compositionSelectionConfig, type WinnerInput} from "./merge.ts";
import type {SelectionConfig} from "./score.ts";

const edit = (path: string, content: string) => ({path, content});

const BASE_SELECTION: SelectionConfig = {minWin: 1, minQualityGain: null, usageFactor: 1.5};

function winner(candidateIdx: number, rationale: string, ...edits: Array<{path: string; content: string}>): WinnerInput {
  return {candidateIdx, rationale, edits};
}

describe("composeWinners", () => {
  test("disjoint winners compose both files with correct per-file attribution", () => {
    const composition = composeWinners([
      winner(0, "fix agents", edit("AGENTS.md", "# A0")),
      winner(2, "add a skill", edit("skills/extra/SKILL.md", "# S")),
    ]);
    expect(composition).not.toBeNull();
    expect(composition!.edits).toEqual([edit("AGENTS.md", "# A0"), edit("skills/extra/SKILL.md", "# S")]);
    expect(composition!.sources).toEqual([0, 2]);
    expect(composition!.fileAttribution).toEqual({"AGENTS.md": 0, "skills/extra/SKILL.md": 2});
    expect(composition!.composedOut).toEqual([]);
    expect(composition!.rationale).toBe("fix agents; add a skill");
    expect(composition!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("conflict: rank-1 candidate supplies the file, the other keeps its other files (per-file resolution)", () => {
    const composition = composeWinners([
      winner(0, "cand zero", edit("AGENTS.md", "# zero wins")),
      winner(1, "cand one", edit("AGENTS.md", "# one loses"), edit("prompts/extra.md", "hello")),
    ]);
    expect(composition).not.toBeNull();
    // AGENTS.md content comes from the higher-ranked candidate (index 0);
    // cand-1's non-conflicting prompts/extra.md still merges.
    expect(composition!.edits).toEqual([edit("AGENTS.md", "# zero wins"), edit("prompts/extra.md", "hello")]);
    expect(composition!.fileAttribution).toEqual({"AGENTS.md": 0, "prompts/extra.md": 1});
    expect(composition!.sources).toEqual([0, 1]);
    // The partial candidate is recorded as composed-out with dropped + kept files.
    expect(composition!.composedOut).toEqual([{candidateIdx: 1, filesDropped: ["AGENTS.md"], filesKept: ["prompts/extra.md"]}]);
  });

  test("three-way conflict: best rank wins the file, lower ranks composed-out where they lose", () => {
    const composition = composeWinners([
      winner(1, "one", edit("AGENTS.md", "# one"), edit("prompts/one.md", "o")),
      winner(0, "zero", edit("AGENTS.md", "# zero"), edit("prompts/z.md", "z")),
      winner(2, "two", edit("AGENTS.md", "# two"), edit("skills/t/SKILL.md", "# t")),
    ]);
    expect(composition).not.toBeNull();
    // Rank by candidate index, NOT by list position: index 0 beats 1 and 2 on
    // the conflicting AGENTS.md; the non-conflicting files all merge.
    expect(composition!.edits).toEqual([
      edit("AGENTS.md", "# zero"),
      edit("prompts/z.md", "z"),
      edit("prompts/one.md", "o"),
      edit("skills/t/SKILL.md", "# t"),
    ]);
    expect(composition!.fileAttribution["AGENTS.md"]).toBe(0);
    expect(composition!.composedOut).toEqual([
      {candidateIdx: 1, filesDropped: ["AGENTS.md"], filesKept: ["prompts/one.md"]},
      {candidateIdx: 2, filesDropped: ["AGENTS.md"], filesKept: ["skills/t/SKILL.md"]},
    ]);
  });

  test("all-winners-conflict-on-one-path: only rank-1 contributes → no composition (null)", () => {
    const composition = composeWinners([
      winner(1, "one", edit("AGENTS.md", "# one")),
      winner(0, "zero", edit("AGENTS.md", "# zero")),
      winner(2, "two", edit("AGENTS.md", "# two")),
    ]);
    // The merge would equal the rank-0 winner's own edits: re-probing it
    // would re-derive the same candidate — the driver must take the
    // single-winner path instead.
    expect(composition).toBeNull();
  });

  test("returns null for a single winner", () => {
    expect(composeWinners([winner(0, "only", edit("AGENTS.md", "# A"))])).toBeNull();
    expect(composeWinners([])).toBeNull();
  });

  test("fully-overlapping winners: nothing to compose (merge equals rank-1's edits)", () => {
    const composition = composeWinners([
      winner(0, "zero", edit("AGENTS.md", "# zero")),
      winner(1, "one", edit("AGENTS.md", "# one")),
    ]);
    expect(composition).toBeNull(); // single-winner path must be taken instead
  });

  test("composition is deterministic: same winners in rank order → same output", () => {
    const input = [
      winner(0, "zero", edit("AGENTS.md", "# zero")),
      winner(1, "one", edit("AGENTS.md", "# one"), edit("prompts/p.md", "p")),
    ];
    const a = composeWinners(structuredClone(input));
    const b = composeWinners(structuredClone(input));
    expect(a).toEqual(b);
  });
});

describe("compositionSelectionConfig", () => {
  test("code+markdown composition inherits the strictest threshold (code.minWin)", () => {
    const composition = composeWinners([
      winner(0, "code", edit("extensions/sample/index.ts", "export {};\n")),
      winner(1, "prose", edit("AGENTS.md", "# prose")),
    ])!;
    const cfg = compositionSelectionConfig(composition, BASE_SELECTION, 2);
    expect(cfg.minWin).toBe(2); // code.minWin, not the global minWin 1
    expect(cfg.minQualityGain).toBeNull();
    expect(cfg.usageFactor).toBe(1.5);
  });

  test("mcp+markdown composition is code-bearing too", () => {
    const composition = composeWinners([
      winner(0, "mcp", edit("mcp.json", '{"mcpServers":{}}')),
      winner(1, "prose", edit("prompts/p.md", "p")),
    ])!;
    expect(compositionSelectionConfig(composition, BASE_SELECTION, 3).minWin).toBe(3);
  });

  test("markdown-only composition keeps the global minWin", () => {
    const composition = composeWinners([
      winner(0, "agents", edit("AGENTS.md", "# A")),
      winner(1, "prompt", edit("prompts/p.md", "p")),
    ])!;
    expect(compositionSelectionConfig(composition, BASE_SELECTION, 2).minWin).toBe(1);
  });
});
