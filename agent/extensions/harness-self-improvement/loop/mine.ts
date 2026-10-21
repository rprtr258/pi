/**
 * harness-loop (/hloop mine): mine real pi sessions for new suite tasks.
 *
 * The /hloop loop scores the harness on the fixed suite in loop/suite/ —
 * synthetic tasks the loop can memorize (Goodhart). This module reads the
 * REAL session transcripts under ~/.pi/agent/sessions/ (JSONL, format v3)
 * and extracts candidate episodes: a user request → agent work → outcome.
 *
 * DIFFICULTY IS THE POINT: hard tasks are what improve the harness. An
 * episode therefore ABSORBS its correction rounds — one full battle
 * (request → attempt → "no, still broken" → attempt → … until a
 * non-correction user reply) is ONE episode, and the signals that make it
 * valuable are preserved and scored: corrections (the traps), errored tool
 * results (error paths), repeated calls on the same file (churn),
 * self-revert commands (backing out of a broken attempt), and duration.
 * The drafting prompt (MINE_SYSTEM_PROMPT) is required to carry these
 * complications into the new task — self-contained, but not sanded down.
 *
 * Scope: only TOP-LEVEL session files (`<project>/*.jsonl`) are mined.
 * Nested `<project>/<sessionId>/<subagentId>/run-0/session.jsonl` files are
 * machine-generated probe/subagent transcripts (spawned by /hloop and
 * friends) — mining them would make the suite self-referential, which is
 * exactly the bias this feature exists to remove.
 *
 * Two stages, only the first is deterministic:
 *   1. scan    — parse session files, extract + score + dedupe episodes,
 *                write the full index to runs/mine/<stamp>/episodes.jsonl.
 *   2. draft   — (command side in index.ts) the top-N episodes go through a
 *                model call that drafts {TASK.md, check.ts, broken-files}
 *                into loop/suite-drafts/<name>/ — a GIT-TRACKED staging dir
 *                (review via git diff; loop/suite/ is NEVER written). A
 *                human reviews, reconstructs broken/ + ref/, deletes
 *                draft.json, and promotes with mv into loop/suite/<name>/.
 *
 * Privacy: request text is scrubbed for common secret shapes and truncated;
 * drafts are instruction to use relative paths only. Everything stays under
 * runs/mine/ (gitignored) pending human review.
 *
 * Usage:
 *   bun run loop/mine.ts scan [--limit N] [--project <glob>] [--out <path>]
 *   bun run loop/mine.ts selftest
 */
