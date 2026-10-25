#!/usr/bin/env bun
/**
 * Auto-apply + revert for the harness self-improvement loop (Step 5).
 *
 * SAFETY CONTRACT (this module is the only place that writes to the live
 * agent config):
 *   - The target directory is `agentDir`, DEFAULTING TO the real
 *     ~/.pi/agent. Tests NEVER rely on the default: every test passes an
 *     `agentDir` override pointing at a temp-dir copy of a fake config git
 *     repo, and a `ledgerPath` override pointing at a temp ledger. No test
 *     may ever write to the real ~/.pi/agent or the real run-history.jsonl.
 *   - Paths are re-validated through proposer.ts's validation pipeline
 *     (validateCandidate: allowlist AGENTS.md / skills/<dir>/SKILL.md |
 *     scripts/<file>, no traversal, size caps) immediately before apply —
 *     the caller's earlier validation is never trusted on its own.
 *   - Git staging uses EXPLICIT PATHS ONLY ("AGENTS.md", "skills/") — never
 *     -A, ., or --all, so nothing outside the loop's scope can be committed.
 *   - Prior state of every affected path is snapshotted BEFORE any write; if
 *     a file write, `git add`, or `git commit` fails, all writes are rolled
 *     back (prior content restored / created files deleted) and the staged
 *     index is reset, before "apply-failed" is reported.
 *   - Dry-run mode (config.apply.dryRun, DEFAULT TRUE via loop/config.json)
 *     computes and returns the full per-file diff preview and appends a
 *     kind "apply-dryrun" ledger entry without touching any file.
 *
 * CONFIG DEFAULTS (loop/config.json; JSON has no comments — documented here
 * and to be expanded in loop/README.md later):
 *   {
 *     "minWin": 1,            // min passDelta for a straight pass win
 *     "minQualityGain": null, // null = pass-equal candidates never win
 *     "usageFactor": 1.5,     // max candTokens / baseTokens ratio
 *     "apply": {"dryRun": true}
 *   }
 *   loadLoopConfig() is tolerant: missing file → defaults; invalid JSON or
 *   wrong-typed fields → default for that field + a console warning.
 *
 * LEDGER SHAPES appended here (see proposer.ts buildLedgerDigest for what it
 * reads — decision entries with decision "rejected" are read by the digest):
 *   kind "apply":            {runId, ts, decision: "applied"|"rejected"|
 *                             "apply-failed", reasons, files, sha?,
 *                             proposalFingerprint?, scores?, usage?}
 *   kind "apply-dryrun":     same minus sha, decision omitted (kind says it)
 *   kind "proposal-rejected":{runId, ts, proposalFingerprint, scores, usage,
 *                             reasons, candidateFingerprints?} — EXACTLY the
 *                             shape proposer.ts's buildLedgerDigest reads.
 */
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {validateCandidate, proposalFingerprintOf, type ProposedCandidate, type ProposedEdit} from "./proposer.ts";
import {appendEntry, ledgerPath, type LedgerEntry} from "./ledger.ts";

// ---------------------------------------------------------------------------
// Config

export interface LoopConfig {
  /** Minimum passDelta for a straight pass-count win (see selectWinner). */
  minWin: number;
  /**
   * Minimum relative duration improvement for a pass-equal candidate to win.
   * null (the default) disables the duration branch: pass-equal candidates
   * NEVER win by default.
   */
  minQualityGain: number | null;
  /** Maximum allowed candTotalTokens / baseTotalTokens ratio. */
  usageFactor: number;
  apply: {
    /** true (default): never touch files, only return the diff preview. */
    dryRun: boolean;
  };
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  minWin: 1,
  minQualityGain: null,
  usageFactor: 1.5,
  apply: {dryRun: true},
};

function defaultConfigPath(): string {
  return fileURLToPath(new URL("../config.json", import.meta.url));
}

function warnField(name: string, reason: string): void {
  console.warn(`[apply] loop/config.json: ignoring ${name} (${reason}) — using default`);
}

/**
 * Tolerant loader: missing file → defaults (silent); invalid JSON → defaults
 * + warning; per-field type validation with per-field fallback to the
 * default + warning. Never throws.
 */
