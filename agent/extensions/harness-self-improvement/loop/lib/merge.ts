#!/usr/bin/env bun
/**
 * Winner composition (Step 10): merge multiple selection winners of one loop
 * iteration into a single composed candidate.
 *
 * CONTRACT (enforced by the driver, tested in merge.test.ts +
 * driver-selftest.ts):
 *   - Composition applies when MORE THAN ONE candidate wins the same
 *     iteration. Per FILE resolution: a path proposed by 2+ winners is
 *     supplied by the higher-ranked winner (lower candidate index = better
 *     proposal order); the lower-ranked winner's OTHER (non-conflicting)
 *     files still merge.
 *   - A lower-ranked winner that lost ≥1 file to a conflict is ledgered by
 *     the driver as kind "composed-out" {candidateIdx, filesDropped,
 *     filesKept}; its dropped file is attributed to the winning candidate.
 *   - HARD RULE (merge→re-probe→apply): the composed candidate is only a
 *     PROPOSAL. The driver must re-probe it AS A WHOLE (fresh composed
 *     sandbox, same gates for code/mcp-bearing merges, full suite, and an
 *     INDEPENDENT selectWinner vs baseline) before any apply decision. If
 *     the composed candidate fails, the driver falls back to the best single
 *     winner. This module never applies anything — it only builds the merge.
 *   - Selection threshold inheritance: a composition inherits the STRICTEST
 *     threshold among its constituent kinds — any code/mcp-bearing merged
 *     edit (extensions kind or mcp kind) makes the whole composition
 *     code-bearing, i.e. code.minWin instead of minWin. Because composition
 *     is rank-1-wins per path and every conflicting path is still present in
 *     the merge (attributed to its winner), the merged edit set's kinds equal
 *     the union of the constituents' kinds — so the strictest threshold is
 *     exactly selectionConfigForEdits over the MERGED edits
 *     (compositionSelectionConfig below).
 *
 * Pure module: no I/O, no ledger writes, deterministic output for a given
 * winner list. RANK = the candidate index (proposal order, lower = better);
 * the input list is sorted by candidateIdx internally, so callers may pass
 * winners in any order.
 */
import {candidateFingerprint} from "./proposer.ts";
import type {ProposedEdit} from "./proposer.ts";
import {selectionConfigForEdits} from "./gates.ts";
import type {SelectionConfig} from "./score.ts";

/** One selection winner, in rank order (index 0 = best rank). */
export type WinnerInput = {
  /** Candidate index within the proposal — also the RANK (lower = better). */
  candidateIdx: number,
  rationale: string,
  edits: ProposedEdit[],
}

/** A lower-ranked winner that lost ≥1 file to a higher-ranked one. */
export type ComposedOutRecord = {
  candidateIdx: number,
  /** Paths this winner proposed but a higher-ranked winner supplied. */
  filesDropped: string[],
  /** Paths this winner still contributed to the composition. */
  filesKept: string[],
}

/** The composed candidate built by composeWinners. */
export type Composition = {
  /**
   * Merged edits, deterministic: winners in rank order, each winner's own
   * edit order preserved, conflicting paths only once (from the best rank).
   */
  edits: ProposedEdit[],
  /** Rationales of the CONTRIBUTING winners (≥1 file kept), joined with "; ". */
  rationale: string,
  /** Candidate indices that contributed ≥1 file, ascending. */
  sources: number[],
  /** path → supplying candidateIdx (per-file attribution). */
  fileAttribution: Record<string, number>,
  /** Lower-ranked winners that lost ≥1 file to a conflict, in rank order. */
  composedOut: ComposedOutRecord[],
  /** sha256 over the merged edits (candidateFingerprint; apply/ledger use). */
  fingerprint: string,
}

/**
 * Merge the iteration's winners into one composed candidate.
 *
 * Returns null when composition is pointless and the caller must take the
 * unchanged single-winner path instead:
 *   - fewer than 2 winners, or
 *   - every non-first winner lost ALL its files to conflicts with the
 *     rank-1 winner (the merge would equal the rank-1 winner's own edits —
 *     a re-probe would burn tokens to re-derive the same candidate).
 * The rank-1 winner can never lose a file (it is checked first), so it is
 * always a source when composition happens.
 */
export function composeWinners(winners: WinnerInput[]): Composition | null {
  if (winners.length < 2) return null;
  // Rank = candidate index (proposal order): sort so conflicts always resolve
  // to the lower candidateIdx regardless of the caller's list order.
  const ranked = [...winners].sort((a, b) => a.candidateIdx - b.candidateIdx);
  // Defensive: duplicate candidateIdx values are a caller bug (two winners
  // claiming the same rank) — the per-candidate bookkeeping maps would merge
  // them silently, so refuse the merge.
  if (ranked.some((w, i) => i > 0 && w.candidateIdx === ranked[i - 1]!.candidateIdx)) return null;
  const supplied = new Map<string, {content: string | null, sourceIdx: number}>();
  const keptBySource = new Map<number, string[]>();
  const droppedBySource = new Map<number, string[]>();
  const mergedEdits: ProposedEdit[] = [];
  for (const winner of ranked) {
    for (const edit of winner.edits) {
      const existing = supplied.get(edit.path);
      if (existing !== undefined) {
        // Conflict: the higher-ranked (earlier-checked) winner already owns
        // this path; the file is attributed to it and dropped from here.
        const dropped = droppedBySource.get(winner.candidateIdx) ?? [];
        dropped.push(edit.path);
        droppedBySource.set(winner.candidateIdx, dropped);
        continue;
      }
      supplied.set(edit.path, {content: edit.content, sourceIdx: winner.candidateIdx});
      mergedEdits.push(edit);
      const kept = keptBySource.get(winner.candidateIdx) ?? [];
      kept.push(edit.path);
      keptBySource.set(winner.candidateIdx, kept);
    }
  }
  const sources = ranked.map((w) => w.candidateIdx).filter((idx) => (keptBySource.get(idx) ?? []).length > 0);
  if (sources.length < 2) return null; // rank-1 keeps everything → single-winner path
  const fileAttribution: Record<string, number> = {};
  for (const [path, entry] of supplied) fileAttribution[path] = entry.sourceIdx;
  return {
    edits: mergedEdits,
    rationale: ranked
      .filter((w) => (keptBySource.get(w.candidateIdx) ?? []).length > 0)
      .map((w) => w.rationale)
      .join("; "),
    sources,
    fileAttribution,
    composedOut: ranked
      .filter((w) => (droppedBySource.get(w.candidateIdx) ?? []).length > 0)
      .map((w) => ({
        candidateIdx: w.candidateIdx,
        filesDropped: droppedBySource.get(w.candidateIdx) ?? [],
        filesKept: keptBySource.get(w.candidateIdx) ?? [],
      })),
    fingerprint: candidateFingerprint(mergedEdits),
  };
}

/**
 * Selection thresholds for the composed candidate: composition of allowed
 * kinds inherits the STRICTEST threshold among constituent kinds — any
 * code/mcp-bearing merged edit (extensions kind or mcp.json) makes the whole
 * composition code-bearing (code.minWin), otherwise the global minWin
 * applies. Reuses gates.ts selectionConfigForEdits over the MERGED edits,
 * which is equivalent because the merged path set equals the union of the
 * constituents' paths (conflicts keep the path, only its content changes).
 */
export function compositionSelectionConfig(composition: Composition, base: SelectionConfig, codeMinWin: number): SelectionConfig {
  return selectionConfigForEdits(composition.edits, base, codeMinWin);
}