import {mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {homedir} from "node:os";
import {join} from "node:path";
import {globToRegExp} from "./driver.ts";

/** Tools whose successful call means the agent CHANGED files — task material. */
const WRITE_TOOLS = new Set(["write", "edit", "multiedit", "apply", "apply_patch", "notebook_edit"]);

const CHECK_COMMAND_RE = /(bun test|bun run check|\bnpm (test|run)|\bnpx (tsc|vitest|jest)|\btsc\b|pytest|cargo test|go test|\bmake\b|eslint|biome|ruff|pylint)/;

/** User follow-ups that mean the episode's first attempt FAILED. */
const CORRECTION_RE = /\b(no,|no —|not that|not what|wrong|instead|didn'?t work|doesn'?t work|didn'?t you|still (fails?|broken|not)|you broke|revert|undo|regress)/i;

/** A user episode absorbs at most this many correction rounds (loop guard). */
const MAX_CORRECTIONS = 8;

/** Bash commands that back out of a broken attempt (self-reverts). */
const REVERT_COMMAND_RE = /git (checkout|restore|reset)|git stash|jj (restore|abandon|new --before)/;

/** Frustration / difficulty markers in user text. */
const FRUSTRATION_RE = /\b(hard|difficult|tricky|fragile|weird|edge[ -]?case|annoying|stuck|struggle|wtf|ugh|damn|fuck|shit)\b/i;

/** Common secret shapes, redacted before anything is written to disk. */
const SECRET_RE = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|xox[bpars]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|eyJ[A-Za-z0-9_-]{20,})/g;

export type MinedEpisode = {
  sessionPath: string,
  project: string,
  ts: string | null,
  request: string,
  toolCalls: number,
  filesTouched: string[],
  commands: string[],
  ranCheck: boolean,
  checkFailed: boolean,
  corrected: boolean,
  /** Scrubbed user correction texts that extended the episode (the traps). */
  corrections: string[],
  /** Errored tool results — the error paths the agent had to recover from. */
  errorCount: number,
  /** Max calls on the same (tool, target) pair — churn/retry loops. */
  retryCount: number,
  /** git/jj back-out commands run by the agent itself. */
  selfReverts: number,
  /** First user message → last event of the episode. */
  durationMs: number | null,
  score: number,
};

type UserEvent = {kind: "user", text: string, ts: string | null};
type ToolCallEvent = {kind: "toolCall", id: string, name: string, args: Record<string, unknown>, ts: string | null};
type ToolResultEvent = {kind: "toolResult", id: string, toolName: string, isError: boolean, ts: string | null};
type SessionEvent = UserEvent | ToolCallEvent | ToolResultEvent;

function scrub(text: string): string {
  return text.replace(SECRET_RE, "[REDACTED]");
}

function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/**
 * Parse one session JSONL into a flat event stream. Unparseable lines are
 * skipped; only user text / assistant toolCalls / toolResults survive —
 * thinking blocks, model changes and custom events are irrelevant here.
 */
export function parseSessionFile(path: string): SessionEvent[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const events: SessionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line[0] !== "{") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "message" || e.message === null || typeof e.message !== "object") continue;
    const msg = e.message as Record<string, unknown>;
    const content = Array.isArray(msg.content) ? msg.content : [];
    if (msg.role === "user") {
      const text = content
        .filter((b): b is {type: "text", text: string} => b !== null && typeof b === "object"
          && (b as Record<string, unknown>).type === "text"
          && typeof (b as Record<string, unknown>).text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // Skip empties and injected context blocks (session start, system tags).
      if (text === "" || text.startsWith("<")) continue;
      events.push({kind: "user", text, ts: typeof e.timestamp === "string" ? e.timestamp : null});
    } else if (msg.role === "assistant") {
      for (const block of content) {
        if (block === null || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type !== "toolCall" || typeof b.name !== "string") continue;
        events.push({
          kind: "toolCall",
          id: typeof b.id === "string" ? b.id : "",
          name: b.name,
          args: (b.arguments !== null && typeof b.arguments === "object" ? b.arguments : {}) as Record<string, unknown>,
          ts: typeof e.timestamp === "string" ? e.timestamp : null,
        });
      }
    } else if (msg.role === "toolResult") {
      events.push({
        kind: "toolResult",
        id: typeof msg.toolCallId === "string" ? msg.toolCallId : "",
        toolName: typeof msg.toolName === "string" ? msg.toolName : "",
        isError: msg.isError === true,
        ts: typeof e.timestamp === "string" ? e.timestamp : null,
      });
    }
  }
  return events;
}

/**
 * Split the event stream into episodes (one per real user message, ending at
 * the next user message) and keep the ones with task material: at least one
 * write/edit call. `nextUserText` (the reply AFTER the episode) drives the
 * correction signal.
 */
