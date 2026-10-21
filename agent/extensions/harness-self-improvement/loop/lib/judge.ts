#!/usr/bin/env bun
/**
 * LLM judge for the harness self-improvement loop (Step 7, replay channel).
 *
 * judgeTrajectory scores one completed agent run (trajectory + final
 * workspace state) against the ORIGINAL user prompt on a 0–10 scale. The
 * rubric lives in loop/prompts/judge.md: goal achieved per original intent
 * (0–4) + tool-use efficiency (0–3) + no destructive actions (0–3).
 *
 * CORE IS PURE: `judgeTrajectory` takes a `callModel(system, user, opts)`
 * async function (the proposer.ts injectable-callModel pattern — unit tests
 * inject a fake; the /hloop-calibrate and /hloop-replay commands in index.ts
 * bind the same ctx.modelRegistry adapter the driver uses).
 *
 * PARSE + CLAMP CONTRACT:
 *   - Model output must contain a JSON object {"score": <num>, "rationale":
 *     "<str>"} — fenced ```json blocks are tried first, then the outermost
 *     bare {...} span.
 *   - A finite numeric score in [0, 10] is accepted as-is (the final score
 *     is always within 0–10; non-integer values keep their value, the
 *     binarization in replay.ts rounds at ≥ 7).
 *   - Non-numeric scores, numeric strings that do not parse, and
 *     out-of-range numbers → ABSTAIN (neutral score 5 + abstained: true).
 *   - rationale is truncated to RATIONALE_MAX_CHARS (200); a missing
 *     rationale becomes "".
 *   - A failed/thrown callModel is also an abstain (never throws for model
 *     outcomes — same never-throws contract as propose()).
 */
import {readFileSync} from "node:fs";
import type {CallModel} from "./proposer.ts";

// ---------------------------------------------------------------------------
// Types

export interface JudgeVerdict {
  /** 0–10; neutral 5 when abstained. */
  score: number;
  /** One sentence, ≤ 200 chars. */
  rationale: string;
  /** True when the model abstained or its output was unusable. */
  abstained: boolean;
  /** First RAW_PREVIEW_CHARS of the model output when parsing failed —
   *  debugging aid (absent on clean verdicts). */
  rawPreview?: string;
}

export interface JudgeTrajectoryInput {
  /** The ORIGINAL user prompt of the run (verbatim). */
  prompt: string;
  /** Assistant trajectory text (may be empty). */
  trajectory: string;
  /** Final workspace state: either captured files or a description. */
  workspaceState: string;
}

export interface JudgeDeps {
  callModel: CallModel;
  /** System-prompt template override (tests); default reads loop/prompts/judge.md. */
  systemPromptTemplate?: string;
}

// ---------------------------------------------------------------------------
// Caps

/** Original prompt cap in the judge prompt (chars). */
export const PROMPT_CAP_CHARS = 8_000;
/** Trajectory cap: last N chars (the END of a run matters most). */
export const TRAJECTORY_CAP_CHARS = 60_000;
/** Workspace-state cap: last N chars. */
export const WORKSPACE_CAP_CHARS = 60_000;
/** rationale max length. */
export const RATIONALE_MAX_CHARS = 200;
/** Neutral score used for every abstain. */
export const ABSTAIN_SCORE = 5;
/** Head of the raw model output retained on parse failure (debugging). */
export const RAW_PREVIEW_CHARS = 800;

// ---------------------------------------------------------------------------
// Prompt template

const PROMPTS_DIR = new URL("../prompts/", import.meta.url);

// ---------------------------------------------------------------------------
// Prompt build

export interface BuiltJudgePrompt {
  system: string;
  user: string;
}

/** Take the LAST `cap` chars, with a truncation marker when cut. */
function tailCap(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `[…truncated, showing last ${cap} characters…]\n${text.slice(-cap)}`;
}

/**
 * Build the judge system + user prompt. The system template
 * (loop/prompts/judge.md) is used verbatim (no placeholders); the ORIGINAL
 * PROMPT / TRAJECTORY / WORKSPACE STATE sections go in the user message.
 */
export function buildJudgePrompt(input: JudgeTrajectoryInput, template: string): BuiltJudgePrompt {
  const user = [
    "## ORIGINAL PROMPT",
    "```",
    tailCap(input.prompt, PROMPT_CAP_CHARS),
    "```",
    "",
    "## TRAJECTORY",
    input.trajectory.trim() === "" ? "(empty — consider abstaining per the rubric)" : tailCap(input.trajectory, TRAJECTORY_CAP_CHARS),
    "",
    "## WORKSPACE STATE",
    input.workspaceState.trim() === "" ? "(no workspace state available)" : tailCap(input.workspaceState, WORKSPACE_CAP_CHARS),
    "",
    "Respond with ONLY the JSON object now.",
  ].join("\n");
  return {system: template, user};
}

