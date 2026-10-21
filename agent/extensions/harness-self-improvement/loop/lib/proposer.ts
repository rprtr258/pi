#!/usr/bin/env bun
/**
 * Proposer for the harness self-improvement loop (Step 4): candidate
 * generation + validation.
 *
 * CORE IS PURE: `propose()` takes a `callModel(system, user, opts)` async
 * function (unit tests inject a fake; the /hloop-propose command in index.ts
 * binds a thin adapter to ctx.modelRegistry.streamSimple — the only place
 * that touches the live model). Prompt build, response parse, repair retry,
 * and validation are all synchronous/testable.
 *
 * PROMPT COMPONENT INCLUSION (documented choice):
 *   - AGENTS.md is included in FULL (it is small here: <4KB and always-on
 *     context, so the Proposer must see exactly what every session sees).
 *   - A manifest of ALL skill files (relPath + byte size + one-line
 *     description from the SKILL.md frontmatter when present) is always
 *     included, so the Proposer knows what exists even when a file's body
 *     does not fit.
 *   - FULL content of skill files is included in a deterministic priority
 *     order until PROMPT_CHAR_BUDGET (150_000 chars) is reached: skills whose
 *     top-level directory name is referenced by name in AGENTS.md first
 *     (word-boundary match, snapshot order), then all remaining files by
 *     relPath ascending (UTF-16 code-unit order, matching the snapshot).
 *     Greedy: each file is included if the running total still fits the
 *     budget, skipped otherwise; later (smaller) files may still fit.
 *   - The Proposer is told explicitly: new skills = full new content;
 *     editing an INCLUDED skill = full rewritten content; editing a skill
 *     NOT included in the prompt is not possible this round.
 *
 * LEDGER DIGEST ENTRY SHAPE (appended by Step 5 when a proposal is rejected):
 *   {runId, ts, kind: "proposal-rejected", proposalFingerprint: <sha256 hex>,
 *    scores: {passCount, total}, usage: {totalTokens}, reasons: string[],
 *    candidateFingerprints?: string[]}
 * `buildLedgerDigest()` also tolerates entries with decision: "rejected"
 * instead of the kind, and reads the fingerprint from `proposalFingerprint`
 * (falling back to `fingerprint`). Digest = the last 20 such fingerprints.
 *
 * PROPOSAL FINGERPRINT (canonical form, used for dedupe):
 *   sha256 hex over the concatenation of every edit's key across ALL
 *   candidates in the proposal, where an edit key is
 *     `${path}\0${content ?? "<deleted>"}`
 *   sorted ascending (UTF-16 code-unit order) before concatenation. The NUL
 *   separator makes path/content boundaries unambiguous; deleted files use
 *   the "<deleted>" sentinel so a delete never collides with an empty-file
 *   write.
 */
import {createHash} from "node:crypto";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import type {ComponentSnapshot, SkillSnapshot} from "./stage.ts";
import type {LedgerEntry} from "./ledger.ts";

// ---------------------------------------------------------------------------
// Types

export interface BaselineTask {
  task: string;
  category: string;
  pass: boolean;
  durationMs: number;
  tokens: number;
  /** Full checker stdout+stderr as recorded by the run. */
  checkerOutput: string;
}

export interface BaselineData {
  tasks: BaselineTask[];
  aggregate: {passCount: number; total: number};
}

export interface ProposedEdit {
  path: string;
  /** null = delete the file. */
  content: string | null;
}

export interface ProposedCandidate {
  rationale: string;
  edits: ProposedEdit[];
  /** sha256 over this candidate's edits (null when structurally invalid). */
  fingerprint: string | null;
  verdict: "accepted" | "rejected";
  reasons: string[];
}

export interface ProposeResult {
  candidates: ProposedCandidate[];
  /** sha256 over all candidates combined (the dedupe key, see file header). */
  proposalFingerprint: string;
  /** True when the JSON repair retry fired. */
  repairRetried: boolean;
  /** Set when the model output could not be parsed even after repair. */
  parseError?: string;
  /** First RAW_PREVIEW_CHARS of the (last) model output when parsing failed —
   *  debugging aid for the /hloop-propose debug command. */
  rawPreview?: string;
}

/** Async model call the core logic depends on; faked in unit tests. */
export type CallModel = (system: string, user: string, options?: {temperature?: number}) => Promise<string>;