export function extractEpisodes(sessionPath: string, project: string, events: SessionEvent[]): MinedEpisode[] {
  const out: MinedEpisode[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i]!;
    if (ev.kind !== "user") {
      i++;
      continue;
    }
    // One episode = the full battle: request → work → correction → work → …
    // until a NON-correction user reply (or session end). Corrections are
    // absorbed — they carry the traps the drafted task must preserve.
    let j = i + 1;
    const calls: ToolCallEvent[] = [];
    const results: ToolResultEvent[] = [];
    const corrections: string[] = [];
    let lastTs: string | null = ev.ts;
    for (;;) {
      while (j < events.length && events[j]!.kind !== "user") {
        const e2 = events[j]!;
        if (e2.kind === "toolCall") calls.push(e2);
        else if (e2.kind === "toolResult") results.push(e2);
        if (e2.ts !== null) lastTs = e2.ts;
        j++;
      }
      const nextUser = j < events.length && events[j]!.kind === "user" ? (events[j] as UserEvent) : null;
      const isCorrection = nextUser !== null && nextUser.text.length < 300 && CORRECTION_RE.test(nextUser.text);
      if (nextUser === null || !isCorrection || corrections.length >= MAX_CORRECTIONS) break;
      corrections.push(scrub(nextUser.text));
      j++; // absorb this correction round and keep the episode going
    }
    const episode = buildEpisode(sessionPath, project, ev, calls, results, corrections, lastTs);
    if (episode !== null) out.push(episode);
    i = j;
  }
  return out;
}

function buildEpisode(
  sessionPath: string,
  project: string,
  user: UserEvent,
  calls: ToolCallEvent[],
  results: ToolResultEvent[],
  corrections: string[],
  lastTs: string | null,
): MinedEpisode | null {
  const filesTouched: string[] = [];
  const commands: string[] = [];
  // (tool, target) → call count, for churn/retry detection.
  const targetCounts = new Map<string, number>();
  for (const c of calls) {
    if (WRITE_TOOLS.has(c.name)) {
      const p = c.args.path ?? c.args.file_path ?? c.args.filePath;
      if (typeof p === "string" && p !== "") {
        filesTouched.push(shortPath(p));
        const key = `${c.name}:${p}`;
        targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
      }
    } else if (c.name === "bash") {
      const cmd = c.args.command;
      if (typeof cmd === "string" && cmd !== "") {
        commands.push(cmd.slice(0, 120));
        const key = `bash:${cmd.slice(0, 60)}`;
        targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
      }
    }
  }
  // A question, an exploration, a chat — nothing was written, nothing to check.
  if (filesTouched.length === 0) return null;

  const resultMap = new Map<string, boolean>();
  for (const r of results) resultMap.set(r.id, r.isError);
  const checkCallIdx = commands.findIndex((c) => CHECK_COMMAND_RE.test(c));
  const bashCallIdxs = calls.flatMap((c, idx) => (c.name === "bash" ? [idx] : []));
  const ranCheck = checkCallIdx !== -1;
  const checkFailed = ranCheck && resultMap.get(calls[bashCallIdxs[checkCallIdx]!]?.id ?? "") === true;
  const corrected = corrections.length > 0;
  const errorCount = results.filter((r) => r.isError).length;
  const retryCount = Math.max(0, ...targetCounts.values());
  const selfReverts = commands.filter((c) => REVERT_COMMAND_RE.test(c)).length;
  const startMs = Date.parse(user.ts ?? "");
  const endMs = Date.parse(lastTs ?? "");
  const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : null;
  const frustrated = FRUSTRATION_RE.test(user.text) || corrections.some((c) => FRUSTRATION_RE.test(c));

  const request = scrub(user.text.length > 500 ? `${user.text.slice(0, 500)}…` : user.text);
  // Difficulty-first scoring: corrections and error paths are the gold.
  let score = 2; // has task material at all
  score += corrected ? 3 + 2 * Math.min(corrections.length - 1, 3) : 0; // +3, +5, +7, +9
  score += errorCount >= 3 ? 3 : errorCount >= 1 ? 2 : 0;
  score += retryCount >= 4 ? 3 : retryCount >= 2 ? 2 : 0;
  score += selfReverts >= 1 ? 2 : 0;
  score += durationMs !== null && durationMs >= 600_000 ? 2 : durationMs !== null && durationMs >= 180_000 ? 1 : 0;
  score += calls.length >= 15 ? 1 : 0; // long episode
  score += frustrated ? 2 : 0;
  score += ranCheck ? 1 : 0;
  score += checkFailed ? 1 : 0;
  score += request.length >= 20 && request.length <= 800 ? 1 : 0;

  return {
    sessionPath,
    project,
    ts: user.ts,
    request,
    toolCalls: calls.length,
    filesTouched: [...new Set(filesTouched)].slice(0, 8),
    commands: commands.slice(0, 5),
    ranCheck,
    checkFailed,
    corrected,
    corrections: corrections.slice(0, MAX_CORRECTIONS),
    errorCount,
    retryCount,
    selfReverts,
    durationMs,
    score,
  };
}

