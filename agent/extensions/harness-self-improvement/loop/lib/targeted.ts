/**
 * Targeted-iteration subset selection for the harness self-improvement loop
 * (Step 11).
 *
 * A targeted iteration probes only a SUBSET of the suite:
 *   - the FAILING subset: tasks that failed in the latest full-suite baseline
 *     (the driver's per-iteration baseline IS the latest full-suite
 *     measurement — it is cache-served when the snapshot is unchanged and
 *     freshly probed whenever an applied candidate changed it, so "latest
 *     full baseline" and "last iteration's full results" coincide here), plus
 *   - a deterministic REGRESSION SAMPLE of currently-passing tasks, so a
 *     candidate that fixes the failures cannot silently break passing tasks.
 *
 * REGRESSION-SAMPLE FORMULA (documented, deterministic — same inputs and
 * iteration index always produce the same sample, which makes resume
 * reproduce the exact same subset):
 *   1. passing = the task names that passed in the full baseline, sorted
 *      ascending (UTF-16 code-unit order — never localeCompare).
 *   2. k = min(targeted.sampleSize, passing.length): a sampleSize larger
 *      than the passing count takes ALL passing tasks.
 *   3. offset = iterationIndex mod passing.length (the iteration-index seed).
 *   4. picks = the task at index (offset + floor(i * passing.length / k))
 *      mod passing.length, for i = 0 … k−1 — k evenly-spaced picks starting
 *      at the offset (a rotating start keeps consecutive iterations from
 *      always sampling the same tasks). With k ≤ passing.length the picks
 *      are distinct; when passing.length === 0 the sample is empty.
 *   The selection is evaluated on the UNION (failing ∪ sample): the driver
 *   scores the candidate on the union and pairs it against the SAME union
 *   cut of the cached full-suite baseline with the normal selectWinner rule
 *   (a candidate must clear passDelta on the union; any pass→fail flip on
 *   the regression sample is a veto, exactly as on a full suite).
 */
export type TargetedSelection = {
  /** Task names that failed in the full baseline (sorted ascending). */
  failing: string[],
  /** Deterministic regression sample from the passing tasks (sorted ascending). */
  regressionSample: string[],
  /** failing ∪ regressionSample (sorted ascending) — the probe + selection set. */
  union: string[],
}

/**
 * Compute the targeted subset for one iteration. `baselineResults` is the
 * latest full-suite baseline (every suite task present); `sampleSize` is
 * config.targeted.sampleSize; `iterationIndex` seeds the sample rotation.
 * Pure — unit-tested directly (targeted.test.ts).
 */
export function selectTargetedTasks(baselineResults: Array<{task: string, pass: boolean}>, sampleSize: number, iterationIndex: number): TargetedSelection {
  const sorted = [...baselineResults].sort((a, b) => (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
  const failing = sorted.filter((r) => !r.pass).map((r) => r.task);
  const passing = sorted.filter((r) => r.pass).map((r) => r.task);
  const regressionSample = regressionSampleOf(passing, sampleSize, iterationIndex);
  const union = [...new Set([...failing, ...regressionSample])].sort();
  return {failing, regressionSample, union};
}

/**
 * The documented regression-sample formula (see the file header): k
 * evenly-spaced picks from the sorted passing names, rotated by the
 * iteration-index offset. sampleSize ≥ passing.length → ALL passing tasks.
 */
export function regressionSampleOf(passing: string[], sampleSize: number, iterationIndex: number): string[] {
  const sorted = [...passing].sort();
  if (sorted.length === 0 || sampleSize < 1) return [];
  const n = sorted.length;
  const k = Math.min(sampleSize, n);
  const offset = ((iterationIndex % n) + n) % n; // non-negative for any index
  const picks: string[] = [];
  for (let i = 0; i < k; i++) {
    const index = (offset + Math.floor((i * n) / k)) % n;
    const name = sorted[index]!;
    if (!picks.includes(name)) picks.push(name);
  }
  return picks.sort();
}
