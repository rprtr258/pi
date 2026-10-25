#!/usr/bin/env bun
/**
 * Sandbox staging for the harness self-improvement loop.
 *
 * Phase I probes run nested `pi` processes against a minimal copy of the real
 * ~/.pi/agent directory: settings (model capture), read-only auth.json and
 * models.json (without them every probe fails at provider auth), AGENTS.md and
 * skills/. Extensions, packages, sessions, plans, npm and everything else are
 * deliberately NOT staged — the sandbox must be minimal.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

export type SkillSnapshot = {
  /** Path relative to skills/, e.g. "coding-standards/SKILL.md". */
  relPath: string,
  content: string,
}

export type ComponentSnapshot = {
  agentsMd: string,
  skills: SkillSnapshot[],
}

export const realPiAgentDir = (): string => join(homedir(), ".pi", "agent");

function walkSkills(skillsDir: string, prefix: string, out: SkillSnapshot[]): void {
  // UTF-16 code-unit order (locale-independent), matching the fingerprint's
  // canonical skill ordering in loop/baseline.ts.
  for (const entry of readdirSync(skillsDir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    // Skip node_modules and dotfiles anywhere in the skills tree.
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(skillsDir, entry.name);
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walkSkills(full, rel, out);
    } else if (entry.isFile()) {
      out.push({relPath: rel, content: readFileSync(full, "utf8")});
    }
  }
}

/**
 * Snapshot the real agent components: AGENTS.md text and every skills/ file
 * (skipping node_modules and dotfiles). Throws if the real dir is broken —
 * snapshotting the host is a precondition of staging, not a probe outcome.
 */
export function snapshotReal(piAgentDir: string = realPiAgentDir()): ComponentSnapshot {
  const agentsMdPath = join(piAgentDir, "AGENTS.md");
  const agentsMd = existsSync(agentsMdPath) ? readFileSync(agentsMdPath, "utf8") : "";
  const skills: SkillSnapshot[] = [];
  const skillsDir = join(piAgentDir, "skills");
  if (existsSync(skillsDir)) walkSkills(skillsDir, "", skills);
  return {agentsMd, skills};
}

/**
 * Extract the model-capture keys from the real settings.json. The actual field
 * names on this install are `defaultModel` and `defaultProvider`; the provider
 * is required to disambiguate (the same model id exists under several
 * providers, one of which is a dead localhost gateway). Returns {} when
 * settings.json is missing or has no model field — callers then omit --model
 * and let pi use its default.
 */
export function captureModelSettings(piAgentDir: string = realPiAgentDir()): Record<string, string> {
  const settingsPath = join(piAgentDir, "settings.json");
  if (!existsSync(settingsPath)) return {};
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  if (settings && typeof settings === "object") {
    const model = (settings as Record<string, unknown>)["defaultModel"];
    if (typeof model === "string" && model !== "") out.defaultModel = model;
    const provider = (settings as Record<string, unknown>)["defaultProvider"];
    if (typeof provider === "string" && provider !== "") out.defaultProvider = provider;
  }
  return out;
}

/** `--model` value for a nested pi run, or undefined when nothing was captured. */
export function captureModelFlag(piAgentDir: string = realPiAgentDir()): string | undefined {
  const captured = captureModelSettings(piAgentDir);
  if (captured.defaultModel === undefined) return undefined;
  return captured.defaultProvider === undefined ? captured.defaultModel : `${captured.defaultProvider}/${captured.defaultModel}`;
}

export type BuildSandboxResult = {
  dir: string,
  /** Model-capture keys written into the sandbox settings.json (may be empty). */
  captured: Record<string, string>,
}

/**
 * Create a minimal sandbox at `dir` (recreated from scratch if it exists):
 * minimal settings.json with the captured model keys, READ-ONLY copies of
 * auth.json and models.json when present, AGENTS.md and the skill files.
 *
 * WARNING: this wipes `dir` first. Call it only with a directory this tool
 * created itself (e.g. a fresh mkdtemp path) — never with a caller-supplied
 * or externally staged path.
 */
export function buildSandbox(snapshot: ComponentSnapshot, dir: string, piAgentDir: string = realPiAgentDir()): BuildSandboxResult {
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const captured = captureModelSettings(piAgentDir);
  writeFileSync(join(dir, "settings.json"), `${JSON.stringify(captured, null, 2)}\n`);
  for (const name of ["auth.json", "models.json"]) {
    const src = join(piAgentDir, name);
    if (existsSync(src) && statSync(src).isFile()) {
      copyFileSync(src, join(dir, name));
      chmodSync(join(dir, name), 0o444);
    }
  }
  writeFileSync(join(dir, "AGENTS.md"), snapshot.agentsMd);
  for (const skill of snapshot.skills) {
    const target = join(dir, "skills", skill.relPath);
    mkdirSync(join(target, ".."), {recursive: true});
    writeFileSync(target, skill.content);
  }
  return {dir, captured};
}