export type ScanOptions = {
  projectGlob?: string,
  /** Kept for API symmetry; dedupe + sort always run. */
  limit?: number,
};

export type ScanResult = {
  episodes: MinedEpisode[],
  filesScanned: number,
};

/**
 * Walk sessionsRoot/<escaped-cwd>/*.jsonl, extract episodes, dedupe by
 * normalized request text (same request mined twice = one episode), sort by
 * score desc then ts desc.
 */
export function scanSessions(sessionsRoot: string, opts: ScanOptions = {}): ScanResult {
  const projectRe = opts.projectGlob !== undefined ? globToRegExp(opts.projectGlob) : null;
  const all: MinedEpisode[] = [];
  let filesScanned = 0;
  let projects: string[] = [];
  try {
    projects = readdirSync(sessionsRoot, {withFileTypes: true}).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return {episodes: [], filesScanned: 0};
  }
  for (const project of projects.sort()) {
    if (projectRe !== null && !projectRe.test(project)) continue;
    const dir = join(sessionsRoot, project);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      filesScanned++;
      all.push(...extractEpisodes(path, project, parseSessionFile(path)));
    }
  }
  const seen = new Set<string>();
  const deduped = all.filter((ep) => {
    const key = ep.request.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => (b.score - a.score) || ((b.ts ?? "").localeCompare(a.ts ?? "")));
  return {episodes: deduped, filesScanned};
}

// ---------------------------------------------------------------------------
// Drafting (stage 2 — model call; the /hloop mine command drives it)

export const MINE_SYSTEM_PROMPT = `You convert one real coding-agent session episode into a candidate benchmark task for an agent harness evaluation suite. The task must be self-contained: an agent that has NEVER seen the source session should be able to attempt it in a fresh sandbox containing only the broken workspace files.

PRESERVE THE CHALLENGE — this is the whole point. These tasks exist to exercise an improved harness on real difficulty, not to be easy demo items. Whatever made the episode hard MUST survive into the drafted task: the trap that broke the first attempt (visible in the corrections), the edge cases, ordering constraints, fragile assumptions, formatting gotchas, and the error paths the agent had to recover from or back out of. Encode the complication in the broken/ starting state and make check.ts verify the CORRECT handling of it. Do NOT simplify the task into a generic easy version; if the complication cannot be reproduced without external context, say so in "discard" instead of shipping a sanded-down task.

Respond with ONLY a JSON object (no markdown fences, no prose):
{
  "name": "kebab-case task name categorized by WHAT THE TASK EXERCISES — the skill/domain it tests (suite conventions: git-*, jq-*, shell-*, ts-*, smoke-*; pick or extend sensibly). Never reference the origin: no 'mine-', 'session' or 'episode' in the name",
  "summary": "one-line description for the suite listing",
  "difficulty": "easy" | "medium" | "hard",
  "challenge": "the exact complication from the episode that made the work hard — the trap, edge case or failure mode that caused retries/errors/corrections — and how the drafted task preserves it",
  "task_md": "the full prompt text the agent under test will receive — self-contained, relative paths only, no real usernames/hosts/URLs/secrets, no reference to 'the user' or any session",
  "checker": "complete #!/usr/bin/env bun TypeScript source for check.ts: takes the workspace path as argv[2], is READ-ONLY, exits 0 iff the requested outcome is achieved INCLUDING the preserved complication, prints 'PASS: <reason>' or 'FAIL: <reason>'",
  "broken_files": [{"path": "relative path in the sandbox", "content": "the initial (broken) file content"}],
  "notes": "reconstruction notes for the human reviewer: how to build ref/, what to verify by hand, any caveats"
}
Rules: the task tests ONE bounded unit of work derivable from the episode request, at the episode's difficulty. The checker must be objective (file content, valid JSON, exit codes) — never subjective. If the episode is not convertible into such a task, return {"discard": "<reason>"}.`;

