#!/usr/bin/env bun
/**
 * Real-task replay channel for the harness self-improvement loop (Step 7).
 *
 * MINING HEURISTICS (documented per the plan contract):
 *   Session discovery: ~/.pi/agent/sessions/<slug>/. Top-level
 *   `<ts>_<uuid>.jsonl` files are PRIMARY user sessions (one per cwd+start);
 *   nested `<ts>_<uuid>/<subagent-uuid>/run-N/session.jsonl` files are
 *   subagent runs spawned by those sessions and are NOT scanned (their
 *   "user" is another agent, not the primary goal source). READ-ONLY: this
 *   module never writes under sessions/.
 *   Parsing: streamed line-by-line (readline over a file stream), never
 *   loading a whole session into memory. Per-session budget:
 *   MAX_SESSION_LINES lines, skip lines longer than MAX_LINE_BYTES (giant
 *   tool outputs), stop early once the prompt + enough tool calls are known.
 *   PER-LINE MEMORY CAVEAT: readline buffers WHOLE LINES — a single session
 *   line larger than available memory would still be read fully into RAM
 *   before the MAX_LINE_CHARS length check runs. MAX_LINE_CHARS caps what
 *   gets PARSED, not the peak memory of the reader.
 *
 *   A session is a replay-task candidate when ALL hold:
 *     - prompt: the FIRST user message, verbatim, 15–4000 chars (shorter =
 *       no clear goal, longer = truncated at 4000); slash-command-only first
 *       messages are skipped;
 *     - substantial tool activity: ≥ MIN_TOOL_CALLS (8) total write-style
 *       tool calls (write/edit/bash+ others counted from assistant
 *       toolCall items);
 *     - it has file-mutation evidence: ≥ 1 `write` or `edit` tool call.
 *
 *   Candidate score (higher = better; ties broken by recency):
 *     +2 when ≥ 10 write-style calls, +1 when ≥ 5
 *     +2 when the session has `write` calls (reconstructable files)
 *     +3 facet outcome "success", +1 "partial" (harness-facets.json when
 *        present, matched by sessionId; ABSENT facets file is fine — all
 *        facet bonuses then 0)
 *     +1 facet type in CODING_TYPES (feature/refactor/bugfix/debugging/coding)
 *     +1 prompt length in [40, 4000]
 *   Top `mine` (default 8, clamped 5–10) candidates after dedupe are
 *   materialized; the run then probes the first `sample` of them.
 *
 *   Dedupe: near-identical prompts collapse by their normalized (lowercased,
 *   whitespace-collapsed) first 150 chars.
 *
 * WORKSPACE MATERIALIZATION (quality grades):
 *   - Files from `write` tool payloads are reconstructed (last write wins);
 *     later `edit` calls on a written path are replayed onto it when their
 *     oldText matches exactly — any failed edit marks the file unreliable.
 *   - Paths touched only by `edit` (we never saw a base content) are NOT
 *     reconstructable from the log: the task degrades to quality
 *     "described-from-log": workspace gets only a README.md describing the
 *     starting state (paths edited, call counts, session cwd) from the log.
 *   - Content caps: MAX_FILES (30) and per-file FILE_CAP_BYTES (128KB),
 *     total TOTAL_CAP_BYTES (1MB) — exceeding any cap also degrades to
 *     "described-from-log".
 *
 * MATERIALIZED LAYOUT (TASK.md-compatible, loop/suite-replay/<id>/):
 *   TASK.md         frontmatter name/description/timeout_s + the verbatim
 *                   prompt body (truncated at 4000 chars)
 *   check.ts        trivial pass checker — replay tasks have NO deterministic
 *                   checker; the LLM judge (loop/lib/judge.ts) is the objective
 *   PROVENANCE.json {sourceSession, cwd, startedTs, quality, promptTruncated,
 *                    facet?, writeCalls, editCalls, toolCalls}
 *   workspace/      reconstructed files (+ README.md when described-from-log)
 *
 * CALIBRATION: calibrateJudge runs the judge on suite tasks whose checker
 * verdict is known. Trajectories are reused from the baseline result cache
 * (loop/.cache, TaskScoreResult.trajectory) when the fingerprint matches —
 * otherwise fresh probes run. Reused trajectories carry NO retained final
 * workspace state (TaskScoreResult has no workspace snapshot), so the judge
 * is then told the workspace state was not retained. Agreement = fraction of
 * scored rows (abstained excluded) where binarize(judge ≥ 7) === checker
 * verdict. The replay channel is ADVISORY until a FRESH-probe calibration
 * with ≥ MIN_CALIBRATION_SAMPLE (8) rows reaches agreement ≥
 * replay.minAgreement (default 0.8): gate via isCalibrated(ledger,
 * minAgreement). Cache-only calibration runs (condition
 * "cached-trajectories") and samples below the minimum NEVER calibrate.
 *
 * Usage:
 *   bun run loop/lib/replay.ts selftest   read-only: mine real sessions into
 *                                         a temp dir, print candidate count
 */
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {basename, join, relative} from "node:path";
import {homedir} from "node:os";
import {createInterface} from "node:readline";
import {appendEntry, extensionRoot, ledgerPath as defaultLedgerPath, newRunId, type LedgerEntry} from "./ledger.ts";
import {stripFrontmatter, runProbe, resolvePiBinary, type ProbeResult} from "./probe.ts";
import {judgeTrajectory as defaultJudge, type JudgeVerdict} from "./judge.ts";
import type {CallModel} from "./proposer.ts";
import type {LoadedTask} from "./suite.ts";
import {buildSandbox as defaultBuildSandbox, captureModelFlag, snapshotReal} from "./stage.ts";
import {fingerprintSnapshot, baselineCacheDir, baselineCachePath, readBaselineCache} from "../baseline.ts";
import {scoreSuite} from "./score.ts";

// ---------------------------------------------------------------------------
// Types

/** A mined, materialized replay task. */
export type ReplayTask = {
  id: string,
  /** The session's primary user message, verbatim, ≤ 4000 chars. */
  prompt: string,
  /** Files staged into the probe workspace before the run. */
  workspace: Array<{relPath: string, content: string}>,
  /** Human-readable provenance: source session + why this task was picked. */
  provenance: string,
  /** "reconstructed" = workspace built from write payloads; "described-from-log" = degraded. */
  quality: "reconstructed" | "described-from-log",
  /** Absolute path of the source session.jsonl (read-only; never written). */
  sourceSession: string,
  facet?: {type?: string, outcome?: string, satisfaction?: string, goal?: string},
  toolCalls: number,
  writeCalls: number,
  editCalls: number,
}

/** Caps + tuning knobs (module-level so tests can read the documented numbers). */
export const PROMPT_MAX_CHARS = 4_000;
export const MIN_TOOL_CALLS = 8;
export const MAX_SESSION_LINES = 40_000;
export const MAX_LINE_CHARS = 2_000_000;
export const MAX_FILES = 30;
export const FILE_CAP_BYTES = 128 * 1024;
export const TOTAL_CAP_BYTES = 1024 * 1024;
export const REPLAY_TIMEOUT_S = 300;
/** Judge binarization threshold: score ≥ 7 counts as "pass". */
export const JUDGE_PASS_THRESHOLD = 7;