export function loadLoopConfig(path: string = defaultConfigPath()): LoopConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return DEFAULT_LOOP_CONFIG; // missing file is normal (first run)
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[apply] loop/config.json is invalid JSON (${err instanceof Error ? err.message : String(err)}) — using defaults`);
    return DEFAULT_LOOP_CONFIG;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn("[apply] loop/config.json is not a JSON object — using defaults");
    return DEFAULT_LOOP_CONFIG;
  }
  const cfg: LoopConfig = {...DEFAULT_LOOP_CONFIG, apply: {...DEFAULT_LOOP_CONFIG.apply}};
  const p = parsed as Record<string, unknown>;
  if (p["minWin"] === undefined) {
    // keep default
  } else if (typeof p["minWin"] === "number" && Number.isFinite(p["minWin"])) {
    cfg.minWin = p["minWin"];
  } else {
    warnField("minWin", "not a finite number");
  }
  if (p["minQualityGain"] === undefined) {
    // keep default
  } else if (p["minQualityGain"] === null || (typeof p["minQualityGain"] === "number" && Number.isFinite(p["minQualityGain"]))) {
    cfg.minQualityGain = p["minQualityGain"];
  } else {
    warnField("minQualityGain", "not null or a finite number");
  }
  if (p["usageFactor"] === undefined) {
    // keep default
  } else if (typeof p["usageFactor"] === "number" && Number.isFinite(p["usageFactor"]) && p["usageFactor"] > 0) {
    cfg.usageFactor = p["usageFactor"];
  } else {
    warnField("usageFactor", "not a finite number > 0");
  }
  const apply = p["apply"];
  if (apply === undefined) {
    // keep default
  } else if (apply !== null && typeof apply === "object" && !Array.isArray(apply) && typeof (apply as Record<string, unknown>)["dryRun"] === "boolean") {
    cfg.apply.dryRun = (apply as Record<string, boolean>)["dryRun"]!;
  } else {
    warnField("apply.dryRun", "not an object with a boolean dryRun");
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Types

export interface ApplyCandidateInput {
  /** All candidates of the proposal (used for the proposalFingerprint). */
  candidates: ProposedCandidate[];
  /** The candidate selected by selectWinner; its edits are applied. */
  winner: ProposedCandidate;
  runId: string;
  config: LoopConfig;
  /**
   * Override the agent config dir. DEFAULT is the REAL ~/.pi/agent — tests
   * MUST pass a temp-dir override; nothing in this module enforces it
   * (enforcement would break the one legitimate live-apply call site).
   */
  agentDir?: string;
  /** Override the ledger file; default run-history.jsonl. Tests override. */
  ledgerPath?: string;
  /** Optional run scores recorded on the ledger entry when available. */
  scores?: {passCount: number; total: number};
  usage?: {totalTokens: number};
}

export interface ApplyFilePreview {
  /** Path relative to agentDir (POSIX-style, as proposed). */
  path: string;
  action: "create" | "write" | "delete";
  bytesBefore: number | null;
  bytesAfter: number | null;
  /** Unified-ish excerpt of the change (context markers @@, -/+ lines). */
  excerpt: string;
}

export interface ApplyResult {
  ok: boolean;
  decision: "applied" | "rejected" | "apply-failed" | "dry-run";
  /** Why (not) applied — validation rejects, git failures, or info on success. */
  reasons: string[];
  files: ApplyFilePreview[];
  /** Commit sha of the apply commit (present when decision === "applied"). */
  sha?: string;
}

const EXCERPT_MAX_LINES = 12;

function byteSize(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Unified-ish excerpt: trim the common line prefix/suffix, then emit an @@ …
 * @@ hunk header with the removed/added middle lines, capped at
 * EXCERPT_MAX_LINES. Good enough for a human-readable ledger preview; not a
 * real unified diff.
 */
function diffExcerpt(before: string | null, after: string | null): string {
  const beforeLines = (before ?? "").split("\n");
  const afterLines = (after ?? "").split("\n");
  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;
  let endB = beforeLines.length;
  let endA = afterLines.length;
  while (endB > start && endA > start && beforeLines[endB - 1] === afterLines[endA - 1]) {
    endB--;
    endA--;
  }
  const lines: string[] = [`@@ -${start + 1},${endB - start} +${start + 1},${endA - start} @@`];
  for (let i = start; i < endB; i++) lines.push(`-${beforeLines[i]}`);
  for (let i = start; i < endA; i++) lines.push(`+${afterLines[i]}`);
  if (lines.length > EXCERPT_MAX_LINES + 1) {
    const dropped = lines.length - (EXCERPT_MAX_LINES + 1);
    lines.length = EXCERPT_MAX_LINES + 1;
    lines.push(`… (${dropped} more changed lines)`);
  }
  return lines.join("\n");
}

function previewFor(edit: ProposedEdit, agentDir: string): {preview: ApplyFilePreview; prior: string | null} {
  const full = join(agentDir, edit.path);
  const prior = existsSync(full) ? readFileSync(full, "utf8") : null;
  const preview: ApplyFilePreview = {
    path: edit.path,
    action: edit.content === null ? "delete" : prior === null ? "create" : "write",
    bytesBefore: prior === null ? null : byteSize(prior),
    bytesAfter: edit.content === null ? null : byteSize(edit.content),
    excerpt: diffExcerpt(prior, edit.content),
  };
  return {preview, prior};
}

/** Run git in agentDir; never throws (non-repo dirs surface as status != 0). */
function git(agentDir: string, args: string[]): {status: number; stdout: string; stderr: string} {
  const res = spawnSync("git", args, {cwd: agentDir, encoding: "utf8"});
  return {status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? ""};
}

function applyLedgerEntry(input: ApplyCandidateInput, kind: string, decision: string, reasons: string[], files: ApplyFilePreview[], sha: string | undefined, ledger: string): void {
  const entry: LedgerEntry = {
    runId: input.runId,
    ts: new Date().toISOString(),
    kind,
    decision,
    reasons,
    files: files.map((f) => ({path: f.path, action: f.action, bytesBefore: f.bytesBefore, bytesAfter: f.bytesAfter})),
    proposalFingerprint: proposalFingerprintOf(input.candidates.map((c) => ({edits: c.edits}))),
  };
  if (sha !== undefined) entry.sha = sha;
  if (input.scores !== undefined) entry.scores = input.scores;
  if (input.usage !== undefined) entry.usage = input.usage;
  appendEntry(entry, ledger);
}

/** Restore the snapshotted prior state of every affected path (best-effort). */
function rollback(agentDir: string, prior: Map<string, string | null>): void {
  for (const [rel, content] of prior) {
    const full = join(agentDir, rel);
    try {
      if (content === null) {
        if (existsSync(full)) rmSync(full);
      } else {
        mkdirSync(dirname(full), {recursive: true});
        writeFileSync(full, content);
      }
    } catch (err) {
      console.error(`[apply] rollback of ${rel} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Unstage whatever the failed add/commit left in the index. No-op (and an
  // expected failure) when agentDir is not a git repo.
  git(agentDir, ["reset", "-q"]);
}