export function buildDraftPrompt(ep: MinedEpisode): string {
  const lines = [
    `Episode from a real coding-agent session.`,
    `Project context (escaped cwd): ${ep.project}`,
    `Timestamp: ${ep.ts ?? "unknown"}`,
    `Difficulty profile: ${ep.toolCalls} tool call(s), ${ep.errorCount} errored tool result(s), up to ${ep.retryCount} call(s) on the same target, ${ep.selfReverts} self-revert command(s)${ep.durationMs !== null ? `, duration ~${Math.round(ep.durationMs / 60_000)} min` : ""}.`,
    ``,
    `User request:`,
    ep.request,
    ``,
  ];
  if (ep.corrections.length > 0) {
    lines.push(`The user corrected the agent ${ep.corrections.length} time(s) during this episode — the first attempt(s) were WRONG. These corrections reveal the traps the drafted task must preserve:`);
    for (const [n, c] of ep.corrections.entries()) lines.push(`  correction ${n + 1}: ${c.replace(/\n+/g, " ")}`);
    lines.push(``);
  }
  lines.push(
    `Files the agent created/modified: ${ep.filesTouched.join(", ") || "(none recorded)"}`,
    `Shell commands run: ${ep.commands.length > 0 ? ep.commands.map((c) => JSON.stringify(c)).join("; ") : "(none)"}`,
    ep.ranCheck ? `A check/test command ran${ep.checkFailed ? " and FAILED at least once before (presumably) being fixed" : " and passed"}.` : `No check/test command ran in the episode.`,
    ``,
    `Draft the benchmark task JSON now — preserve the challenge (see system prompt), keep it self-contained.`,
  );
  return lines.join("\n");
}

export type TaskDraft = {
  name: string,
  summary: string,
  difficulty: string,
  challenge: string,
  taskMd: string,
  checker: string,
  brokenFiles: {path: string, content: string}[],
  notes: string,
};

/** Parse + validate the model's draft JSON; throws with a readable message. */
export function extractDraft(raw: string): TaskDraft {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in model response");
  const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  if (typeof obj.discard === "string") throw new Error(`model discarded the episode: ${obj.discard}`);
  for (const field of ["name", "summary", "difficulty", "challenge", "task_md", "checker"] as const) {
    if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
      throw new Error(`draft JSON missing or empty field '${field}'`);
    }
  }
  const name = (obj.name as string).trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const brokenFiles = Array.isArray(obj.broken_files)
    ? obj.broken_files
      .filter((f): f is {path: string, content: string} => f !== null && typeof f === "object"
        && typeof (f as Record<string, unknown>).path === "string"
        && typeof (f as Record<string, unknown>).content === "string")
      .map((f) => ({path: f.path, content: f.content}))
    : [];
  return {
    name,
    summary: obj.summary as string,
    difficulty: obj.difficulty as string,
    challenge: obj.challenge as string,
    taskMd: obj.task_md as string,
    checker: obj.checker as string,
    brokenFiles,
    notes: typeof obj.notes === "string" ? obj.notes : "",
  };
}

/** Timestamp stamp for a mine run directory, same shape as driver runIds. */
export function mineStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

// ---------------------------------------------------------------------------
// CLI