const CODING_TYPES = new Set(["feature", "refactor", "bugfix", "debugging", "coding", "implementation"]);

// ---------------------------------------------------------------------------
// Session discovery

/** Real sessions root. */
export function sessionsRoot(): string {
  return join(homedir(), ".pi", "agent", "sessions");
}

type SessionFileInfo = {
  path: string,
  /** Filename ordering key (filename embeds the start ts). */
  name: string,
}

/**
 * Top-level session files across all slug dirs, newest-name first. Both real
 * layouts are accepted: the live sessions root holds `<slug>/<ts>_<uuid>.jsonl`
 * files (one level of slug dirs), and callers (tests, custom roots) may pass
 * a flat dir of .jsonl files. Nested subagent run dirs
 * (<ts>_<uuid>/<sub>/run-N/session.jsonl) are NOT scanned — see the file
 * header mining heuristics.
 */
export function listSessionFiles(root: string = sessionsRoot(), limit = 500): string[] {
  const out: Array<{name: string, path: string}> = [];
  let entries;
  try {
    entries = readdirSync(root, {withFileTypes: true});
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push({name: entry.name, path: join(root, entry.name)});
      continue;
    }
    if (!entry.isDirectory()) continue;
    let inner;
    try {
      inner = readdirSync(join(root, entry.name), {withFileTypes: true});
    } catch {
      continue;
    }
    for (const file of inner) {
      if (file.isFile() && file.name.endsWith(".jsonl")) out.push({name: file.name, path: join(root, entry.name, file.name)});
    }
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(-limit).reverse().map((e) => e.path);
}

// ---------------------------------------------------------------------------
// Session parsing (streamed)

export type ParsedSession = {
  /** First user message verbatim (≤ 4000 chars); "" when none/slash-command. */
  prompt: string,
  promptTruncated: boolean,
  cwd: string,
  startedTs: string | null,
  toolCalls: number,
  writeCalls: number,
  editCalls: number,
  /** relPath → final content, for write-reconstructable paths. */
  writtenFiles: Map<string, string>,
  /** relPaths that were only edited (or whose edit replay failed). */
  editedOnlyPaths: string[],
  /** relPaths two DISTINCT source paths collapsed onto (unreliable). */
  collidedPaths: string[],
}

type ToolCallView = {
  name: string,
  args: Record<string, unknown>,
}

function toolCallsOf(content: unknown): ToolCallView[] {
  if (!Array.isArray(content)) return [];
  const out: ToolCallView[] = [];
  for (const item of content) {
    if (item === null || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (c.type !== "toolCall" || typeof c.name !== "string") continue;
    const args = c.arguments;
    out.push({name: c.name, args: args !== null && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {}});
  }
  return out;
}

function userTextOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is {type: "text", text: string} => c !== null && typeof c === "object" && (c as Record<string, unknown>).type === "text" && typeof (c as Record<string, unknown>).text === "string")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Normalize an absolute or relative tool-call path into a workspace relPath.
 * Paths are interpreted against the session cwd; absolute paths outside cwd
 * collapse to their last two segments. Returns null for paths that would
 * escape the workspace ("..", empty).
 */
export function toWorkspaceRelPath(rawPath: string, cwd: string): string | null {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return null;
  let rel: string;
  if (rawPath.startsWith("/")) {
    // Absolute path with an unknown session cwd cannot be placed reliably —
    // reject rather than guessing a workspace location.
    if (cwd === "") return null;
    const abs = rawPath;
    rel = relative(cwd, absNormalize(abs));
    if (rel.startsWith("..") || rel === "") {
      const parts = abs.split("/").filter(Boolean);
      rel = parts.slice(-2).join("/");
    }
  } else {
    rel = rawPath;
  }
  rel = rel.replace(/^\.\//, "");
  if (rel === "" || rel.split("/").includes("..")) return null;
  return rel;
}

function absNormalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

/**
 * Stream-parse one session file with the documented per-session budget.
 * Only the event kinds we need are examined; everything else is skipped.
 */
export async function parseSessionFile(path: string): Promise<ParsedSession> {
  const parsed: ParsedSession = {
    prompt: "",
    promptTruncated: false,
    cwd: "",
    startedTs: null,
    toolCalls: 0,
    writeCalls: 0,
    editCalls: 0,
    writtenFiles: new Map(),
    editedOnlyPaths: [],
    collidedPaths: [],
  };
  let promptSeen = false;
  const editOnly = new Set<string>();
  const written = new Set<string>();
  const pendingEdits = new Map<string, Array<{oldText: string | null, newText: string}>>();
  // First canonical source path seen per relPath; a second, different source
  // mapping onto the same relPath means two real files collided in the
  // workspace reconstruction — that file is unreliable.
  const canonicalByRel = new Map<string, string>();
  const collided = new Set<string>();

  const rl = createInterface({input: createReadStream(path, {encoding: "utf8"}), crlfDelay: Infinity});
  let lines = 0;
  outer:
  for await (const line of rl) {
    if (lines++ >= MAX_SESSION_LINES) break;
    if (line.length > MAX_LINE_CHARS) continue;
    if (!line.includes('"type":')) continue; // fast prefilter before JSON.parse
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event === null || typeof event !== "object") continue;
    const ev = event as Record<string, unknown>;
    if (parsed.cwd === "" && ev.type === "session") {
      const cwd = (ev as Record<string, unknown>)["cwd"];
      if (typeof cwd === "string") parsed.cwd = cwd;
      const ts = (ev as Record<string, unknown>)["timestamp"];
      if (typeof ts === "string") parsed.startedTs = ts;
    }
    if (ev.type !== "message") continue;
    const message = ev.message;
    if (message === null || typeof message !== "object") continue;
    const msg = message as Record<string, unknown>;
    if (msg.role === "user" && !promptSeen) {
      const text = userTextOf(msg.content).trim();
      if (text !== "") {
        promptSeen = true;
        parsed.promptTruncated = text.length > PROMPT_MAX_CHARS;
        parsed.prompt = text.startsWith("/") ? "" : text.slice(0, PROMPT_MAX_CHARS);
        if (text.startsWith("/")) break outer; // slash-command session: not a task prompt
      }
      continue;
    }
    if (msg.role !== "assistant") continue;
    for (const call of toolCallsOf(msg.content)) {
      parsed.toolCalls++;
      if (call.name === "write") {
        parsed.writeCalls++;
        const raw = String(call.args["path"] ?? "");
        const rel = toWorkspaceRelPath(raw, parsed.cwd);
        const content = call.args["content"];
        if (rel !== null && typeof content === "string") {
          noteSource(rel, raw, parsed.cwd, canonicalByRel, collided);
          parsed.writtenFiles.set(rel, content);
          written.add(rel);
          editOnly.delete(rel);
        }
      } else if (call.name === "edit") {
        parsed.editCalls++;
        const raw = String(call.args["path"] ?? "");
        const rel = toWorkspaceRelPath(raw, parsed.cwd);
        if (rel === null) continue;
        noteSource(rel, raw, parsed.cwd, canonicalByRel, collided);
        if (!written.has(rel)) editOnly.add(rel);
        const edits = call.args["edits"];
        if (Array.isArray(edits)) {
          const list = pendingEdits.get(rel) ?? [];
          for (const e of edits) {
            if (e === null || typeof e !== "object") continue;
            const edit = e as Record<string, unknown>;
            if (typeof edit["newText"] !== "string") continue;
            list.push({oldText: typeof edit["oldText"] === "string" ? edit["oldText"] : null, newText: edit["newText"]});
          }
          pendingEdits.set(rel, list);
        }
      }
    }
  }
  rl.close();

  // Collided relPaths (two distinct source paths → one workspace path) are
  // unreliable: the reconstructed content may merge unrelated files. Degrade
  // them the same way as failed-edit files.
  for (const rel of collided) {
    parsed.writtenFiles.delete(rel);
    written.delete(rel);
    editOnly.add(rel);
  }

  // Replay edits onto written content when the base is known and every edit
  // matches exactly; a single failed edit marks the file unreliable.
  for (const [rel, edits] of pendingEdits) {
    if (!written.has(rel)) continue;
    let content = parsed.writtenFiles.get(rel)!;
    let reliable = true;
    for (const edit of edits) {
      if (edit.oldText === null || edit.oldText === "" || !content.includes(edit.oldText)) {
        reliable = false;
        break;
      }
      content = content.replace(edit.oldText, edit.newText);
    }
    if (reliable) parsed.writtenFiles.set(rel, content);
    else {
      parsed.writtenFiles.delete(rel);
      written.delete(rel);
      editOnly.add(rel);
    }
  }
  parsed.editedOnlyPaths = [...editOnly].sort();
  parsed.collidedPaths = [...collided].sort();
  return parsed;
}