export interface ProposeInput {
  snapshot: ComponentSnapshot;
  baseline: BaselineData;
  /** Rejected proposal fingerprints from the ledger (most recent last). */
  ledgerDigest: string[];
  /** Content of harness-findings.md when present; absent is fine. */
  harnessFindings?: string;
  /** Recorded on the result for logging; never selects the model itself. */
  model?: string;
  /** Sampling temperature for the generation call (repair uses 0). */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Input assembly

const PROMPTS_DIR = new URL("../prompts/", import.meta.url);

/** Load the system-prompt template from loop/prompts/proposer.md. */
export function loadSystemPromptTemplate(): string {
  return readFileSync(new URL("proposer.md", PROMPTS_DIR), "utf8");
}

/** Byte size of a string (UTF-8). */
function byteSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Extract a one-line description from SKILL.md frontmatter, capped. */
export function skillDescription(content: string, cap = 160): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!frontmatter) return "";
  const line = /^description:\s*(.+)$/m.exec(frontmatter[1]!);
  if (!line) return "";
  const desc = line[1]!.trim().replace(/^["']|["']$/g, "");
  return desc.length > cap ? `${desc.slice(0, cap - 1)}…` : desc;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Top-level skill dir names (from a snapshot's relPaths). */
export function skillDirNames(skills: Array<{relPath: string}>): string[] {
  const dirs: string[] = [];
  for (const skill of skills) {
    const top = skill.relPath.split("/")[0]!;
    if (!dirs.includes(top)) dirs.push(top);
  }
  return dirs;
}

/** Skill dir names referenced by name (word-boundary match) in AGENTS.md. */
export function referencedSkillDirs(agentsMd: string, dirs: string[]): Set<string> {
  const referenced = new Set<string>();
  if (agentsMd === "") return referenced;
  for (const dir of dirs) {
    if (new RegExp(`(^|[^\\w-])${escapeRegex(dir)}([^\\w-]|$)`).test(agentsMd)) referenced.add(dir);
  }
  return referenced;
}

export const PROMPT_CHAR_BUDGET = 150_000;

export interface SkillInclusion {
  included: SkillSnapshot[];
  /** One manifest line per snapshot skill file, manifest order. */
  manifestLines: string[];
  /** Char total of the FULL contents included under the budget. */
  includedChars: number;
}

/**
 * Choose which skill files are included in FULL and build the manifest of
 * ALL skill files. See the file header for the documented policy.
 */
export function includeSkills(snapshot: ComponentSnapshot, budget: number = PROMPT_CHAR_BUDGET): SkillInclusion {
  const dirs = skillDirNames(snapshot.skills);
  const referenced = referencedSkillDirs(snapshot.agentsMd, dirs);
  const referencedFirst = snapshot.skills.filter((s) => referenced.has(s.relPath.split("/")[0]!));
  const rest = snapshot.skills
    .filter((s) => !referenced.has(s.relPath.split("/")[0]!))
    .sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  const ordered = [...referencedFirst, ...rest];

  const included: SkillSnapshot[] = [];
  let used = 0;
  for (const skill of ordered) {
    if (used + skill.content.length <= budget) {
      included.push(skill);
      used += skill.content.length;
    }
  }

  const manifestLines = snapshot.skills.map((s) => {
    const desc = s.relPath.endsWith("SKILL.md") ? skillDescription(s.content) : "";
    return `- ${s.relPath} (${byteSize(s.content)}B)${desc === "" ? "" : ` — ${desc}`}`;
  });
  return {included, manifestLines, includedChars: used};
}

/** Load per-task results from runs/<runId>/tasks/*.json into BaselineData. */
export function loadBaselineFromRunDir(runDir: string): BaselineData {
  const tasksDir = join(runDir, "tasks");
  if (!existsSync(tasksDir)) throw new Error(`no tasks/ directory under ${runDir}`);
  const files = readdirSync(tasksDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`no task result files under ${tasksDir}`);
  const tasks: BaselineTask[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(tasksDir, file), "utf8")) as Record<string, unknown>;
    tasks.push({
      task: String(raw["task"] ?? file.replace(/\.json$/, "")),
      category: String(raw["category"] ?? ""),
      pass: raw["pass"] === true,
      durationMs: typeof raw["durationMs"] === "number" ? raw["durationMs"] : 0,
      tokens: typeof (raw["usage"] as Record<string, unknown> | undefined)?.["totalTokens"] === "number"
        ? (raw["usage"] as Record<string, number>)["totalTokens"]!
        : 0,
      checkerOutput: typeof raw["checkerOutput"] === "string" ? raw["checkerOutput"] : "",
    });
  }
  return {
    tasks,
    aggregate: {passCount: tasks.filter((t) => t.pass).length, total: tasks.length},
  };
}

/**
 * Extract the last `limit` rejected-proposal fingerprints from ledger entries.
 * Accepts kind "proposal-rejected" (Step 5 shape, see file header) or
 * decision "rejected"; fingerprint from proposalFingerprint, falling back to
 * fingerprint. Unknown shapes are skipped.
 */
export function buildLedgerDigest(entries: LedgerEntry[], limit = 20): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const rejected = entry.kind === "proposal-rejected" || entry["decision"] === "rejected";
    if (!rejected) continue;
    const fp = entry["proposalFingerprint"] ?? entry["fingerprint"];
    if (typeof fp === "string" && fp !== "") out.push(fp);
  }
  return out.slice(-limit);
}

