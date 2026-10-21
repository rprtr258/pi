/**
 * Role models + recursion-mode resolution for the harness self-improvement
 * loop (Step 11).
 *
 * ROLES: the run resolves the role→model map ONCE per run (loop/driver.ts
 * runLoop start) and persists it in state.json + the report header. Each
 * role's absent/unset value = the SESSION model (the stage.ts captureModel
 * default — exactly what every pre-S11 path used):
 *   - proposer → the Proposer model call (loop/lib/proposer.ts); threaded as
 *     `options.model` on the injected CallModel (fakes ignore it; the real
 *     adapter in index.ts callModelViaRegistry resolves it).
 *   - judge → the LLM judge (loop/lib/judge.ts via replay.ts calibration +
 *     replay channel). Judge calibration is KEYED BY THIS MODEL:
 *     isCalibrated(ledger, minAgreement, judgeModel) only trusts a
 *     calibration entry recorded for THAT judge model (a different judge
 *     model = not calibrated — the agreement was never measured with it).
 *   - probe → nested-pi probe rollouts (scoreSuite → runProbe --model) AND
 *     the model field hashed into the baseline fingerprint
 *     (loop/baseline.ts fingerprintSnapshot): baselines and candidates are
 *     always compared under the SAME resolved probe model, so configuring a
 *     probe role model invalidates (and re-keys) the baseline cache once.
 *
 * RECURSION MODES: per-iteration resolution, highest precedence first —
 *   1. explicit CLI --mode (the user always wins over auto behavior)
 *   2. post-targeted-confirmation: the PREVIOUS iteration ran targeted AND
 *      auto-applied its winner (decision "applied" or the dry-run
 *      equivalent "dry-run" — the candidate cleared selection on a subset,
 *      so the next iteration must re-measure on the FULL suite)
 *   3. auto-switch (mode.auto): the previous iteration's baseline had ≥1
 *      failing task → the next iteration targets them
 *   4. the config default (mode.default).
 */
import type {LoopConfig} from "./apply.ts";

// ---------------------------------------------------------------------------
// Role models

/** Role → resolved model (null = the session model). */
export interface RoleModels {
  /** Resolved Proposer model; null = session model. */
  proposer: string | null;
  /** Resolved LLM-judge model; null = session model. Calibration key. */
  judge: string | null;
  /** Resolved probe-rollout model; null = session model. Also the fingerprint model. */
  probe: string | null;
}

/**
 * Resolve the role→model map: a configured non-empty string wins; absent,
 * unset, or empty values fall back to `sessionModel` (null = pi default).
 * Pure — unit-tested directly (roles.test.ts).
 */
export function resolveRoleModels(roles: LoopConfig["roles"], sessionModel: string | null): RoleModels {
  const pick = (value: string | undefined): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : sessionModel;
  return {
    proposer: pick(roles.proposer),
    judge: pick(roles.judge),
    probe: pick(roles.probe),
  };
}

// ---------------------------------------------------------------------------
// Recursion modes

export type LoopMode = "surface" | "targeted";

export type ModeResolutionReason = "explicit-flag" | "post-targeted-confirmation" | "auto-switch" | "config-default";

/** What the previous iteration left behind (null when none completed yet). */
export interface PreviousIterationModeInput {
  /** The mode that iteration ran with. */
  mode: LoopMode;
  /** The iteration decision ("applied" | "dry-run" | "no-winner" | ...). */
  decision: string | null;
  /** Failing-task count in that iteration's baseline/probe results. */
  taskFailures: number;
}

export interface ResolveModeInput {
  /** CLI --mode flag (highest precedence; wins over every auto behavior). */
  explicit?: LoopMode;
  /** Config mode section (defaults + auto-switch toggle). */
  config: {default: LoopMode; auto: boolean};
  /** Previous iteration summary; null for the first iteration. */
  previous: PreviousIterationModeInput | null;
}

/**
 * Per-iteration mode resolution (pure — unit-tested directly). See the file
 * header for the precedence chain. A targeted AUTO-APPLY (the previous
 * targeted iteration's decision was "applied" or "dry-run" — the winner
 * cleared subset selection and was auto-applied / would have been) forces
 * the next iteration to the full suite ("post-targeted-confirmation"); an
 * explicit --mode overrides even that.
 */
export function resolveIterationMode(input: ResolveModeInput): {mode: LoopMode; reason: ModeResolutionReason} {
  if (input.explicit !== undefined) return {mode: input.explicit, reason: "explicit-flag"};
  const prev = input.previous;
  if (prev !== null && prev.mode === "targeted" && (prev.decision === "applied" || prev.decision === "dry-run")) {
    return {mode: "surface", reason: "post-targeted-confirmation"};
  }
  if (input.config.auto && prev !== null && prev.taskFailures >= 1) {
    return {mode: "targeted", reason: "auto-switch"};
  }
  return {mode: input.config.default, reason: "config-default"};
}
