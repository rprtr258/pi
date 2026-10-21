#!/usr/bin/env bun
/**
 * Auto-apply + revert for the harness self-improvement loop (Step 5).
 *
 * SAFETY CONTRACT (this module is the only place that writes to the live agent config):
 *   - The target directory is `agentDir`, DEFAULTING TO the real
 *     ~/.pi/agent. Tests NEVER rely on the default: every test passes an
 *     `agentDir` override pointing at a temp-dir copy of a fake config git
 *     repo, and a `ledgerPath` override pointing at a temp ledger. No test
 *     may ever write to the real ~/.pi/agent or the real run-history.jsonl.
 *   - Paths are re-validated through proposer.ts's validation pipeline
 *     (validateCandidate: per-kind allowlist AGENTS.md / skills/<dir>/SKILL.md
 *     | scripts/<file> / prompts/<name>.md / agents/<name>.md via the surface
 *     registry, no traversal, per-kind size caps + content validators)
 *     immediately before apply — the caller's earlier validation is never
 *     trusted on its own.
 *   - Git staging uses EXPLICIT PATHS ONLY ("AGENTS.md", "skills/", …) —
 *     never -A, ., or --all, so nothing outside the loop's scope can be
 *     committed. The tracked run ledger
 *     (extensions/harness-self-improvement/run-history.jsonl) is explicitly
 *     EXCLUDED from staging via the pathspec
 *     ":!extensions/harness-self-improvement/run-history.jsonl": the ledger
 *     is committed by the loop's own development-step commits (see git log
 *     for run-history.jsonl), never swept into an apply commit.
 *   - Prior state of every affected path is snapshotted BEFORE any write as
 *     raw Buffers (never decoded); if a file write, `git add`, or `git commit`
 *     fails, all writes are rolled back (prior content restored byte-exactly /
 *     created files deleted) and the staged index is reset, before
 *     "apply-failed" is reported.
 *   - Symlink containment: before ANY read-snapshot/write/delete/mkdir, every
 *     path component of every edit path below agentDir (including the final
 *     one) is lstat'd; ANY symlink rejects the whole candidate, so a planted
 *     symlink can never redirect a loop write or delete outside agentDir.
 *   - Dirty-tree preflight: before any write (and before every revert),
 *     `git status --porcelain -- AGENTS.md skills/ prompts/ agents/` must be
 *     EMPTY (pathspecs from the surface registry) AFTER filtering out the
 *     loop's own subtree (SELF_SUBTREE below) — a dirty tree refuses the
 *     apply. The filter matters because run-history.jsonl is TRACKED and
 *     churns on every apply/revert/reject: without the filter the preflight
 *     would self-reject every live apply. Uncommitted changes to the loop's
 *     OWN extension code still require manual resolution — only ledger churn
 *     is expected and ignored. This also SHRINKS THE CRASH WINDOW: if the
 *     process is killed between the file writes and the commit, the loop's
 *     own writes are left uncommitted in the tree — the next apply (or
 *     revert) sees that dirty state under the managed paths and refuses
 *     until the residue is resolved manually (inspect `git diff`, then
 *     commit or checkout the leftover loop writes). That residue is
 *     deliberate: an uncommitted half-apply is never silently committed or
 *     silently discarded by a later run.
 *   - Single-flight: an advisory lockfile <agentDir>/.harness-loop.apply.lock
 *     is created with open(wx) for the whole apply/revert and unlinked in a
 *     finally block. A second concurrent apply is refused ("another apply in
 *     progress"); a lock older than 10 minutes is stolen (crashed writer)
 *     with a warning.
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
 *     "apply": {"dryRun": true},
 *     "budget": {"maxTotalTokens": 5000000, "maxIterations": 3},
 *     "candidates": {"maxPerIteration": 3},
 *     "replay": {"enabled": false, "minAgreement": 0.8},
 *     "code": {"allow": ["harness-loop-sample"], "minWin": 2} // Step 9a:
 *        editable extension names + minimum passDelta for CODE-bearing
 *        candidates (the `extensions` surface kind; gates in loop/lib/gates.ts)
 *     "parallel": {"enabled": true, "maxConcurrentProbes": 2} // Step 10:
 *        parallel probing of tasks WITHIN one candidate sandbox; candidates
 *        themselves stay sequential. Each probe gets its own isolated TMPDIR.
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
 *   kind "revert":           {runId, ts, decision: "reverted"|"revert-failed",
 *                             sha?, method? ("revert"|"checkout-fallback"),
 *                             error?}
 *   kind "proposal-rejected":{runId, ts, proposalFingerprint, scores, usage,
 *                             reasons, candidateFingerprints?} — EXACTLY the
 *                             shape proposer.ts's buildLedgerDigest reads.
 */