/** Canonical source-path key for collision detection: raw path resolved against cwd when possible. */
function canonicalRawPath(rawPath: string, cwd: string): string {
  if (rawPath.startsWith("/")) return absNormalize(rawPath);
  if (cwd !== "") return absNormalize(`${cwd}/${rawPath}`);
  return rawPath;
}

/** Record a write/edit source for relPath; distinct sources mark it collided. */
function noteSource(rel: string, rawPath: string, cwd: string, canonicalByRel: Map<string, string>, collided: Set<string>): void {
  const canonical = canonicalRawPath(rawPath, cwd);
  const prev = canonicalByRel.get(rel);
  if (prev === undefined) canonicalByRel.set(rel, canonical);
  else if (prev !== canonical) collided.add(rel);
}

// ---------------------------------------------------------------------------
// Facets (harness-facets.json — may be ABSENT)

type FacetEntry = {
  sessionId?: string,
  type?: string,
  outcome?: string,
  satisfaction?: string,
  goal?: string,
}

/**
 * Load facet entries from harness-facets.json (schema per PLAN.md:
 * {sessions:[{sessionId,type,outcome,satisfaction,goal,friction}]}). Absent
 * or unreadable file → empty list (never fatal).
 */
export function loadFacets(facetsPath: string | undefined): FacetEntry[] {
  if (facetsPath === undefined || !existsSync(facetsPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(facetsPath, "utf8")) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown> | null)?.["sessions"];
    if (!Array.isArray(list)) return [];
    return list.filter((f): f is FacetEntry => f !== null && typeof f === "object");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Candidate selection

export type ReplayCandidate = {
  prompt: string,
  promptTruncated: boolean,
  sourceSession: string,
  cwd: string,
  startedTs: string | null,
  facet?: FacetEntry,
  toolCalls: number,
  writeCalls: number,
  editCalls: number,
  writtenFiles: Array<{relPath: string, content: string}>,
  editedOnlyPaths: string[],
  /** relPaths two DISTINCT source paths collapsed onto (unreliable). */
  collidedPaths: string[],
  score: number,
  /** sha256 of the normalized prompt prefix (the dedupe key). */
  dedupeKey: string,
}

/** Normalized form used for both the dedupe key and near-duplicate checks. */
function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

export function dedupeKeyOf(prompt: string): string {
  return createHash("sha256").update(normalizePrompt(prompt).slice(0, 150)).digest("hex");
}

/** Comparison window for the near-duplicate edit distance (chars). */
const DEDUPE_COMPARE_CHARS = 400;
/** Prompts within this normalized edit-distance ratio count as duplicates. */
const DEDUPE_MAX_DISTANCE_RATIO = 0.1;

/** Levenshtein edit distance (capped inputs; small windows only). */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** True when two prompts are near-identical (equal prefix or tiny edit distance). */
export function areNearDuplicates(a: string, b: string): boolean {
  const na = normalizePrompt(a).slice(0, DEDUPE_COMPARE_CHARS);
  const nb = normalizePrompt(b).slice(0, DEDUPE_COMPARE_CHARS);
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return true;
  return editDistance(na, nb) <= DEDUPE_MAX_DISTANCE_RATIO * maxLen;
}

/** Score one parsed session per the header heuristics; null when not a candidate. */
export function scoreSession(session: ParsedSession, sourceSession: string, facet?: FacetEntry): ReplayCandidate | null {
  const prompt = session.prompt ?? "";
  if (prompt.length < 15) return null; // no clear primary goal
  if (session.toolCalls < MIN_TOOL_CALLS) return null; // not substantial work
  if (session.writeCalls === 0 && session.editCalls === 0) return null; // no file-mutation evidence
  let score = 0;
  if (session.toolCalls >= 10) score += 2;
  else if (session.toolCalls >= 5) score += 1;
  if (session.writeCalls > 0) score += 2;
  if (facet?.outcome === "success") score += 3;
  else if (facet?.outcome === "partial") score += 1;
  if (facet?.type !== undefined && CODING_TYPES.has(facet.type)) score += 1;
  if (prompt.length >= 40 && prompt.length <= PROMPT_MAX_CHARS) score += 1;
  return {
    prompt,
    promptTruncated: session.promptTruncated,
    sourceSession,
    cwd: session.cwd,
    startedTs: session.startedTs,
    facet,
    toolCalls: session.toolCalls,
    writeCalls: session.writeCalls,
    editCalls: session.editCalls,
    writtenFiles: [...session.writtenFiles].map(([relPath, content]) => ({relPath, content})),
    editedOnlyPaths: session.editedOnlyPaths,
    collidedPaths: session.collidedPaths,
    score,
    dedupeKey: dedupeKeyOf(prompt),
  };
}

/**
 * Rank + dedupe candidates: score desc, recency (sourceSession filename) as
 * the tiebreak, near-identical-prompt dedupe (see areNearDuplicates).
 */
export function selectReplayCandidates(candidates: ReplayCandidate[], count: number): ReplayCandidate[] {
  const clamped = Math.max(5, Math.min(10, count));
  const sorted = [...candidates].sort((a, b) => b.score - a.score || (a.sourceSession < b.sourceSession ? 1 : a.sourceSession > b.sourceSession ? -1 : 0));
  const out: ReplayCandidate[] = [];
  for (const candidate of sorted) {
    if (out.length >= clamped) break;
    if (out.some((picked) => areNearDuplicates(picked.prompt, candidate.prompt))) continue;
    out.push(candidate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Privacy redaction (materialized artifacts + ledger must not leak absolute
// home paths or absolute session paths — see the S7 review contract)

/**
 * Replace every occurrence of the literal home-dir prefix with `~` (light
 * content scrub: content semantics stay, only the absolute home path form is
 * rewritten to `~/...`).
 */
export function redactHomePrefix(text: string, home: string = homedir()): string {
  if (home === "" || home === "/") return text;
  return text.split(home).join("~");
}

/** Collapse an absolute path (e.g. a session-log path) to its basename; relative paths pass through. */
export function redactSessionPath(path: string): string {
  if (!path.startsWith("/")) return path;
  return basename(path);
}

/**
 * Redact a free-form provenance string: absolute session-log paths collapse
 * to their basename, and any remaining absolute home path loses the user's
 * home prefix (`/home/<user>/…` → `~/…`). No username ever survives.
 */
export function redactProvenanceText(text: string, home: string = homedir()): string {
  const withoutSessionPaths = text.replace(/(^|[\s,("'])\/[^\s,()"']+\.jsonl/g, (m, pre: string) => `${pre}${basename(m.slice(pre.length))}`);
  return redactHomePrefix(withoutSessionPaths, home);
}

// ---------------------------------------------------------------------------
// Materialization

export const replayTasksRoot = join(extensionRoot, "loop", "suite-replay");

/** Materialized-task id: sanitized cwd basename + 8-char slice of the session uuid. */
const SESSION_UUID_RE = /_([0-9a-f]{8})[0-9a-f-]*\.jsonl$/;

export function replayTaskId(candidate: ReplayCandidate): string {
  const cwdBase = candidate.cwd === "" ? "session" : basename(candidate.cwd);
  const slug = cwdBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "session";
  const uuid = SESSION_UUID_RE.exec(candidate.sourceSession)?.[1]
    ?? createHash("sha256").update(candidate.sourceSession).digest("hex").slice(0, 8);
  return `${slug}-${uuid}`;
}

const REPLAY_CHECK_TS = `#!/usr/bin/env bun
// Replay channel task: there is NO deterministic checker — the LLM judge
// (loop/lib/judge.ts) is the objective. This checker always passes.
process.exit(0);
`;

function descriptionOf(candidate: ReplayCandidate): string {
  const first = redactHomePrefix(candidate.prompt).replace(/\s+/g, " ").trim().slice(0, 80);
  return `Replay of real session task: ${first}${candidate.prompt.length > 80 ? "…" : ""}`;
}

/**
 * Materialize one candidate under <outDir>/<id>/ (TASK.md + check.ts +
 * PROVENANCE.json + workspace/). Returns the id. The dir is created fresh.
 */
export function materializeReplayTask(candidate: ReplayCandidate, outDir: string): {id: string, quality: "reconstructed" | "described-from-log", workspace: Array<{relPath: string, content: string}>} {
  const id = replayTaskId(candidate);
  const dir = join(outDir, id);
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(join(dir, "workspace"), {recursive: true});

  // Workspace reconstruction: written payloads only, with caps. Anything
  // that overflows the caps marks the whole reconstruction unreliable.
  const workspace: Array<{relPath: string, content: string}> = [];
  let totalBytes = 0;
  let reliable = candidate.editedOnlyPaths.length === 0 && candidate.collidedPaths.length === 0;
  const dropped: string[] = [];
  for (const file of candidate.writtenFiles) {
    const bytes = new TextEncoder().encode(file.content).length;
    if (workspace.length >= MAX_FILES || bytes > FILE_CAP_BYTES || totalBytes + bytes > TOTAL_CAP_BYTES) {
      dropped.push(file.relPath);
      reliable = false;
      continue;
    }
    totalBytes += bytes;
    workspace.push({relPath: file.relPath, content: file.content});
  }
  if (dropped.length > 0) {
    // Drop unreliable partials: a task missing most of its files would probe
    // against a misleading starting state — degrade to described-from-log.
    workspace.length = 0;
  }
  const quality: "reconstructed" | "described-from-log" = workspace.length > 0 && reliable ? "reconstructed" : "described-from-log";

  const provenance = {
    sourceSession: redactSessionPath(candidate.sourceSession),
    cwd: redactHomePrefix(candidate.cwd),
    startedTs: candidate.startedTs,
    quality,
    promptTruncated: candidate.promptTruncated,
    facet: candidate.facet ?? null,
    toolCalls: candidate.toolCalls,
    writeCalls: candidate.writeCalls,
    editCalls: candidate.editCalls,
    editedOnlyPaths: candidate.editedOnlyPaths,
    workspaceFiles: workspace.map((w) => w.relPath),
  };

  const taskMd = [
    "---",
    `name: ${id}`,
    `description: ${JSON.stringify(descriptionOf(candidate))}`,
    `timeout_s: 300`,
    "---",
    // Light scrub only: the prompt stays verbatim except that absolute home
    // paths are rewritten to `~/…` (privacy: no usernames in artifacts).
    redactHomePrefix(candidate.prompt),
    "",
  ].join("\n");
  writeFileSync(join(dir, "TASK.md"), taskMd);
  writeFileSync(join(dir, "check.ts"), REPLAY_CHECK_TS);
  chmodSync(join(dir, "check.ts"), 0o755);
  writeFileSync(join(dir, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);

  if (quality === "reconstructed") {
    for (const file of workspace) {
      const target = join(dir, "workspace", file.relPath);
      mkdirSync(join(target, ".."), {recursive: true});
      writeFileSync(target, redactHomePrefix(file.content));
    }
  } else {
    // Described-from-log: a README describing the starting state from the log.
    const lines = [
      "# Workspace starting state (described-from-log)",
      "",
      `This replay task's workspace could not be reliably reconstructed from the`,
      `session log, so the files below are NOT the real starting state. The log`,
      `says the session worked in \`${redactHomePrefix(candidate.cwd) || "<unknown cwd>"}\` and:`,
      "",
      `- total tool calls observed: ${candidate.toolCalls}`,
      `- write calls: ${candidate.writeCalls}`,
      `- edit calls: ${candidate.editCalls} (paths: ${candidate.editedOnlyPaths.slice(0, 20).join(", ") || "none"})`,
      candidate.collidedPaths.length > 0
        ? `- collided paths (two distinct log sources → same rel path, unreliable): ${candidate.collidedPaths.slice(0, 20).join(", ")}`
        : "",
      candidate.facet?.goal ? `- facet goal: ${candidate.facet.goal}` : "",
      "",
      "Treat the ORIGINAL PROMPT as the goal; do not expect these files to match reality.",
    ].filter((l) => l !== undefined);
    writeFileSync(join(dir, "workspace", "README.md"), `${lines.join("\n")}\n`);
  }
  return {id, quality, workspace};
}

/** Mine up to `mine` (clamped 5–10, default 8) replay tasks from real sessions. */
export async function mineReplayTasks(opts: {mine?: number, sessionsLimit?: number, sessionsRootOverride?: string, facetsPath?: string, outDir?: string} = {}): Promise<ReplayTask[]> {
  const mine = opts.mine ?? 8;
  const outDir = opts.outDir ?? replayTasksRoot;
  const root = opts.sessionsRootOverride ?? sessionsRoot();
  const facets = loadFacets(opts.facetsPath ?? join(extensionRoot, "harness-facets.json"));
  const facetBySession = new Map(facets.filter((f) => typeof f.sessionId === "string").map((f) => [f.sessionId!, f]));

  const candidates: ReplayCandidate[] = [];
  for (const path of listSessionFiles(root, opts.sessionsLimit ?? 500)) {
    let session: ParsedSession;
    try {
      session = await parseSessionFile(path);
    } catch {
      continue; // unreadable session — skip, never fatal
    }
    if (session.prompt === "") continue;
    const sessionUuid = basename(path, ".jsonl").split("_").pop() ?? "";
    const facet = facetBySession.get(sessionUuid);
    const candidate = scoreSession(session, path, facet);
    if (candidate !== null) candidates.push(candidate);
  }

  // Fresh materialization: wipe the replay root so ids from removed sessions
  // never linger.
  rmSync(outDir, {recursive: true, force: true});
  mkdirSync(outDir, {recursive: true});

  const tasks: ReplayTask[] = [];
  for (const candidate of selectReplayCandidates(candidates, mine)) {
    const {id, quality, workspace} = materializeReplayTask(candidate, outDir);
    const facetLine = candidate.facet ? `, facet ${candidate.facet.type ?? "?"}/${candidate.facet.outcome ?? "?"}` : "";
    tasks.push({
      id,
      prompt: candidate.prompt,
      workspace,
      provenance: redactProvenanceText(`session ${candidate.sourceSession}${facetLine}, ${candidate.toolCalls} tool calls (${candidate.writeCalls} write, ${candidate.editCalls} edit), cwd ${candidate.cwd}`),
      quality,
      sourceSession: candidate.sourceSession,
      facet: candidate.facet,
      toolCalls: candidate.toolCalls,
      writeCalls: candidate.writeCalls,
      editCalls: candidate.editCalls,
    });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
// Materialized-task loading

/** Replay-task dir shape (PROVENANCE.json). */
export type ReplayProvenance = {
  sourceSession: string,
  cwd: string,
  startedTs: string | null,
  quality: "reconstructed" | "described-from-log",
  promptTruncated: boolean,
  facet: FacetEntry | null,
  toolCalls: number,
  writeCalls: number,
  editCalls: number,
  editedOnlyPaths: string[],
  workspaceFiles: string[],
}

/** List materialized replay-task ids (sorted). */
export function listReplayTasks(root: string = replayTasksRoot): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, {withFileTypes: true})
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "TASK.md")))
    .map((e) => e.name)
    .sort();
}

/** Load one materialized replay task as a LoadedTask for runProbe. */
export function loadReplayTask(id: string, root: string = replayTasksRoot): LoadedTask {
  const dir = join(root, id);
  const taskMd = join(dir, "TASK.md");
  const metaMatch = /^name:\s*(.+)$/m.exec(readFileSync(taskMd, "utf8"));
  const timeoutMatch = /^timeout_s:\s*(\d+)$/m.exec(readFileSync(taskMd, "utf8"));
  let provenance: ReplayProvenance | null = null;
  try {
    provenance = JSON.parse(readFileSync(join(dir, "PROVENANCE.json"), "utf8")) as ReplayProvenance;
  } catch {
    // provenance is metadata only — probing works without it
  }
  return {
    name: id,
    category: "replay",
    paths: {
      dir,
      taskMd,
      // Field name is shared with suite tasks; replay materializes an
      // always-pass executable check.ts (no deterministic checker).
      checkTs: join(dir, "check.ts"),
      ref: dir,
      broken: dir,
      setupSh: null,
    },
    meta: {
      name: id,
      description: provenance ? `replay (${provenance.quality})` : "replay",
      timeoutS: timeoutMatch ? Number(timeoutMatch[1]) : 300,
    },
    shapeErrors: [],
  };
}

// ---------------------------------------------------------------------------
// Probe + judge

export type ProbeReplayOptions = {
  model?: string,
  /** Where to record the raw JSONL (must live outside wsDir). */
  rawJsonlPath?: string,
  /** Probe implementation override (tests); defaults to runProbe. */
  runProbeFn?: typeof runProbe,
}

/**
 * Probe one materialized replay task: the task's workspace/ files are staged
 * into wsDir BEFORE the nested pi run (via runProbe's stageWorkspace hook),
 * then the probe runs against the staged starting state. There is no
 * deterministic checker (check.ts always passes) — judge the result with
 * judgeTrajectory + captureWorkspaceState.
 */
export async function probeReplayTask(task: LoadedTask, sandboxDir: string, wsDir: string, options: ProbeReplayOptions = {}): Promise<ProbeResult> {
  const staged = join(task.paths.dir, "workspace");
  const stageWorkspace = existsSync(staged)
    ? (target: string): void => {
        for (const entry of listWorkspaceFiles(staged, "")) {
          const dest = join(target, entry.relPath);
          mkdirSync(join(dest, ".."), {recursive: true});
          writeFileSync(dest, entry.content);
        }
      }
    : undefined;
  const probe = options.runProbeFn ?? runProbe;
  return probe(task, sandboxDir, wsDir, {
    timeoutS: task.meta?.timeoutS,
    model: options.model,
    rawJsonlPath: options.rawJsonlPath,
    stageWorkspace,
  });
}

/** Recursively read workspace files (≤ FILE_CAP_BYTES each, ≤ MAX_FILES total). */
function listWorkspaceFiles(dir: string, prefix: string): Array<{relPath: string, content: string}> {
  const out: Array<{relPath: string, content: string}> = [];
  let entries;
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break;
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.isDirectory()) out.push(...listWorkspaceFiles(full, rel));
    else if (entry.isFile()) {
      try {
        if (statSync(full).size > FILE_CAP_BYTES) continue;
        out.push({relPath: rel, content: readFileSync(full, "utf8")});
      } catch {
        // unreadable file — skip
      }
    }
  }
  return out;
}

/**
 * Capture the final workspace state for the judge: a file manifest with
 * contents (capped) — used after a probe so the judge sees the END state.
 */
export function captureWorkspaceState(wsDir: string): string {
  if (!existsSync(wsDir)) return "(workspace directory missing)";
  const files = listWorkspaceFiles(wsDir, "");
  if (files.length === 0) return "(workspace is empty)";
  const sections = files.map((f) => `### ${f.relPath}\n\`\`\`\n${f.content}\n\`\`\``);
  return `Workspace files (${files.length}):\n\n${sections.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Calibration

export type CalibrationRow = {
  task: string,
  checkerPass: boolean,
  judgeScore: number,
  judgePass: boolean,
  abstained: boolean,
  rationale: string,
  trajectorySource: "cache" | "fresh",
  /** First ~800 chars of the raw judge output when parsing failed (debug aid). */
  rawPreview?: string,
}

export type CalibrationResult = {
  rows: CalibrationRow[],
  /** matches / scored rows (abstained excluded); null when no scored rows. */
  agreement: number | null,
  /**
   * True only for a fresh-probe calibration with ≥ MIN_CALIBRATION_SAMPLE
   * rows and agreement ≥ minAgreement; cache-only runs never calibrate.
   */
  calibrated: boolean,
  reportPath: string,
  judgeModel: string | null,
  /** How many trajectories came from the baseline cache vs fresh probes. */
  cacheHits: number,
  freshProbes: number,
  /** Measurement basis of this calibration run. */
  condition: "fresh" | "cached-trajectories",
}

/** Pure agreement computation (tested directly). Abstained rows are excluded from the denominator and reported separately. */
export function computeAgreement(rows: Array<{checkerPass: boolean, judgeScore: number, abstained?: boolean}>): {agreement: number | null, matches: number, total: number, abstained: number} {
  const scored = rows.filter((r) => r.abstained !== true);
  const abstained = rows.length - scored.length;
  if (scored.length === 0) return {agreement: null, matches: 0, total: 0, abstained};
  let matches = 0;
  for (const row of scored) {
    if ((row.judgeScore >= JUDGE_PASS_THRESHOLD) === row.checkerPass) matches++;
  }
  return {agreement: matches / scored.length, matches, total: scored.length, abstained};
}

/** Minimum judged rows for a CALIBRATED verdict; below this the channel stays advisory. */
export const MIN_CALIBRATION_SAMPLE = 8;

/**
 * Judge-calibration gate: reads the latest judge-calibration ledger entry.
 * A CALIBRATED verdict requires ≥ MIN_CALIBRATION_SAMPLE judged rows AND a
 * fresh (non-cache-only) measurement basis — entries labeled
 * "cached-trajectories" or with too small a sample can never calibrate.
 * Older entries predating the gate (no sample field) stay advisory.
 */
export function isCalibrated(entries: LedgerEntry[], minAgreement = 0.8): {calibrated: boolean, agreement: number | null, ts: string | null} {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind !== "judge-calibration") continue;
    const agreement = entry["agreement"];
    if (typeof agreement !== "number" || !Number.isFinite(agreement)) continue;
    const sample = entry["sample"];
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < MIN_CALIBRATION_SAMPLE) {
      return {calibrated: false, agreement, ts: entry.ts}; // sample too small (N<8)
    }
    if (entry["condition"] === "cached-trajectories") {
      return {calibrated: false, agreement, ts: entry.ts}; // cache-only basis never calibrates
    }
    return {calibrated: agreement >= minAgreement, agreement, ts: entry.ts};
  }
  return {calibrated: false, agreement: null, ts: null};
}

/**
 * Collect cached trajectories for `taskNames` from every baseline cache
 * payload whose fingerprint matches: the exact task-set cache first, then any
 * other payload (e.g. the full-suite cache) whose results cover the sampled
 * tasks. A fingerprint mismatch never reuses — see baseline.ts's cache
 * contract. Returns per-name {pass, trajectory}; entries may be missing when
 * no cache covers them (fresh probes fill those).
 */
export function findCachedTrajectories(fingerprint: string, taskNames: string[], cacheDir: string = baselineCacheDir()): Map<string, {pass: boolean, trajectory: string}> {
  const merged = new Map<string, {pass: boolean, trajectory: string}>();
  const want = new Set(taskNames);
  let files: string[] = [];
  try {
    files = readdirSync(cacheDir).filter((f) => f.startsWith(`baseline-${fingerprint}`) && f.endsWith(".json")).sort();
  } catch {
    return merged;
  }
  // Exact task-set cache first (deterministic preference on overlap).
  const digest = taskNames.length > 0 ? createHash("sha256").update([...taskNames].sort().join("\0")).digest("hex").slice(0, 16) : "";
  files.sort((a, b) => (a.includes(`-${digest}.json`) ? -1 : b.includes(`-${digest}.json`) ? 1 : 0));
  for (const file of files) {
    const payload = readBaselineCache(join(cacheDir, file));
    if (payload === null || payload.fingerprint !== fingerprint) continue;
    for (const r of payload.results) {
      if (!want.has(r.task) || merged.has(r.task)) continue;
      merged.set(r.task, {pass: r.pass, trajectory: r.trajectory ?? ""});
    }
  }
  return merged;
}

export type CalibrateOptions = {
  /** Limit of suite tasks to calibrate on (default: all suite tasks). */
  sample?: number,
  /** The model call for the judge (inject a fake in tests). */
  callModel: CallModel,
  /** Nested-run --model override. */
  model?: string,
  /** Judge implementation override (tests). */
  judgeFn?: typeof defaultJudge,
  /** Probe implementation override (tests; used when no cached trajectory). */
  runProbeFn?: typeof runProbe,
  /** Run directory (runs/<runId>) — report lands here. */
  runDir: string,
  /** Suite tasks to calibrate (default: all valid suite tasks). */
  tasks?: LoadedTask[],
  /** Pre-computed per-task results WITH trajectories (tests / pre-scored runs).
   *  `source` marks the trajectory basis (default "cache"). */
  resultsOverride?: Array<{task: string, pass: boolean, trajectory: string, source?: "cache" | "fresh"}>,
  /** Ledger path override (tests). */
  ledgerPath?: string,
  /** minAgreement override (default from loop/config.json replay.minAgreement semantics: 0.8). */
  minAgreement?: number,
  log?: (line: string) => void,
}

/**
 * Reused cached baseline trajectories when the fingerprint matches; fresh
 * probes otherwise. Documented per the plan: TaskScoreResult.trajectory is
 * persisted in the baseline cache, so calibration on unchanged snapshots is
 * free; reused trajectories carry no final workspace state, which the judge
 * prompt then states explicitly.
 */
export async function calibrateJudge(opts: CalibrateOptions): Promise<CalibrationResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const ledger = opts.ledgerPath ?? defaultLedgerPath;

  type Traj = {task: string, pass: boolean, trajectory: string, source: "cache" | "fresh"};
  const trajs: Traj[] = [];

  if (opts.resultsOverride !== undefined) {
    // Pre-scored fixtures (tests / pre-scored runs).
    for (const r of opts.resultsOverride) trajs.push({task: r.task, pass: r.pass, trajectory: r.trajectory, source: r.source ?? "cache"});
  } else {
    const tasks = opts.tasks ?? [];
    if (tasks.length === 0) throw new Error("calibrateJudge: no tasks given (pass tasks or resultsOverride)");
    const sampled = opts.sample !== undefined ? tasks.slice(0, opts.sample) : tasks;
    const taskNames = sampled.map((t) => t.name);
    // Cache-first trajectory reuse (see docstring): the exact task-set cache
    // first, then ANY baseline cache payload with a matching fingerprint whose
    // result set covers the sampled tasks (e.g. the full-suite cache).
    const piBinary = resolvePiBinary();
    const model = opts.model ?? captureModelFlag();
    const fingerprint = fingerprintSnapshot(snapshotReal(), model, piBinary);
    const cachedByName = findCachedTrajectories(fingerprint, taskNames);
    let freshTasks = sampled.filter((t) => !cachedByName.has(t.name));
    if (freshTasks.length > 0) {
      const sandboxDir = join(opts.runDir, "sandbox"); // self-created; buildSandbox wipes it
      defaultBuildSandbox(snapshotReal(), sandboxDir);
      const scored = await scoreSuite(freshTasks, sandboxDir, join(opts.runDir, "calibration"), {model, runProbeFn: opts.runProbeFn});
      for (const r of scored.results) cachedByName.set(r.task, {pass: r.pass, trajectory: r.trajectory});
      log(`[calibrate] fresh probes: ${freshTasks.length} task(s)`);
    } else {
      log(`[calibrate] all ${sampled.length} trajectory(ies) reused from the baseline cache (fingerprint match)`);
    }
    for (const t of sampled) {
      const hit = cachedByName.get(t.name);
      if (hit === undefined) throw new Error(`calibrateJudge: no trajectory for task ${t.name} after cache+probe`);
      trajs.push({task: t.name, pass: hit.pass, trajectory: hit.trajectory, source: freshTasks.some((ft) => ft.name === t.name) ? "fresh" : "cache"});
    }
  }

  const rows: CalibrationRow[] = [];
  for (const traj of trajs) {
    const task = opts.tasks?.find((t) => t.name === traj.task);
    const originalPrompt = task !== undefined ? stripFrontmatter(readFileSync(task.paths.taskMd, "utf8")) : traj.task;
    const verdict = await (opts.judgeFn ?? defaultJudge)({
      prompt: originalPrompt,
      trajectory: traj.trajectory,
      workspaceState: traj.source === "cache"
        ? "(not retained — this trajectory was replayed from the result cache; judge on the trajectory and prompt only)"
        : captureWorkspaceState(join(opts.runDir, "calibration", "ws", traj.task)),
    }, {callModel: opts.callModel});
    rows.push({
      task: traj.task,
      checkerPass: traj.pass,
      judgeScore: verdict.score,
      judgePass: verdict.score >= JUDGE_PASS_THRESHOLD,
      abstained: verdict.abstained,
      rationale: verdict.rationale,
      trajectorySource: traj.source,
      rawPreview: verdict.rawPreview,
    });
  }

  const {agreement, abstained: abstainedRows} = computeAgreement(rows);
  const minAgreement = opts.minAgreement ?? 0.8;
  const freshCount = rows.filter((r) => r.trajectorySource === "fresh").length;
  const condition: "fresh" | "cached-trajectories" = freshCount === 0 && rows.length > 0 ? "cached-trajectories" : "fresh";
  // Gate: fresh-probe basis, ≥ MIN_CALIBRATION_SAMPLE rows, agreement ≥ threshold.
  const calibrated = condition === "fresh" && rows.length >= MIN_CALIBRATION_SAMPLE && agreement !== null && agreement >= minAgreement;

  mkdirSync(opts.runDir, {recursive: true});
  const reportPath = join(opts.runDir, "calibration.md");
  writeFileSync(reportPath, renderCalibrationReport(rows, agreement, calibrated, minAgreement, opts.model ?? null, trajSources(trajs), condition, abstainedRows));
  appendEntry({
    runId: basename(opts.runDir),
    ts: new Date().toISOString(),
    kind: "judge-calibration",
    agreement,
    judgeModel: opts.model ?? null,
    sample: rows.length,
    cacheHits: rows.filter((r) => r.trajectorySource === "cache").length,
    freshProbes: rows.filter((r) => r.trajectorySource === "fresh").length,
    condition,
    calibrated,
    note: condition === "cached-trajectories"
      ? "cache-only trajectories (cached-trajectories) — advisory regardless of agreement; re-measure with fresh probes"
      : rows.length < MIN_CALIBRATION_SAMPLE
        ? `sample too small (N<${MIN_CALIBRATION_SAMPLE}) — advisory regardless of agreement`
        : undefined,
  }, opts.ledgerPath);
  return {rows, agreement, calibrated, reportPath, judgeModel: opts.model ?? null, cacheHits: rows.filter((r) => r.trajectorySource === "cache").length, freshProbes: rows.filter((r) => r.trajectorySource === "fresh").length, condition};
}

function trajSources(trajs: Array<{source?: string}>): string {
  const cache = trajs.filter((t) => t.source === "cache").length;
  return `${cache} cached, ${trajs.length - cache} fresh`;
}

function renderCalibrationReport(rows: CalibrationRow[], agreement: number | null, calibrated: boolean, minAgreement: number, model: string | null, sources: string, condition: "fresh" | "cached-trajectories", abstainedRows: number): string {
  const out: string[] = [];
  out.push("# Judge calibration");
  out.push("");
  out.push(`- **model:** ${model ?? "<pi default>"}`);
  out.push(`- **trajectories:** ${sources}`);
  out.push(`- **condition:** ${condition}${condition === "cached-trajectories" ? " (cache-only basis — can never CALIBRATE, advisory regardless of agreement)" : ""}`);
  out.push(`- **sample:** ${rows.length} (min ${MIN_CALIBRATION_SAMPLE})${rows.length < MIN_CALIBRATION_SAMPLE ? ` — sample too small (N<${MIN_CALIBRATION_SAMPLE})` : ""}`);
  out.push(`- **agreement:** ${agreement === null ? "n/a" : `${(agreement * 100).toFixed(0)}%`} (threshold ${minAgreement}; abstained rows excluded: ${abstainedRows})`);
  out.push(`- **verdict:** ${calibrated ? "CALIBRATED — replay channel may inform selection" : "ADVISORY — replay channel stays advisory until a fresh-probe calibration reaches agreement ≥ " + minAgreement + " on ≥ " + MIN_CALIBRATION_SAMPLE + " rows"}`);
  out.push("");
  out.push("| task | checker | judge | judge pass (≥7) | agree | src | rationale |");
  out.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const agree = (r.judgeScore >= JUDGE_PASS_THRESHOLD) === r.checkerPass ? "✓" : "✗";
    out.push(`| ${r.task} | ${r.checkerPass ? "pass" : "FAIL"} | ${r.judgeScore}${r.abstained ? " (abstained)" : ""} | ${r.judgePass} | ${agree} | ${r.trajectorySource} | ${r.rationale.replaceAll("|", "\\|")} |`);
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Replay run orchestration (used by /hloop-replay)

export type ReplayRunRow = {
  taskId: string,
  quality: string,
  provenance: string,
  judge: JudgeVerdict,
  tokens: number,
  durationMs: number,
  exit: number | null,
  timedOut: boolean,
}

export type ReplayRunOptions = {
  sample?: number,
  mine?: number,
  runId?: string,
  callModel: CallModel,
  model?: string,
  runsDir?: string,
  outDir?: string,
  sessionsRootOverride?: string,
  judgeFn?: typeof defaultJudge,
  runProbeFn?: typeof runProbe,
  ledgerPath?: string,
  log?: (line: string) => void,
}

export type ReplayRunResult = {
  runId: string,
  rows: ReplayRunRow[],
  reportPath: string,
}

/**
 * Mine (or reuse already-materialized) replay tasks, probe + judge N of
 * them, write replay-report.md, append kind-"replay" ledger entries. Does
 * NOT touch task selection — the channel stays advisory (config
 * replay.enabled is false by default; see isCalibrated).
 */
export async function runReplayChannel(opts: ReplayRunOptions): Promise<ReplayRunResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const runId = opts.runId ?? newRunId();
  const runsDir = join(extensionRoot, "runs");
  const runDir = join(runsDir, runId);
  const outDir = opts.outDir ?? replayTasksRoot;

  log(`[hloop-replay] mining ${opts.mine ?? 8} candidate task(s) from session history...`);
  const mined = await mineReplayTasks({mine: opts.mine, outDir, sessionsRootOverride: opts.sessionsRootOverride});
  log(`[hloop-replay] ${mined.length} candidate(s) materialized under ${outDir}`);
  if (mined.length === 0) {
    const reportPath = join(runDir, "replay-report.md");
    mkdirSync(runDir, {recursive: true});
    writeFileSync(reportPath, "# Replay run — no candidates\n\nNo qualifying sessions were found (see loop/lib/replay.ts mining heuristics).\n");
    return {runId, rows: [], reportPath};
  }

  const sandboxDir = join(runDir, "sandbox"); // self-created; buildSandbox wipes it
  defaultBuildSandbox(snapshotReal(), sandboxDir);
  const rows: ReplayRunRow[] = [];
  for (const task of mined.slice(0, opts.sample ?? 3)) {
    const loaded = loadReplayTask(task.id, outDir);
    const wsRoot = join(runDir, "ws");
    mkdirSync(wsRoot, {recursive: true});
    const wsDir = join(wsRoot, task.id);
    const started = performance.now();
    const result = await probeReplayTask(loaded, sandboxDir, wsDir, {
      model: opts.model,
      rawJsonlPath: join(wsRoot, `${task.id}.raw.jsonl`),
      runProbeFn: opts.runProbeFn,
    });
    const durationMs = Math.round(performance.now() - started);
    // Privacy: no absolute home/session paths ever reach the report or ledger.
    const provenance = redactProvenanceText(task.provenance);
    const judge = await (opts.judgeFn ?? defaultJudge)({
      prompt: task.prompt,
      trajectory: result.trajectory,
      workspaceState: captureWorkspaceState(wsDir),
    }, {callModel: opts.callModel});
    rows.push({
      taskId: task.id,
      quality: task.quality,
      provenance,
      judge,
      tokens: result.usage?.totalTokens ?? 0,
      durationMs,
      exit: result.exit,
      timedOut: result.timedOut,
    });
    appendEntry({
      runId,
      ts: new Date().toISOString(),
      kind: "replay",
      taskId: task.id,
      quality: task.quality,
      provenance,
      judgeScore: judge.score,
      judgeAbstained: judge.abstained,
      rationale: judge.rationale,
      usage: {totalTokens: result.usage?.totalTokens ?? 0},
      durationMs,
    }, opts.ledgerPath);
    log(`[hloop-replay] ${task.id}: judge ${judge.score}${judge.abstained ? " (abstained)" : ""} — ${judge.rationale}${judge.rawPreview !== undefined ? ` | raw: ${JSON.stringify(judge.rawPreview.slice(0, 300))}` : ""}`);
  }

  mkdirSync(runDir, {recursive: true});
  const reportPath = join(runDir, "replay-report.md");
  writeFileSync(reportPath, renderReplayReport(runId, rows, opts.model ?? null));
  return {runId, rows, reportPath};
}

function renderReplayReport(runId: string, rows: ReplayRunRow[], model: string | null): string {
  const out: string[] = [];
  out.push(`# Replay run ${runId}`);
  out.push("");
  out.push(`- **model:** ${model ?? "<pi default>"}`);
  out.push(`- **tasks:** ${rows.length}`);
  out.push("");
  out.push("| task | quality | judge | abstained | tokens | duration |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    out.push(`| ${r.taskId} | ${r.quality} | ${r.judge.score} | ${r.judge.abstained ? "yes" : "no"} | ${r.tokens} | ${r.durationMs}ms |`);
  }
  out.push("");
  out.push("## Per-task detail");
  for (const r of rows) {
    out.push("");
    out.push(`### ${r.taskId}`);
    out.push("");
    out.push(`- **provenance:** ${r.provenance}`);
    out.push(`- **judge:** ${r.judge.score}/10${r.judge.abstained ? " (ABSTAINED — neutral 5)" : ""} — ${r.judge.rationale}`);
    out.push(`- **exit:** ${r.exit}${r.timedOut ? " (timed out)" : ""}, tokens ${r.tokens}`);
    if (r.judge.rawPreview !== undefined) {
      out.push(`- **judge raw output preview (parse failed):**`);
      out.push("```");
      out.push(r.judge.rawPreview);
      out.push("```");
    }
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI (selftest: read-only mining check against real sessions)

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "selftest") {
    const {mkdtempSync} = await import("node:fs");
    const {tmpdir} = await import("node:os");
    const outDir = mkdtempSync(join(tmpdir(), "replay-selftest-"));
    const tasks = await mineReplayTasks({mine: 8, outDir});
    console.log(`selftest: mined ${tasks.length} replay task(s) from real sessions (materialized in ${outDir})`);
    for (const t of tasks) console.log(`  ${t.id} [${t.quality}] score-informed provenance: ${t.provenance.slice(0, 120)}`);
    rmSync(outDir, {recursive: true, force: true});
  } else {
    console.error("usage: bun run loop/lib/replay.ts selftest");
    process.exitCode = 2;
  }
}