export function printEpisodes(eps: MinedEpisode[], limit: number): void {
  const top = eps.slice(0, limit);
  for (const [i, ep] of top.entries()) {
    const mins = ep.durationMs !== null ? `${Math.max(1, Math.round(ep.durationMs / 60_000))}m` : "";
    const flags = [
      ep.corrections.length > 0 ? `corr=${ep.corrections.length}` : "",
      ep.errorCount > 0 ? `err=${ep.errorCount}` : "",
      ep.retryCount > 1 ? `retry=${ep.retryCount}` : "",
      ep.selfReverts > 0 ? `revert=${ep.selfReverts}` : "",
      mins,
      ep.ranCheck ? "check" : "",
      ep.checkFailed ? "check-FAILED" : "",
    ].filter((f) => f !== "").join(",") || "plain";
    console.log(`#${i + 1} score=${ep.score} [${flags}] ${ep.project} (${ep.ts ?? "?"})`);
    console.log(`   ${ep.request.replace(/\n+/g, " ").slice(0, 160)}`);
    for (const [n, c] of ep.corrections.slice(0, 2).entries()) console.log(`   ↳ correction ${n + 1}: ${c.replace(/\n+/g, " ").slice(0, 120)}`);
    console.log(`   files: ${ep.filesTouched.slice(0, 4).join(", ")}${ep.filesTouched.length > 4 ? ", …" : ""}`);
  }
  if (eps.length > top.length) console.log(`… and ${eps.length - top.length} more (full index written to the output path)`);
}

function runScan(argv: string[]): void {
  let limit = 20;
  let projectGlob: string | undefined;
  let outPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i] === "--project") projectGlob = argv[++i];
    else if (argv[i] === "--out") outPath = argv[++i];
  }
  const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
  console.log(`[mine] scanning ${sessionsRoot}${projectGlob !== undefined ? ` (project glob: ${projectGlob})` : ""} ...`);
  const {episodes, filesScanned} = scanSessions(sessionsRoot, {projectGlob});
  console.log(`[mine] scanned ${filesScanned} session file(s), ${episodes.length} candidate episode(s):`);
  printEpisodes(episodes, limit);
  if (outPath !== undefined) {
    mkdirSync(outPath.substring(0, outPath.lastIndexOf("/")) || ".", {recursive: true});
    writeFileSync(outPath, episodes.map((e) => JSON.stringify(e)).join("\n") + (episodes.length > 0 ? "\n" : ""));
    console.log(`[mine] index written: ${outPath}`);
  }
}

// ---------------------------------------------------------------------------
// Selftest — fake session files in a temp dir, NO real sessions touched.

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ok: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