// ---------------------------------------------------------------------------
// Fingerprinting

export function candidateFingerprint(edits: ProposedEdit[]): string {
  const hash = createHash("sha256");
  for (const key of edits.map((e) => `${e.path}\0${e.content ?? "<deleted>"}`).sort()) hash.update(key);
  return hash.digest("hex");
}

export function proposalFingerprintOf(candidates: Array<{edits: ProposedEdit[]}>): string {
  const hash = createHash("sha256");
  const keys: string[] = [];
  for (const candidate of candidates) for (const e of candidate.edits) keys.push(`${e.path}\0${e.content ?? "<deleted>"}`);
  for (const key of keys.sort()) hash.update(key);
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Prompt build

export const AGENTS_MD_CAP_BYTES = 48 * 1024;
export const FILE_CAP_BYTES = 100 * 1024;
export const MAX_FILES_PER_CANDIDATE = 6;
export const CHECKER_TAIL_LINES = 10;

export interface BuiltPrompt {
  system: string;
  user: string;
}

/**
 * Build the system + user prompt. The system prompt template
 * (loop/prompts/proposer.md) contains {{COMPONENTS}}, {{BASELINE}},
 * {{LEDGER}} and {{HARNESS_FINDINGS}} placeholders that are substituted here.
 */
export function buildPrompt(input: ProposeInput, template: string = loadSystemPromptTemplate()): BuiltPrompt {
  const inclusion = includeSkills(input.snapshot);

  const components: string[] = [];
  components.push("## AGENTS.md (full text)");
  components.push("```markdown");
  components.push(input.snapshot.agentsMd === "" ? "(empty)" : input.snapshot.agentsMd);
  components.push("```");
  components.push("");
  components.push(`## Skills manifest (ALL ${input.snapshot.skills.length} skill files; full contents below only where marked INCLUDED)`);
  components.push(...inclusion.manifestLines);
  components.push("");
  components.push(`## Included skill file contents (${inclusion.included.length} files, ${inclusion.includedChars} chars; everything else is manifest-only this round)`);
  for (const skill of inclusion.included) {
    components.push(`### skills-source: ${skill.relPath}`);
    components.push("```markdown");
    components.push(skill.content);
    components.push("```");
  }
  const componentsText = components.join("\n");

  const baseline: string[] = [];
  baseline.push(`Aggregate: ${input.baseline.aggregate.passCount}/${input.baseline.aggregate.total} tasks pass`);
  baseline.push("");
  baseline.push("| task | category | pass | duration | tokens |");
  baseline.push("| --- | --- | --- | --- | --- |");
  for (const t of input.baseline.tasks) {
    baseline.push(`| ${t.task} | ${t.category} | ${t.pass ? "pass" : "FAIL"} | ${t.durationMs}ms | ${t.tokens} |`);
  }
  const failed = input.baseline.tasks.filter((t) => !t.pass);
  if (failed.length === 0) {
    baseline.push("");
    baseline.push("All tasks pass. Improvements should target robustness and quality of how the harness works, not fixes for failures — there are none.");
  } else {
    baseline.push("");
    baseline.push("## Failure checker output (verbatim tail)");
    for (const t of failed) {
      baseline.push(`### ${t.task}`);
      baseline.push("```");
      for (const line of t.checkerOutput.split("\n").filter((l) => l.trim() !== "").slice(-CHECKER_TAIL_LINES)) baseline.push(line);
      baseline.push("```");
    }
  }
  const baselineText = baseline.join("\n");

  const ledgerText = input.ledgerDigest.length === 0
    ? "(no rejected proposals recorded yet)"
    : input.ledgerDigest.map((fp, i) => `${i + 1}. ${fp}`).join("\n");

  const findingsText = input.harnessFindings === undefined || input.harnessFindings.trim() === ""
    ? "(no harness-findings.md present this round)"
    : input.harnessFindings;

  const system = template
    .replaceAll("{{COMPONENTS}}", componentsText)
    .replaceAll("{{BASELINE}}", baselineText)
    .replaceAll("{{LEDGER}}", ledgerText)
    .replaceAll("{{HARNESS_FINDINGS}}", findingsText);

  const user = [
    "Propose 1–3 candidates now.",
    input.model === undefined ? "" : `(model note: this call runs on ${input.model})`,
    "Respond with ONLY the JSON array — no prose before or after it.",
  ].filter((l) => l !== "").join("\n");
  return {system, user};
}

// ---------------------------------------------------------------------------
// Response parsing

export interface ExtractResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Robust JSON extraction: fenced ```json blocks first (then any ``` fence
 * containing an array), then the outermost bare [...] span.
 */