// ---------------------------------------------------------------------------
// Apply

/**
 * Re-validate the winner through proposer's validation pipeline, then either
 * dry-run (diff preview only, kind "apply-dryrun" ledger entry) or apply to
 * `agentDir` (default ~/.pi/agent): write/delete the winner's files, stage
 * with explicit paths ("AGENTS.md", "skills/" — never -A/./--all), commit
 * `harness-loop(run <runId>): <first 100 chars of rationale>`. Any git
 * failure rolls back all file writes from the pre-apply snapshot and returns
 * decision "apply-failed".
 */
export function applyCandidate(input: ApplyCandidateInput): ApplyResult {
  const agentDir = input.agentDir ?? join(homedir(), ".pi", "agent");
  const ledger = input.ledgerPath ?? ledgerPath();

  // Re-validate through proposer's pipeline — never trust the caller's check.
  const validationReasons = validateCandidate(input.winner.edits);
  if (validationReasons.length > 0) {
    applyLedgerEntry(input, "apply", "rejected", validationReasons, [], undefined, ledger);
    return {ok: false, decision: "rejected", reasons: validationReasons, files: []};
  }

  // Snapshot prior state of every affected path BEFORE touching anything.
  const prior = new Map<string, string | null>();
  const previews: ApplyFilePreview[] = [];
  for (const edit of input.winner.edits) {
    const {preview, prior: oldContent} = previewFor(edit, agentDir);
    prior.set(edit.path, oldContent);
    previews.push(preview);
  }

  if (input.config.apply.dryRun) {
    applyLedgerEntry(input, "apply-dryrun", "dry-run", ["dry-run: no files touched (config.apply.dryRun)"], previews, undefined, ledger);
    return {ok: true, decision: "dry-run", reasons: ["dry-run: no files touched (config.apply.dryRun)"], files: previews};
  }

  // Write / delete the winner's files.
  let failure: string | null = null;
  for (const edit of input.winner.edits) {
    const full = join(agentDir, edit.path);
    try {
      if (edit.content === null) {
        if (existsSync(full)) rmSync(full);
      } else {
        mkdirSync(dirname(full), {recursive: true});
        writeFileSync(full, edit.content);
      }
    } catch (err) {
      failure = `file write failed for ${edit.path}: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }

  let sha: string | undefined;
  if (failure === null) {
    // EXPLICIT PATHS ONLY — never -A, ".", or --all. A path that does not
    // exist on disk (e.g. a skills/ dir with no changes and no files) is
    // skipped rather than turning into a pathspec error; the affected edit
    // paths themselves were just written, so their parents exist.
    const addPaths = ["AGENTS.md", "skills/"].filter((p) => existsSync(join(agentDir, p)));
    if (addPaths.length === 0) {
      failure = "git add failed: neither AGENTS.md nor skills/ exists in the agent dir";
    } else {
      const add = git(agentDir, ["add", ...addPaths]);
      if (add.status !== 0) {
        failure = `git add failed: ${(add.stderr.trim() || `exit ${add.status}`)}`;
      } else {
        const message = `harness-loop(run ${input.runId}): ${input.winner.rationale.slice(0, 100)}`;
        const commit = git(agentDir, ["commit", "-m", message]);
        if (commit.status !== 0) {
          failure = `git commit failed: ${(commit.stderr.trim() || commit.stdout.trim() || `exit ${commit.status}`)}`;
        } else {
          const rev = git(agentDir, ["rev-parse", "HEAD"]);
          if (rev.status === 0) sha = rev.stdout.trim();
        }
      }
    }
  }

  if (failure !== null) {
    rollback(agentDir, prior);
    applyLedgerEntry(input, "apply", "apply-failed", [failure], previews, undefined, ledger);
    return {ok: false, decision: "apply-failed", reasons: [failure], files: previews};
  }

  applyLedgerEntry(input, "apply", "applied", [], previews, sha, ledger);
  return {ok: true, decision: "applied", reasons: [], files: previews, sha};
}

// ---------------------------------------------------------------------------
// Revert

export interface RevertOptions {
  agentDir?: string;
}

export interface RevertResult {
  ok: boolean;
  /** "revert" = clean git revert; "checkout-fallback" = conflict path. */
  method: "revert" | "checkout-fallback";
  /** The harness-loop marker commit that was reverted. */
  sha?: string;
  error?: string;
}

/**
 * Revert the apply commit for `runId`, identified ONLY by its commit-subject
 * marker `harness-loop(run <runId>):`.
 *
 * Safety (documented, deliberately simple checks):
 *   - Refuse when no commit with the marker exists — a run that was never
 *     applied has nothing to revert, and a typo'd runId must never revert
 *     some other commit.
 *   - Refuse when the marker commit is not an ancestor of HEAD (its changes
 *     are not in the current tree; reverting would surprise).
 *   - Only the marker commit is ever reverted — non-harness-loop commits are
 *     never touched, because we revert by that exact sha and nothing else.
 *   - Prefer `git revert --no-edit <sha>`; on CONFLICT, abort the revert and
 *     fall back to `git checkout <sha>^ -- AGENTS.md skills/` + commit (this
 *     restores the loop-managed paths to their pre-apply state; any manual
 *     edits to those paths made after the apply commit are overwritten —
 *     documented trade-off of the fallback).
 */
export function revertByRunId(runId: string, options: RevertOptions = {}): RevertResult {
  const agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
  const marker = `harness-loop(run ${runId}):`;

  const log = git(agentDir, ["log", "--format=%H%x00%s"]);
  if (log.status !== 0) {
    return {ok: false, method: "revert", error: `git log failed: ${log.stderr.trim() || `exit ${log.status}`}`};
  }
  const commits = log.stdout.split("\n").filter((l) => l.trim() !== "").map((line) => {
    const nul = line.indexOf("\0");
    return {sha: line.slice(0, nul), subject: line.slice(nul + 1)};
  });
  const target = commits.find((c) => c.subject.startsWith(marker));
  if (target === undefined) {
    return {ok: false, method: "revert", error: `no harness-loop commit found for run ${runId} (marker "${marker}")`};
  }
  const ancestor = git(agentDir, ["merge-base", "--is-ancestor", target.sha, "HEAD"]);
  if (ancestor.status !== 0) {
    return {ok: false, method: "revert", error: `commit ${target.sha} for run ${runId} is not an ancestor of HEAD — refusing to revert`};
  }

  const revert = git(agentDir, ["revert", "--no-edit", target.sha]);
  if (revert.status === 0) {
    return {ok: true, method: "revert", sha: target.sha};
  }

  // Conflict (or other failure): abort the in-progress revert, then fall back
  // to restoring the loop-managed paths from the apply commit's parent.
  git(agentDir, ["revert", "--abort"]);
  const checkout = git(agentDir, ["checkout", `${target.sha}^`, "--", "AGENTS.md", "skills/"]);
  if (checkout.status !== 0) {
    return {ok: false, method: "checkout-fallback", sha: target.sha, error: `git revert failed (${revert.stderr.trim() || `exit ${revert.status}`}) and checkout fallback also failed: ${checkout.stderr.trim() || `exit ${checkout.status}`}`};
  }
  const commit = git(agentDir, ["commit", "-m", `harness-loop(revert run ${runId}): restore pre-apply state of AGENTS.md and skills/`]);
  if (commit.status !== 0) {
    return {ok: false, method: "checkout-fallback", sha: target.sha, error: `revert conflicted; checkout fallback staged the restore but the commit failed: ${commit.stderr.trim() || `exit ${commit.status}`}`};
  }
  return {ok: true, method: "checkout-fallback", sha: target.sha};
}

// ---------------------------------------------------------------------------
// proposal-rejected ledger entry

export interface ProposalRejectedInput {
  runId: string;
  /** The proposal's combined fingerprint (proposer.ts proposalFingerprintOf). */
  proposalFingerprint: string;
  candidateFingerprints?: string[];
  scores: {passCount: number; total: number};
  usage: {totalTokens: number};
  reasons: string[];
  ledgerPath?: string;
}

/**
 * Append a kind "proposal-rejected" entry for a scored proposal that lost
 * selection (or whose winner was rejected at apply time). The shape matches
 * proposer.ts's buildLedgerDigest exactly: it reads kind "proposal-rejected"
 * (or decision "rejected") and takes `proposalFingerprint` (falling back to
 * `fingerprint`), keeping the last 20 as the dedupe digest.
 */
export function appendProposalRejectedEntry(input: ProposalRejectedInput): void {
  const entry: LedgerEntry = {
    runId: input.runId,
    ts: new Date().toISOString(),
    kind: "proposal-rejected",
    proposalFingerprint: input.proposalFingerprint,
    scores: input.scores,
    usage: input.usage,
    reasons: input.reasons,
  };
  if (input.candidateFingerprints !== undefined) entry.candidateFingerprints = input.candidateFingerprints;
  appendEntry(entry, input.ledgerPath ?? ledgerPath());
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const cfg = loadLoopConfig();
  console.log(JSON.stringify(cfg, null, 2));
  console.log(`agent dir: ${join(homedir(), ".pi", "agent")}`);
  console.log(`dry-run: ${cfg.apply.dryRun}`);
}