import {spawnSync} from "node:child_process";
import {closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {validateCandidate, proposalFingerprintOf, type ProposedCandidate, type ProposedEdit} from "./proposer.ts";
import {SURFACE_KINDS} from "./surface.ts";
import {appendEntry, ledgerPath, type LedgerEntry} from "./ledger.ts";

/**
 * The loop's own extension subtree under the agent dir. The run ledger
 * (run-history.jsonl) inside it is TRACKED in the agent config repo and
 * churns on every apply/revert/ledger write, so the dirty-tree preflight
 * must ignore the whole subtree — otherwise the loop self-rejects every
 * live apply (and revert) right after its own ledger write. The staging
 * exclusion (SELF_LEDGER_ADD_EXCLUSION below) keeps the ledger out of apply
 * commits; it is committed by the loop's own development-step commits.
 */
const SELF_SUBTREE = "extensions/harness-self-improvement/";
/** Git pathspec keeping the tracked run ledger out of apply commits. */
const SELF_LEDGER_ADD_EXCLUSION = ":!extensions/harness-self-improvement/run-history.jsonl";

// ---------------------------------------------------------------------------
// Config

export type LoopConfig = {
  /** Minimum passDelta for a straight pass-count win (integer ≥ 1). */
  minWin: number,
  /**
   * Minimum relative duration improvement for a pass-equal candidate to win.
   * null (the default) disables the duration branch: pass-equal candidates
   * NEVER win by default.
   */
  minQualityGain: number | null,
  /** Maximum allowed candTotalTokens / baseTotalTokens ratio. */
  usageFactor: number,
  apply: {
    /** true (default): never touch files, only return the diff preview. */
    dryRun: boolean,
  },
  /** Loop-stop budget (enforced by the /hloop driver between iterations and before each spawn). */
  budget: {
    /** Stop when the SUM of probe usage.totalTokens across the run reaches this (cost.total is 0 on this gateway — tokens are the metric). */
    maxTotalTokens: number,
    /** Maximum number of loop iterations (snapshot → baseline → propose → score → apply cycles). */
    maxIterations: number,
  },
  candidates: {
    /** Maximum number of validated candidates scored per iteration. */
    maxPerIteration: number,
  },
  /** Replay channel (Step 7) — second probe objective mined from real sessions. */
  replay: {
    /** False (default): the replay channel is NOT wired into selection yet — advisory only. */
    enabled: boolean,
    /** Judge-vs-checker agreement required for the channel to leave advisory mode. */
    minAgreement: number,
  },
  /** Code gates (Step 9a) — the `extensions` surface kind. */
  code: {
    /** Editable extension names (DYNAMIC allowlist, layer 2 — see surface.ts). */
    allow: string[],
    /** Minimum passDelta for a CODE-bearing candidate to win (≥ minWin default). */
    minWin: number,
  },
  /** Parallel probing (Step 10) — tasks WITHIN one candidate sandbox. */
  parallel: {
    /** Parallelize suite probes across tasks within a sandbox (candidates stay sequential). */
    enabled: boolean,
    /** Max probes in flight within one sandbox. */
    maxConcurrentProbes: number,
  },
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  minWin: 1,
  minQualityGain: null,
  usageFactor: 1.5,
  apply: {dryRun: true},
  budget: {maxTotalTokens: 5_000_000, maxIterations: 3},
  candidates: {maxPerIteration: 3},
  replay: {enabled: false, minAgreement: 0.8},
  code: {allow: [], minWin: 2},
  parallel: {enabled: true, maxConcurrentProbes: 2},
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
  const cfg: LoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    apply: {...DEFAULT_LOOP_CONFIG.apply},
    budget: {...DEFAULT_LOOP_CONFIG.budget},
    candidates: {...DEFAULT_LOOP_CONFIG.candidates},
    replay: {...DEFAULT_LOOP_CONFIG.replay},
    code: {...DEFAULT_LOOP_CONFIG.code, allow: [...DEFAULT_LOOP_CONFIG.code.allow]},
    parallel: {...DEFAULT_LOOP_CONFIG.parallel},
  };
  const p = parsed as Record<string, unknown>;
  if (p["minWin"] === undefined) {
    // keep default
  } else if (typeof p["minWin"] === "number" && Number.isInteger(p["minWin"]) && p["minWin"] >= 1) {
    cfg.minWin = p["minWin"];
  } else {
    warnField("minWin", "not an integer ≥ 1");
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
  const budget = p["budget"];
  if (budget === undefined) {
    // keep default
  } else if (budget !== null && typeof budget === "object" && !Array.isArray(budget)) {
    const b = budget as Record<string, unknown>;
    if (b["maxTotalTokens"] === undefined) {
      // keep default
    } else if (typeof b["maxTotalTokens"] === "number" && Number.isFinite(b["maxTotalTokens"]) && b["maxTotalTokens"] > 0) {
      cfg.budget.maxTotalTokens = b["maxTotalTokens"];
    } else {
      warnField("budget.maxTotalTokens", "not a finite number > 0");
    }
    if (b["maxIterations"] === undefined) {
      // keep default
    } else if (typeof b["maxIterations"] === "number" && Number.isInteger(b["maxIterations"]) && b["maxIterations"] >= 1) {
      cfg.budget.maxIterations = b["maxIterations"];
    } else {
      warnField("budget.maxIterations", "not an integer ≥ 1");
    }
  } else {
    warnField("budget", "not an object");
  }
  const candidates = p["candidates"];
  if (candidates === undefined) {
    // keep default
  } else if (candidates !== null && typeof candidates === "object" && !Array.isArray(candidates)) {
    const c = candidates as Record<string, unknown>;
    if (c["maxPerIteration"] === undefined) {
      // keep default
    } else if (typeof c["maxPerIteration"] === "number" && Number.isInteger(c["maxPerIteration"]) && c["maxPerIteration"] >= 1) {
      cfg.candidates.maxPerIteration = c["maxPerIteration"];
    } else {
      warnField("candidates.maxPerIteration", "not an integer ≥ 1");
    }
  } else {
    warnField("candidates", "not an object");
  }
  const replay = p["replay"];
  if (replay === undefined) {
    // keep default
  } else if (replay !== null && typeof replay === "object" && !Array.isArray(replay)) {
    const r = replay as Record<string, unknown>;
    if (r["enabled"] === undefined) {
      // keep default
    } else if (typeof r["enabled"] === "boolean") {
      cfg.replay.enabled = r["enabled"]!;
    } else {
      warnField("replay.enabled", "not a boolean");
    }
    if (r["minAgreement"] === undefined) {
      // keep default
    } else if (typeof r["minAgreement"] === "number" && Number.isFinite(r["minAgreement"]) && r["minAgreement"] >= 0 && r["minAgreement"] <= 1) {
      cfg.replay.minAgreement = r["minAgreement"]!;
    } else {
      warnField("replay.minAgreement", "not a finite number in [0, 1]");
    }
  } else {
    warnField("replay", "not an object");
  }
  const code = p["code"];
  if (code === undefined) {
    // keep default
  } else if (code !== null && typeof code === "object" && !Array.isArray(code)) {
    const c = code as Record<string, unknown>;
    if (c["allow"] === undefined) {
      // keep default
    } else if (Array.isArray(c["allow"]) && c["allow"].every((x) => typeof x === "string" && x !== "")) {
      cfg.code.allow = c["allow"] as string[];
    } else {
      warnField("code.allow", "not an array of non-empty strings");
    }
    if (c["minWin"] === undefined) {
      // keep default
    } else if (typeof c["minWin"] === "number" && Number.isInteger(c["minWin"]) && c["minWin"] >= 1) {
      cfg.code.minWin = c["minWin"];
    } else {
      warnField("code.minWin", "not an integer ≥ 1");
    }
  } else {
    warnField("code", "not an object");
  }
  const parallel = p["parallel"];
  if (parallel === undefined) {
    // keep default
  } else if (parallel !== null && typeof parallel === "object" && !Array.isArray(parallel)) {
    const pr = parallel as Record<string, unknown>;
    if (pr["enabled"] === undefined) {
      // keep default
    } else if (typeof pr["enabled"] === "boolean") {
      cfg.parallel.enabled = pr["enabled"]!;
    } else {
      warnField("parallel.enabled", "not a boolean");
    }
    if (pr["maxConcurrentProbes"] === undefined) {
      // keep default
    } else if (typeof pr["maxConcurrentProbes"] === "number" && Number.isInteger(pr["maxConcurrentProbes"]) && pr["maxConcurrentProbes"] >= 1) {
      cfg.parallel.maxConcurrentProbes = pr["maxConcurrentProbes"]!;
    } else {
      warnField("parallel.maxConcurrentProbes", "not an integer ≥ 1");
    }
  } else {
    warnField("parallel", "not an object");
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Types

export type ApplyCandidateInput = {
  /** All candidates of the proposal (used for the proposalFingerprint). */
  candidates: ProposedCandidate[],
  /** The candidate selected by selectWinner; its edits are applied. */
  winner: ProposedCandidate,
  runId: string,
  config: LoopConfig,
  /**
   * Override the agent config dir. DEFAULT is the REAL ~/.pi/agent — tests
   * MUST pass a temp-dir override; nothing in this module enforces it
   * (enforcement would break the one legitimate live-apply call site).
   */
  agentDir?: string,
  /** Override the ledger file; default run-history.jsonl. Tests override. */
  ledgerPath?: string,
  /** Optional run scores recorded on the ledger entry when available. */
  scores?: {passCount: number, total: number},
  usage?: {totalTokens: number},
}

export type ApplyFilePreview = {
  /** Path relative to agentDir (POSIX-style, as proposed). */
  path: string,
  action: "create" | "write" | "delete",
  bytesBefore: number | null,
  bytesAfter: number | null,
  /** Unified-ish excerpt of the change (context markers @@, -/+ lines). */
  excerpt: string,
}

export type ApplyResult = {
  ok: boolean,
  decision: "applied" | "rejected" | "apply-failed" | "dry-run",
  /** Why (not) applied — validation rejects, git failures, or info on success. */
  reasons: string[],
  files: ApplyFilePreview[],
  /** Commit sha of the apply commit (present when decision === "applied"). */
  sha?: string,
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

function previewFor(edit: ProposedEdit, agentDir: string): {preview: ApplyFilePreview, prior: Buffer | null} {
  const full = join(agentDir, edit.path);
  // Raw Buffer (no encoding): the snapshot must round-trip non-UTF-8 prior
  // content byte-exactly on rollback. The excerpt is only a utf8 decode.
  const prior = existsSync(full) ? readFileSync(full) : null;
  const preview: ApplyFilePreview = {
    path: edit.path,
    action: edit.content === null ? "delete" : prior === null ? "create" : "write",
    bytesBefore: prior === null ? null : prior.length,
    bytesAfter: edit.content === null ? null : byteSize(edit.content),
    excerpt: diffExcerpt(prior === null ? null : prior.toString("utf8"), edit.content),
  };
  return {preview, prior};
}

/** Run git in agentDir; never throws (non-repo dirs surface as status != 0). */
function git(agentDir: string, args: string[]): {status: number, stdout: string, stderr: string} {
  const res = spawnSync("git", args, {cwd: agentDir, encoding: "utf8"});
  return {status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? ""};
}

/**
 * The loop's managed git pathspecs, derived from the surface registry (S8):
 * ["AGENTS.md", "skills/", "prompts/", "agents/"]. Used for git add, the
 * dirty-tree preflight, and the revert checkout fallback — explicit paths
 * only, never -A/./--all.
 */
function managedGitPaths(): string[] {
  return SURFACE_KINDS.map((k) => k.gitPath);
}

/**
 * Dirty-tree preflight, scoped to the loop-managed paths (surface registry
 * gitPaths). Returns a refusal reason when any of them has uncommitted
 * changes, null when clean. A non-repo agentDir is NOT dirty (git add fails
 * later on its own); status failure is treated the same way.
 *
 * Lines under SELF_SUBTREE (the tracked run ledger, expected churn) are
 * filtered out and never block; the same filter applies to apply AND revert
 * (they share this function).
 */
function dirtyManagedPathsReason(agentDir: string): string | null {
  const st = git(agentDir, ["status", "--porcelain", "--", ...managedGitPaths()]);
  if (st.status !== 0) return null;
  const dirty = st.stdout.split("\n").filter((line) => {
    // Porcelain v1: exactly 3 chars (2 status + 1 space) before the path —
    // slice the UNTRIMMED line. Renames show "<old> -> <new>"; quoted when
    // the path contains special characters.
    const raw = line.slice(3).trim();
    if (raw === "") return false;
    const unquoted = raw.startsWith("\"") && raw.endsWith("\"") ? raw.slice(1, -1) : raw;
    const parts = unquoted.includes(" -> ") ? unquoted.split(" -> ") : [unquoted];
    return !parts.some((p) => p.startsWith(SELF_SUBTREE));
  });
  const paths = managedGitPaths().map((p) => p.replace(/\/$/, "")).join("/");
  return dirty.length > 0 ? `working tree dirty under ${paths} — resolve before apply` : null;
}

/**
 * Symlink containment: lstat every component of `rel` below agentDir —
 * INCLUDING the final one. ANY symlink rejects the whole candidate, because a
 * symlinked component can point outside agentDir and a write or delete
 * through it would escape the loop's containment. Missing components are fine
 * (apply's mkdir -p may create them). Runs BEFORE the prior-state snapshot and
 * before ANY write/delete/mkdir. Returns a rejection reason or null.
 */
function symlinkContainmentReason(agentDir: string, rel: string): string | null {
  let acc = agentDir;
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    acc = join(acc, part);
    try {
      if (lstatSync(acc).isSymbolicLink()) {
        return `symlink in path escapes containment: ${rel} (symlinked component "${part}")`;
      }
    } catch {
      return null; // component does not exist yet — nothing below it either
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-flight advisory lock

const LOCK_FILE_NAME = ".harness-loop.apply.lock";
/** A lock older than this is stale (crashed writer) and is stolen. */
const LOCK_STALE_MS = 10 * 60 * 1000;

type ApplyLock = {
  acquired: boolean,
  /** Refusal reason when acquired is false. */
  error: string | null,
  /** Idempotent release; tolerates a missing lock file. */
  release: () => void,
}

function createLockFile(lockPath: string): void {
  const fd = openSync(lockPath, "wx");
  try {
    writeSync(fd, `${process.pid}\n`);
  } finally {
    closeSync(fd);
  }
}

/**
 * Advisory single-flight lock for apply/revert: created with open(wx) so two
 * concurrent callers cannot both hold it. If the lock exists AND its mtime is
 * older than LOCK_STALE_MS it is stolen (crashed writer — the finally-block
 * release never ran) with a warning; otherwise the caller is refused with
 * "another apply in progress".
 */
function acquireApplyLock(agentDir: string): ApplyLock {
  const lockPath = join(agentDir, LOCK_FILE_NAME);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      createLockFile(lockPath);
      return {
        acquired: true,
        error: null,
        release: () => {
          try {
            unlinkSync(lockPath);
          } catch {
            // already gone (stolen after a 10-min hang) — nothing to do
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        return {acquired: false, error: `failed to create the apply lock ${lockPath}: ${err instanceof Error ? err.message : String(err)}`, release: () => {}};
      }
      if (attempt > 0) break; // stole the lock but lost the re-create race
      let stale = false;
      try {
        stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
      } catch {
        continue; // lock vanished between open and stat — retry the create
      }
      if (stale) {
        console.warn(`[apply] stealing stale apply lock ${lockPath} (mtime older than ${LOCK_STALE_MS / 60000} min)`);
        try {
          unlinkSync(lockPath);
        } catch {
          // someone else stole it first — re-create will then race/lose
        }
        continue;
      }
      break;
    }
  }
  return {acquired: false, error: `another apply in progress (lock ${LOCK_FILE_NAME} held in the agent dir)`, release: () => {}};
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

/**
 * Restore the snapshotted prior state of every affected path (best-effort).
 * Prior content is a raw Buffer so non-UTF-8 files come back byte-exactly.
 * `createdDirs` lists directories this apply's mkdir -p created (shallowest
 * first); they are rmdir'd innermost-first, only when empty.
 */
function rollback(agentDir: string, prior: Map<string, Buffer | null>, createdDirs: string[] = []): void {
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
  for (let i = createdDirs.length - 1; i >= 0; i--) {
    try {
      rmdirSync(join(agentDir, createdDirs[i]!)); // fails on non-empty dirs — leave those
    } catch {
      // non-empty or already gone: keep the directory
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
  const ledger = input.ledgerPath ?? ledgerPath;

  // Single-flight: one apply (or revert) at a time per agent dir.
  const lock = acquireApplyLock(agentDir);
  if (!lock.acquired) {
    const reasons = [lock.error!];
    applyLedgerEntry(input, "apply", "rejected", reasons, [], undefined, ledger);
    return {ok: false, decision: "rejected", reasons, files: []};
  }
  try {
    return applyCandidateLocked(input, agentDir, ledger);
  } finally {
    lock.release();
  }
}

function applyCandidateLocked(input: ApplyCandidateInput, agentDir: string, ledger: string): ApplyResult {
  // Re-validate through proposer's pipeline — never trust the caller's check.
  // Step 9a: with the extensions-kind environment supplied, gate-1 dynamic
  // checks (config code.allow + real test file + real node_modules) run here
  // too — apply-time validation is as strict as propose-time validation.
  const validationReasons = validateCandidate(input.winner.edits, {
    extensionEnv: {agentDir, codeAllow: input.config.code.allow},
  });
  if (validationReasons.length > 0) {
    applyLedgerEntry(input, "apply", "rejected", validationReasons, [], undefined, ledger);
    return {ok: false, decision: "rejected", reasons: validationReasons, files: []};
  }

  // Symlink containment BEFORE the prior-state snapshot and before ANY
  // write/delete/mkdir: a symlinked component could redirect the write or
  // delete outside agentDir. A symlink anywhere in ANY edit path rejects the
  // whole candidate.
  const symlinkReasons = input.winner.edits
    .map((edit) => symlinkContainmentReason(agentDir, edit.path))
    .filter((r): r is string => r !== null);
  if (symlinkReasons.length > 0) {
    applyLedgerEntry(input, "apply", "rejected", symlinkReasons, [], undefined, ledger);
    return {ok: false, decision: "rejected", reasons: symlinkReasons, files: []};
  }

  // Snapshot prior state of every affected path BEFORE touching anything.
  const prior = new Map<string, Buffer | null>();
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

  // Dirty-tree preflight BEFORE any write. Refusing on a dirty tree also
  // shrinks the crash window: loop writes left uncommitted by a killed apply
  // make the next apply refuse until the residue is resolved (see header).
  const dirtyReason = dirtyManagedPathsReason(agentDir);
  if (dirtyReason !== null) {
    applyLedgerEntry(input, "apply", "rejected", [dirtyReason], previews, undefined, ledger);
    return {ok: false, decision: "rejected", reasons: [dirtyReason], files: previews};
  }

  // Write / delete the winner's files.
  const createdDirs: string[] = [];
  let failure: string | null = null;
  for (const edit of input.winner.edits) {
    const full = join(agentDir, edit.path);
    try {
      if (edit.content === null) {
        if (existsSync(full)) rmSync(full);
      } else {
        const relDir = dirname(edit.path);
        if (!existsSync(join(agentDir, relDir))) {
          // Record every ancestor this mkdir -p creates (shallowest first) so
          // rollback can rmdir them innermost-first, only when empty.
          let acc = "";
          for (const part of relDir.split("/")) {
            if (part === "" || part === ".") continue;
            acc = acc === "" ? part : `${acc}/${part}`;
            if (!existsSync(join(agentDir, acc))) createdDirs.push(acc);
          }
          mkdirSync(join(agentDir, relDir), {recursive: true});
        }
        writeFileSync(full, edit.content);
      }
    } catch (err) {
      failure = `file write failed for ${edit.path}: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }

  let sha: string | undefined;
  if (failure === null) {
    // EXPLICIT PATHS ONLY — never -A, ".", or --all. Paths come from the
    // surface registry's gitPath set ("AGENTS.md", "skills/", "prompts/",
    // "agents/", "extensions/"). A path that does not exist on disk (e.g. a
    // skills/ dir with no changes and no files) is skipped rather than
    // turning into a pathspec error; the affected edit paths themselves were
    // just written, so their parents exist. The tracked run ledger under
    // SELF_SUBTREE is excluded from staging (see the header) — it is
    // committed by the loop's own development-step commits, not by applies.
    const addPaths = managedGitPaths().filter((p) => existsSync(join(agentDir, p)));
    if (addPaths.length === 0) {
      failure = "git add failed: none of the loop-managed paths (AGENTS.md, skills/, prompts/, agents/, extensions/) exists in the agent dir";
    } else {
      const addArgs = addPaths.includes("extensions/") ? [...addPaths, SELF_LEDGER_ADD_EXCLUSION] : [...addPaths];
      const add = git(agentDir, ["add", ...addArgs]);
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
    rollback(agentDir, prior, createdDirs);
    applyLedgerEntry(input, "apply", "apply-failed", [failure], previews, undefined, ledger);
    return {ok: false, decision: "apply-failed", reasons: [failure], files: previews};
  }

  applyLedgerEntry(input, "apply", "applied", [], previews, sha, ledger);
  return {ok: true, decision: "applied", reasons: [], files: previews, sha};
}

// ---------------------------------------------------------------------------
// Revert

export type RevertOptions = {
  agentDir?: string,
  /** Override the ledger file; default run-history.jsonl. Tests override. */
  ledgerPath?: string,
}

export type RevertResult = {
  ok: boolean,
  /** "revert" = clean git revert; "checkout-fallback" = conflict path. */
  method: "revert" | "checkout-fallback",
  /** The harness-loop marker commit that was reverted. */
  sha?: string,
  error?: string,
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
 *   - Refuse when the working tree is dirty under the loop-managed paths — checked
 *     BOTH before `git revert` AND before the destructive checkout fallback
 *     (no uncommitted manual change is ever swept into a revert or clobbered
 *     by the fallback checkout).
 *   - Runs under the same single-flight advisory lock as applyCandidate.
 *   - Every terminal outcome appends a kind "revert" ledger entry
 *     {runId, decision: "reverted"|"revert-failed", sha?, method?, error?}
 *     to the ledger (RevertOptions.ledgerPath override for tests).
 *   - Only the marker commit is ever reverted — non-harness-loop commits are
 *     never touched, because we revert by that exact sha and nothing else.
 *   - Prefer `git revert --no-edit <sha>`; on CONFLICT, abort the revert and
 *     fall back to `git checkout <sha>^ -- <managed paths>` + commit (the
 *     managed paths come from the surface registry, filtered to those present
 *     in the apply commit's parent tree; this
 *     restores the loop-managed paths to their pre-apply state; any manual
 *     edits to those paths made after the apply commit are overwritten —
 *     documented trade-off of the fallback).
 */
/** Append a kind "revert" ledger entry for a terminal revert outcome. */
function revertLedgerEntry(runId: string, ledger: string, decision: "reverted" | "revert-failed", fields: {sha?: string, method?: string, error?: string}): void {
  const entry: LedgerEntry = {
    runId,
    ts: new Date().toISOString(),
    kind: "revert",
    decision,
  };
  if (fields.sha !== undefined) entry.sha = fields.sha;
  if (fields.method !== undefined) entry.method = fields.method;
  if (fields.error !== undefined) entry.error = fields.error;
  appendEntry(entry, ledger);
}

export function revertByRunId(runId: string, options: RevertOptions = {}): RevertResult {
  const agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
  const ledger = options.ledgerPath ?? ledgerPath;

  // Same single-flight lock as apply: never revert while an apply runs.
  const lock = acquireApplyLock(agentDir);
  if (!lock.acquired) {
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "revert", error: lock.error!});
    return {ok: false, method: "revert", error: lock.error!};
  }
  try {
    return revertByRunIdLocked(runId, agentDir, ledger);
  } finally {
    lock.release();
  }
}

function revertByRunIdLocked(runId: string, agentDir: string, ledger: string): RevertResult {
  const marker = `harness-loop(run ${runId}):`;

  const log = git(agentDir, ["log", "--format=%H%x00%s"]);
  if (log.status !== 0) {
    const error = `git log failed: ${log.stderr.trim() || `exit ${log.status}`}`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "revert", error});
    return {ok: false, method: "revert", error};
  }
  const commits = log.stdout.split("\n").filter((l) => l.trim() !== "").map((line) => {
    const nul = line.indexOf("\0");
    return {sha: line.slice(0, nul), subject: line.slice(nul + 1)};
  });
  const target = commits.find((c) => c.subject.startsWith(marker));
  if (target === undefined) {
    const error = `no harness-loop commit found for run ${runId} (marker "${marker}")`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "revert", error});
    return {ok: false, method: "revert", error};
  }
  const ancestor = git(agentDir, ["merge-base", "--is-ancestor", target.sha, "HEAD"]);
  if (ancestor.status !== 0) {
    const error = `commit ${target.sha} for run ${runId} is not an ancestor of HEAD — refusing to revert`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "revert", sha: target.sha, error});
    return {ok: false, method: "revert", error};
  }

  // Dirty-tree preflight BEFORE the revert (and again before the destructive
  // checkout fallback below): uncommitted changes under the loop-managed
  // paths would be mixed into (or destroyed by) the revert.
  const dirtyReason = dirtyManagedPathsReason(agentDir);
  if (dirtyReason !== null) {
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "revert", sha: target.sha, error: dirtyReason});
    return {ok: false, method: "revert", error: dirtyReason};
  }

  const revert = git(agentDir, ["revert", "--no-edit", target.sha]);
  if (revert.status === 0) {
    revertLedgerEntry(runId, ledger, "reverted", {sha: target.sha, method: "revert"});
    return {ok: true, method: "revert", sha: target.sha};
  }

  // Conflict (or other failure): abort the in-progress revert, then fall back
  // to restoring the loop-managed paths from the apply commit's parent. Only
  // pathspecs present in that commit's tree are checked out (git checkout
  // errors on pathspecs the tree never had — e.g. prompts/ when no S8 apply
  // ever touched templates).
  git(agentDir, ["revert", "--abort"]);
  const dirtyAfterAbort = dirtyManagedPathsReason(agentDir);
  if (dirtyAfterAbort !== null) {
    const error = `git revert failed (${revert.stderr.trim() || `exit ${revert.status}`}) and the working tree is dirty after the abort — refusing the destructive checkout fallback: ${dirtyAfterAbort}`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "checkout-fallback", sha: target.sha, error});
    return {ok: false, method: "checkout-fallback", sha: target.sha, error};
  }
  const tree = git(agentDir, ["ls-tree", "--name-only", `${target.sha}^`]);
  const treeEntries = tree.status === 0 ? tree.stdout.split("\n").filter((e) => e !== "") : [];
  const checkoutPaths = managedGitPaths().filter((p) => treeEntries.some((e) => e === p.replace(/\/$/, "") || e.startsWith(p)));
  if (checkoutPaths.length === 0) {
    const error = `git revert failed (${revert.stderr.trim() || `exit ${revert.status}`}) and the apply commit's parent tree has none of the loop-managed paths to restore`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "checkout-fallback", sha: target.sha, error});
    return {ok: false, method: "checkout-fallback", sha: target.sha, error};
  }
  const checkout = git(agentDir, ["checkout", `${target.sha}^`, "--", ...checkoutPaths]);
  if (checkout.status !== 0) {
    const error = `git revert failed (${revert.stderr.trim() || `exit ${revert.status}`}) and checkout fallback also failed: ${checkout.stderr.trim() || `exit ${checkout.status}`}`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "checkout-fallback", sha: target.sha, error});
    return {ok: false, method: "checkout-fallback", sha: target.sha, error};
  }
  const commit = git(agentDir, ["commit", "-m", `harness-loop(revert run ${runId}): restore pre-apply state of loop-managed paths`]);
  if (commit.status !== 0) {
    const error = `revert conflicted; checkout fallback staged the restore but the commit failed: ${commit.stderr.trim() || `exit ${commit.status}`}`;
    revertLedgerEntry(runId, ledger, "revert-failed", {method: "checkout-fallback", sha: target.sha, error});
    return {ok: false, method: "checkout-fallback", sha: target.sha, error};
  }
  revertLedgerEntry(runId, ledger, "reverted", {sha: target.sha, method: "checkout-fallback"});
  return {ok: true, method: "checkout-fallback", sha: target.sha};
}

// ---------------------------------------------------------------------------
// proposal-rejected ledger entry

export type ProposalRejectedInput = {
  runId: string,
  /** The proposal's combined fingerprint (proposer.ts proposalFingerprintOf). */
  proposalFingerprint: string,
  candidateFingerprints?: string[],
  scores: {passCount: number, total: number},
  usage: {totalTokens: number},
  reasons: string[],
  ledgerPath?: string,
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
  appendEntry(entry, input.ledgerPath ?? ledgerPath);
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const cfg = loadLoopConfig();
  console.log(JSON.stringify(cfg, null, 2));
  console.log(`agent dir: ${join(homedir(), ".pi", "agent")}`);
  console.log(`dry-run: ${cfg.apply.dryRun}`);
}