// ---------------------------------------------------------------------------
// Response parsing

/**
 * Parse a judge output into a verdict. Never throws. See the file-header
 * PARSE + CLAMP CONTRACT for the exact rules.
 */
function abstain(rationale: string, raw?: string): JudgeVerdict {
  const verdict: JudgeVerdict = {score: ABSTAIN_SCORE, rationale: rationale.slice(0, RATIONALE_MAX_CHARS), abstained: true};
  if (raw !== undefined) verdict.rawPreview = raw.slice(0, RAW_PREVIEW_CHARS);
  return verdict;
}

export function parseJudgeVerdict(text: string): JudgeVerdict {
  if (text === null || typeof text !== "string") return abstain("(judge output missing)");

  // Fenced ```json blocks first, then the outermost bare {...} span.
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)) candidates.push(match[1]!.trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const verdict = verdictFromObject(parsed, text);
    if (verdict !== null) return verdict;
  }
  // Lenient fallback: models sometimes emit near-JSON (unescaped newlines in
  // the rationale, trailing commas, prose around the object). Recover the two
  // fields by regex before giving up and abstaining.
  const scoreMatch = /"score"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/.exec(text);
  if (scoreMatch !== null) {
    const value = Number(scoreMatch[1]);
    const rationaleMatch = /"rationale"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
    let rationale = "(lenient parse)";
    if (rationaleMatch !== null) {
      // Raw newlines are illegal inside a JSON string — flatten them, then
      // best-effort unescape the remaining standard escapes.
      const raw = rationaleMatch[1]!.replace(/\r?\n/g, " ");
      try {
        rationale = JSON.parse(`"${raw}"`) as string;
      } catch {
        rationale = raw.replace(/\\(.)/g, "$1");
      }
    }
    if (value >= 0 && value <= 10) return {score: value, rationale: rationale.slice(0, RATIONALE_MAX_CHARS), abstained: false};
    return abstain(`judge score out of range: ${value}`, text);
  }
  if (/"score"\s*:\s*null/.test(text)) return abstain("abstain: model returned null score", text);
  return abstain("no parseable JSON verdict in judge output", text);
}

/** Extract a verdict from a parsed JSON value; null when the shape is unusable. */
function verdictFromObject(parsed: unknown, rawText?: string): JudgeVerdict | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj["score"] === null || obj["score"] === undefined) {
    // Explicit null score = an abstain verdict per the prompt; use its rationale.
    const reason = typeof obj["rationale"] === "string" ? obj["rationale"] : "abstain: null score";
    return abstain(reason, rawText);
  }
  const raw = obj["score"];
  let value: number | null = null;
  if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
  else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw.trim())) value = Number(raw);
  if (value === null) return abstain("judge score is not numeric", rawText);
  if (value < 0 || value > 10) return abstain(`judge score out of range: ${value}`, rawText);
  const rationale = typeof obj["rationale"] === "string" ? obj["rationale"] : "";
  return {score: value, rationale: rationale.slice(0, RATIONALE_MAX_CHARS), abstained: false};
}

// ---------------------------------------------------------------------------
// Core

/** System prompt for a fresh judge call (reads the template from disk). */
export function judgeSystemPrompt(): string {
  return readFileSync(new URL("judge.md", PROMPTS_DIR), "utf8");
}

const JUDGE_TEMPERATURE = 0;
/**
 * Verdict JSON is tiny, but models often preface it with (long) analysis;
 * a tight cap truncates the output BEFORE the JSON and makes every such call
 * an abstain — keep generous headroom (observed on real replay judges).
 */
const JUDGE_MAX_TOKENS = 4096;

/**
 * Judge one run. Never throws for model outcomes: a failed model call is an
 * abstain verdict (score 5, abstained: true) with the error in the rationale.
 */
export async function judgeTrajectory(input: JudgeTrajectoryInput, deps: JudgeDeps): Promise<JudgeVerdict> {
  const template = deps.systemPromptTemplate ?? judgeSystemPrompt();
  const prompt = buildJudgePrompt(input, template);
  let text: string;
  try {
    text = await deps.callModel(prompt.system, prompt.user, {temperature: JUDGE_TEMPERATURE, maxTokens: JUDGE_MAX_TOKENS});
  } catch (err) {
    return {score: ABSTAIN_SCORE, rationale: `judge call failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, RATIONALE_MAX_CHARS), abstained: true};
  }
  return parseJudgeVerdict(text);
}