function writeSession(dir: string, project: string, lines: unknown[]): string {
  const path = join(dir, project, "session.jsonl");
  mkdirSync(join(dir, project), {recursive: true});
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

function userMsg(text: string, offsetMs: number = 0): unknown {
  return {type: "message", id: Math.random().toString(36).slice(2, 10), timestamp: new Date(Date.now() + offsetMs).toISOString(), message: {role: "user", content: [{type: "text", text}]}};
}

function assistantMsg(toolCalls: {id: string, name: string, args?: Record<string, unknown>}[], offsetMs: number = 0): unknown {
  return {
    type: "message",
    id: Math.random().toString(36).slice(2, 10),
    timestamp: new Date(Date.now() + offsetMs).toISOString(),
    message: {role: "assistant", content: toolCalls.map((t) => ({type: "toolCall", id: t.id, name: t.name, arguments: t.args ?? {}}))},
  };
}

function toolResult(callId: string, toolName: string, isError: boolean, offsetMs: number = 0): unknown {
  return {type: "message", id: Math.random().toString(36).slice(2, 10), timestamp: new Date(Date.now() + offsetMs).toISOString(), message: {role: "toolResult", toolCallId: callId, toolName, isError, content: [{type: "text", text: isError ? "error" : "ok"}]}};
}

function runSelftest(): void {
  const dir = join(tmpdir(), `mine-selftest-${process.pid}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(dir, {recursive: true});
  try {
    console.log("== scenario: episode with correction + failed check is extracted and scored high ==");
    const good = writeSession(dir, "proj-a", [
      userMsg("fix the off-by-one in src/parser.ts so parse('a2b') counts 2 items"),
      assistantMsg([{id: "c1", name: "read", args: {path: "/tmp/ws/src/parser.ts"}}]),
      toolResult("c1", "read", false),
      assistantMsg([
        {id: "c2", name: "edit", args: {path: "/tmp/ws/src/parser.ts"}},
        {id: "c3", name: "bash", args: {command: "bun test src/parser.test.ts"}},
      ]),
      toolResult("c2", "edit", false),
      toolResult("c3", "bash", true),
      userMsg("no, still broken — the counter must skip escaped quotes too"),
    ]);
    const goodEvents = parseSessionFile(good);
    const goodEps = extractEpisodes(good, "proj-a", goodEvents);
    ok(goodEps.length === 1, `one episode extracted (got ${goodEps.length})`);
    const ep = goodEps[0]!;
    ok(ep.corrected === true, "correction detected from the follow-up user message");
    ok(ep.corrections.length === 1, "correction text captured");
    ok(ep.ranCheck === true, "check command detected");
    ok(ep.checkFailed === true, "check failure paired via toolCallId");
    ok(ep.filesTouched.includes("/tmp/ws/src/parser.ts"), "filesTouched contains the edit target");
    ok(ep.score === 10, `score matches difficulty formula (got ${ep.score})`);

    console.log("== scenario: a multi-round battle merges into ONE episode with error/retry/revert signals ==");
    const battle = writeSession(dir, "proj-e", [
      userMsg("fix the serializer — it must round-trip nested arrays", 0),
      assistantMsg([{id: "b1", name: "read", args: {path: "/tmp/ws/src/serializer.ts"}}]),
      toolResult("b1", "read", false),
      assistantMsg([
        {id: "b2", name: "edit", args: {path: "/tmp/ws/src/serializer.ts"}},
        {id: "b3", name: "bash", args: {command: "bun test src/serializer.test.ts"}},
      ]),
      toolResult("b2", "edit", false),
      toolResult("b3", "bash", true),
      assistantMsg([
        {id: "b4", name: "edit", args: {path: "/tmp/ws/src/serializer.ts"}},
        {id: "b5", name: "bash", args: {command: "bun test src/serializer.test.ts"}},
      ]),
      toolResult("b4", "edit", false),
      toolResult("b5", "bash", true),
      assistantMsg([{id: "b6", name: "bash", args: {command: "git checkout -- src/serializer.ts"}}]),
      toolResult("b6", "bash", false),
      userMsg("still broken, this is tricky — nested empty arrays come back as null", 6 * 60_000),
      assistantMsg([
        {id: "b7", name: "edit", args: {path: "/tmp/ws/src/serializer.ts"}},
        {id: "b8", name: "bash", args: {command: "bun test src/serializer.test.ts"}},
      ]),
      toolResult("b7", "edit", false),
      toolResult("b8", "bash", true),
      assistantMsg([{id: "b9", name: "edit", args: {path: "/tmp/ws/src/serializer.ts"}}], 12 * 60_000),
      toolResult("b9", "edit", false, 12 * 60_000),
      userMsg("thanks, works now", 13 * 60_000),
    ]);
    const battleEps = extractEpisodes(battle, "proj-e", parseSessionFile(battle));
    ok(battleEps.length === 1, `correction round absorbed — one battle, one episode (got ${battleEps.length})`);
    const bep = battleEps[0]!;
    ok(bep.corrections.length === 1 && bep.corrections[0]!.includes("empty arrays"), "correction text (the trap) preserved in the episode");
    ok(bep.errorCount === 3, `errored tool results counted (got ${bep.errorCount})`);
    ok(bep.retryCount === 4, `repeated calls on the same file counted (got ${bep.retryCount})`);
    ok(bep.selfReverts === 1, "self-revert command counted");
    ok(bep.durationMs !== null && bep.durationMs >= 10 * 60_000, `episode duration spans the battle (got ${bep.durationMs})`);
    ok(bep.score >= 18, `difficulty signals compound in the score (got ${bep.score})`);

    console.log("== scenario: question-only session (no writes) yields nothing ==");
    const question = writeSession(dir, "proj-b", [
      userMsg("what does the score function do?"),
      assistantMsg([{id: "q1", name: "read", args: {path: "/tmp/ws/src/score.ts"}}]),
      toolResult("q1", "read", false),
      userMsg("thanks"),
    ]);
    const qEps = extractEpisodes(question, "proj-b", parseSessionFile(question));
    ok(qEps.length === 0, `no episode without write/edit calls (got ${qEps.length})`);

    console.log("== scenario: secrets are redacted and injected context skipped ==");
    const secret = writeSession(dir, "proj-c", [
      userMsg("deploy with sk-abcdef1234567890abcdef and also fix config.json"),
      assistantMsg([{id: "s1", name: "write", args: {path: "/tmp/ws/config.json"}}]),
      toolResult("s1", "write", false),
      userMsg("<system-reminder>injected noise</system-reminder>"),
      assistantMsg([{id: "s2", name: "edit", args: {path: "/tmp/ws/other.json"}}]),
      toolResult("s2", "edit", false),
    ]);
    const sEps = extractEpisodes(secret, "proj-c", parseSessionFile(secret));
    ok(sEps.length === 1, `injected <system-...> user message did not split/produce an episode (got ${sEps.length})`);
    ok(!sEps[0]!.request.includes("sk-abcdef"), "secret pattern redacted from request");

    console.log("== scenario: scanSessions dedupes identical requests, sorts by score, skips nested probe transcripts ==");
    writeSession(dir, "proj-d", [
      userMsg("fix the off-by-one in src/parser.ts so parse('a2b') counts 2 items"),
      assistantMsg([{id: "d1", name: "write", args: {path: "/tmp/ws/src/parser.ts"}}]),
      toolResult("d1", "write", false),
    ]);
    // Nested machine-generated probe transcript — must be IGNORED by the scan.
    const nested = join(dir, "proj-d", "20261101T000000_uuid", "subagent-uuid", "run-0");
    mkdirSync(nested, {recursive: true});
    writeFileSync(join(nested, "session.jsonl"), [userMsg("probe task"), assistantMsg([{id: "n1", name: "write", args: {path: "/tmp/ws/x.ts"}}]), toolResult("n1", "write", false)].map((l) => JSON.stringify(l)).join("\n") + "\n");
    const scan = scanSessions(dir);
    ok(scan.filesScanned === 5, `five top-level session files scanned, nested probe transcript ignored (got ${scan.filesScanned})`);
    ok(scan.episodes.length === 3, `identical request deduped across files (got ${scan.episodes.length})`);
    ok(scan.episodes[0]!.score === 20 && scan.episodes[0]!.corrections.length === 1, "highest-scored (the battle) episode sorts first");

    console.log("== scenario: extractDraft validates and normalizes ==");
    const draft = extractDraft('```json\n{"name":"Parser Fix","summary":"s","difficulty":"hard","challenge":"the escaped-quote trap","task_md":"body","checker":"#!/usr/bin/env bun","broken_files":[{"path":"a.ts","content":"x"}],"notes":"n"}\n```');
    ok(draft.name === "parser-fix", `name normalized to kebab, categorized by the task itself — origin NOT forced (got '${draft.name}')`);
    ok(draft.challenge === "the escaped-quote trap", "challenge (preserved complication) parsed");
    ok(draft.brokenFiles.length === 1, "broken_files parsed");
    let threw = false;
    try {
      extractDraft('{"name":"x","summary":"s"}');
    } catch {
      threw = true;
    }
    ok(threw, "missing required fields throw");

    console.log(`selftest: ${passed} check(s) passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "scan") runScan(rest);
  else if (cmd === "selftest") runSelftest();
  else console.error("usage: bun run loop/mine.ts scan [--limit N] [--project <glob>] [--out <path>] | selftest");
}