export function extractJsonArray(text: string): ExtractResult {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  for (const match of fenced) {
    try {
      const parsed = JSON.parse(match[1]!.trim()) as unknown;
      if (Array.isArray(parsed)) return {ok: true, value: parsed};
    } catch {
      // try the next fence
    }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) return {ok: true, value: parsed};
    } catch (err) {
      return {ok: false, error: err instanceof Error ? err.message : String(err)};
    }
  }
  return {ok: false, error: "no JSON array found in model output"};
}

function parseCandidates(value: unknown): {ok: true; candidates: Array<{rationale: string; edits: ProposedEdit[]}>} | {ok: false; error: string} {
  if (!Array.isArray(value)) return {ok: false, error: "top-level value is not an array"};
  const out: Array<{rationale: string; edits: ProposedEdit[]}> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") return {ok: false, error: "candidate entry is not an object"};
    const c = item as Record<string, unknown>;
    if (typeof c["rationale"] !== "string") return {ok: false, error: "candidate.rationale is not a string"};
    if (!Array.isArray(c["edits"])) return {ok: false, error: "candidate.edits is not an array"};
    const edits: ProposedEdit[] = [];
    for (const edit of c["edits"]) {
      if (edit === null || typeof edit !== "object") return {ok: false, error: "edit entry is not an object"};
      const e = edit as Record<string, unknown>;
      if (typeof e["path"] !== "string") return {ok: false, error: "edit.path is not a string"};
      const content = e["content"];
      if (content !== null && typeof content !== "string") return {ok: false, error: "edit.content must be a string or null"};
      edits.push({path: e["path"], content: content === null ? null : content});
    }
    out.push({rationale: c["rationale"], edits});
  }
  return {ok: true, candidates: out};
}

// ---------------------------------------------------------------------------
// Validation

// Allowlist (case-sensitive on purpose: case variants must be rejected):
// AGENTS.md, or skills/<skill-dir>/SKILL.md or skills/<skill-dir>/scripts/<file>.
const PATH_ALLOWLIST: RegExp[] = [
  /^AGENTS\.md$/,
  /^skills\/[a-z0-9][a-z0-9_-]*\/(SKILL\.md|scripts\/[A-Za-z0-9_.-]+)$/,
];

/** Validate one edit's path against the allowlist; returns a reject reason or null. */
export function validatePath(path: string): string | null {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return `absolute path rejected: ${path}`;
  if (path.split("/").includes("..")) return `path traversal (..) rejected: ${path}`;
  if (!PATH_ALLOWLIST.some((re) => re.test(path))) return `path outside the allowlist (AGENTS.md or skills/<dir>/SKILL.md|scripts/<file>, lowercase): ${path}`;
  return null;
}

export interface ValidationLimits {
  agentsMdCapBytes?: number;
  fileCapBytes?: number;
  maxFilesPerCandidate?: number;
}

/** Validate one candidate's structure + caps; returns the list of reject reasons (empty = accept). */
export function validateCandidate(edits: ProposedEdit[], limits: ValidationLimits = {}): string[] {
  const agentsMdCap = limits.agentsMdCapBytes ?? AGENTS_MD_CAP_BYTES;
  const fileCap = limits.fileCapBytes ?? FILE_CAP_BYTES;
  const maxFiles = limits.maxFilesPerCandidate ?? MAX_FILES_PER_CANDIDATE;
  const reasons: string[] = [];
  if (edits.length < 1) reasons.push("candidate has no edits (at least 1 required)");
  if (edits.length > maxFiles) reasons.push(`candidate touches ${edits.length} files (max ${maxFiles})`);
  for (const edit of edits) {
    const pathReason = validatePath(edit.path);
    if (pathReason !== null) reasons.push(pathReason);
    if (edit.content !== null) {
      if (edit.path === "AGENTS.md" && byteSize(edit.content) > agentsMdCap) {
        reasons.push(`AGENTS.md edit is ${byteSize(edit.content)} bytes (cap ${agentsMdCap})`);
      }
      if (byteSize(edit.content) > fileCap) reasons.push(`edit for ${edit.path} is ${byteSize(edit.content)} bytes (cap ${fileCap})`);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Core

export interface ProposeDeps {
  /** The model call; inject a fake in tests, ctx.modelRegistry in the command. */
  callModel: CallModel;
  /** System-prompt template override (tests); default reads loop/prompts/proposer.md. */
  systemPromptTemplate?: string;
}

const DEFAULT_TEMPERATURE = 0.7;
const RAW_PREVIEW_CHARS = 2000;

/**
 * Generate and validate candidates. Never throws for model/parse outcomes —
 * failures surface in the result (parseError, rejected candidates).
 */
export async function propose(input: ProposeInput, deps: ProposeDeps): Promise<ProposeResult> {
  const prompt = buildPrompt(input, deps.systemPromptTemplate);
  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;

  let text: string;
  try {
    text = await deps.callModel(prompt.system, prompt.user, {temperature});
  } catch (err) {
    return {candidates: [], proposalFingerprint: proposalFingerprintOf([]), repairRetried: false, parseError: `model call failed: ${err instanceof Error ? err.message : String(err)}`, rawPreview: ""};
  }

  let extracted = extractJsonArray(text);
  let repairRetried = false;
  if (!extracted.ok) {
    repairRetried = true;
    const repairUser = [
      "Your previous response was not valid JSON and could not be parsed.",
      "",
      "Parse error:",
      extracted.error ?? "(unknown)",
      "",
      "Your previous response was:",
      "```",
      text.slice(0, 20_000),
      "```",
      "",
      "Return ONLY the corrected JSON array of candidates — no prose, no fences needed.",
    ].join("\n");
    let repairText: string;
    try {
      repairText = await deps.callModel(prompt.system, repairUser, {temperature: 0});
    } catch (err) {
      return {candidates: [], proposalFingerprint: proposalFingerprintOf([]), repairRetried, parseError: `repair call failed: ${err instanceof Error ? err.message : String(err)}`, rawPreview: text.slice(0, RAW_PREVIEW_CHARS)};
    }
    extracted = extractJsonArray(repairText);
    if (!extracted.ok) {
      return {candidates: [], proposalFingerprint: proposalFingerprintOf([]), repairRetried, parseError: `unparseable after repair retry: ${extracted.error}`, rawPreview: repairText.slice(0, RAW_PREVIEW_CHARS)};
    }
  }

  const parsed = parseCandidates(extracted.value);
  if (!parsed.ok) {
    return {candidates: [], proposalFingerprint: proposalFingerprintOf([]), repairRetried, parseError: `malformed candidate structure: ${parsed.error}`, rawPreview: text.slice(0, RAW_PREVIEW_CHARS)};
  }

  const candidates: ProposedCandidate[] = parsed.candidates.map((c) => ({
    rationale: c.rationale,
    edits: c.edits,
    fingerprint: candidateFingerprint(c.edits),
    verdict: "accepted",
    reasons: [],
  }));

  // Structure caps (count of candidates, per-candidate caps).
  if (candidates.length < 1 || candidates.length > 3) {
    for (const c of candidates) {
      c.verdict = "rejected";
      c.reasons.push(`proposal contains ${candidates.length} candidates (1–3 required)`);
    }
  }
  const proposalFingerprint = proposalFingerprintOf(candidates);
  // Duplicate fingerprint vs ledger: the exact combined fingerprint was
  // already rejected once — reject the whole proposal as a duplicate.
  if (input.ledgerDigest.includes(proposalFingerprint)) {
    for (const c of candidates) {
      c.verdict = "rejected";
      c.reasons.push("duplicate of rejected proposal (combined fingerprint matches the ledger digest)");
    }
  }
  for (const c of candidates) {
    if (c.verdict === "rejected") continue;
    const reasons = validateCandidate(c.edits);
    if (reasons.length > 0) {
      c.verdict = "rejected";
      c.reasons = reasons;
    }
  }
  return {candidates, proposalFingerprint, repairRetried};
}
