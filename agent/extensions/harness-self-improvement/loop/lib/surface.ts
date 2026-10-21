#!/usr/bin/env bun
/**
 * Surface registry for the harness self-improvement loop (Step 8).
 *
 * Every markdown component kind the loop may propose edits to is described
 * here, in ONE place: its path allowlist, size caps, content validator,
 * snapshot walker, sandbox stager, and git path. Consumers (stage.ts
 * snapshot/staging, proposer.ts validation + prompt components, apply.ts git
 * paths) iterate SURFACE_KINDS instead of hardcoding AGENTS.md/skills.
 *
 * KINDS:
 *   agents     AGENTS.md — existing semantics: non-deletable, non-empty,
 *              ≤48KB (AGENTS_MD_CAP_BYTES in proposer.ts).
 *   skills     skills/<dir>/SKILL.md and skills/<dir>/scripts/<file> —
 *              lowercase skill dirs, ≤100KB/file (Phase I allowlist, unchanged).
 *   templates  prompts/<name>.md — pi prompt templates. NO YAML frontmatter is
 *              required (pi falls back to the first line as the description);
 *              {{PLACEHOLDER}} tokens are only checked for BALANCE (an
 *              unbalanced {{ without }} is rejected). ≤100KB/file.
 *   subagents  agents/<name>.md (flat files; *.chain.md excluded by the
 *              allowlist — chain files do not define agents). Frontmatter with
 *              BOTH name and description is REQUIRED (the description is what
 *              drives model delegation). ≤100KB/file.
 *
 * File identity convention: every SurfaceFile.relPath is relative to the
 * AGENT DIR (POSIX separators), e.g. "AGENTS.md", "skills/x/SKILL.md",
 * "prompts/mode-ask.md", "agents/miner.md". That makes staging, validation
 * routing, and git pathspecs unambiguous; consumers that need the legacy
 * skills/-relative view strip the "skills/" prefix themselves.
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent} from "node:fs";
import {dirname, join} from "node:path";

export interface SurfaceFile {
  /** Path relative to the agent dir (POSIX separators). */
  relPath: string;
  content: string;
}

export type SurfaceKindName = "agents" | "skills" | "templates" | "subagents";

export interface SurfaceCaps {
  /** Maximum UTF-8 byte size of one file's content. */
  maxFileBytes: number;
}

export interface SurfaceKind {
  name: SurfaceKindName;
  /** Full-match allowlist over agent-dir-relative paths (case-sensitive). */
  allowlist: RegExp;
  caps: SurfaceCaps;
  /**
   * Kind-specific content validation for a proposed edit. `content === null`
   * means "delete the file"; kinds that must never be deleted (agents)
   * reject that here. Returns reject reasons; empty array = accept.
   */
  validate: (content: string | null, relPath: string) => string[];
  /** Snapshot the kind's real files under `absDir` (an agent dir). */
  snapshot: (absDir: string) => SurfaceFile[];
  /** Stage the kind's files into a sandbox dir (at their agent-dir-relative paths). */
  stage: (sandboxDir: string, files: SurfaceFile[]) => void;
  /** Explicit pathspec for `git add` / `git status` (relative to the agent dir). */
  gitPath: string;
  /** Directory under the agent dir this kind's files live in ("" = agent dir root). */
  applyDir: string;
}

export const SKILLS_MD_CAP_BYTES = 100 * 1024;
export const TEMPLATE_CAP_BYTES = 100 * 1024;
export const SUBAGENT_CAP_BYTES = 100 * 1024;

/**
 * Recursively walk `dir`, collecting files as SurfaceFiles with `relBase`-prefixed
 * relPaths. Skips node_modules and dotfiles anywhere in the tree (Phase I
 * snapshot rule). Entries are visited in UTF-16 code-unit name order.
 */
function walkFiles(dir: string, relBase: string, out: SurfaceFile[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return; // missing/unreadable dir — the kind contributes no files
  }
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of sorted) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = relBase === "" ? entry.name : `${relBase}/${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, rel, out);
    else if (entry.isFile()) out.push({relPath: rel, content: readFileSync(full, "utf8")});
  }
}

/** List one flat directory's regular files as SurfaceFiles (no recursion). */
function flatFiles(absDir: string, relBase: string): SurfaceFile[] {
  const out: SurfaceFile[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, {withFileTypes: true});
  } catch {
    return out;
  }
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (!entry.isFile()) continue;
    const rel = `${relBase}/${entry.name}`;
    if (existsSync(join(absDir, entry.name))) out.push({relPath: rel, content: readFileSync(join(absDir, entry.name), "utf8")});
  }
  return out;
}

/** Write files at their agent-dir-relative paths under `sandboxDir` (mkdir -p). */
function stageFiles(sandboxDir: string, files: SurfaceFile[]): void {
  for (const file of files) {
    const target = join(sandboxDir, file.relPath);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, file.content);
  }
}

// ---------------------------------------------------------------------------
// Validators

/**
 * Template content validation: frontmatter-less files are VALID (pi falls
 * back to the first line as the description); only {{placeholder}} balance is
 * enforced — an opener {{ with no closer }} after it breaks pi's token syntax.
 */
export function validateTemplate(content: string | null, relPath: string): string[] {
  if (content === null) return []; // deletion is allowed
  let idx = 0;
  for (;;) {
    const open = content.indexOf("{{", idx);
    if (open === -1) return [];
    const close = content.indexOf("}}", open + 2);
    if (close === -1) return [`template ${relPath}: unbalanced {{ without }} (placeholder opener has no closer)`];
    idx = close + 2;
  }
}

/** Extract a scalar `field:` value from YAML frontmatter text; null when absent/empty. */
export function parseFrontmatterField(frontmatter: string, field: string): string | null {
  const line = new RegExp(`^${field}:\\s*(.*)$`, "m").exec(frontmatter);
  if (!line) return null;
  const value = line[1]!.trim().replace(/^["']|["']$/g, "");
  return value === "" ? null : value;
}

/**
 * Subagent content validation: frontmatter with BOTH name and description is
 * REQUIRED (pi-subagents refuses undeclared agents and delegates by
 * description). Chain files never reach this — the allowlist excludes them.
 */
export function validateSubagent(content: string | null, relPath: string): string[] {
  if (content === null) return []; // deletion is allowed
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return [`subagent ${relPath}: YAML frontmatter with name and description is required`];
  const reasons: string[] = [];
  if (parseFrontmatterField(match[1]!, "name") === null) reasons.push(`subagent ${relPath}: frontmatter field "name" is required`);
  if (parseFrontmatterField(match[1]!, "description") === null) reasons.push(`subagent ${relPath}: frontmatter field "description" is required`);
  return reasons;
}

/** AGENTS.md semantics (unchanged from Phase I): never deletable, never empty. */
export function validateAgentsMd(content: string | null, _relPath: string): string[] {
  if (content === null || content.trim() === "") return ["AGENTS.md cannot be deleted or emptied"];
  return [];
}

/** Skills files have no kind-specific content rules (Phase I behavior). */
export function validateSkillsFile(content: string | null, _relPath: string): string[] {
  return [];
}

// ---------------------------------------------------------------------------
// Registry

/** The surface registry — the single source of truth for editable component kinds. */
export const SURFACE_KINDS: readonly SurfaceKind[] = [
  {
    name: "agents",
    allowlist: /^AGENTS\.md$/,
    caps: {maxFileBytes: 48 * 1024},
    validate: validateAgentsMd,
    snapshot: (absDir) => {
      const path = join(absDir, "AGENTS.md");
      return existsSync(path) ? [{relPath: "AGENTS.md", content: readFileSync(path, "utf8")}] : [];
    },
    stage: (sandboxDir, files) => {
      // AGENTS.md is always written, even when the snapshot has none (empty
      // file) — Phase I buildSandbox behavior, preserved.
      writeFileSync(join(sandboxDir, "AGENTS.md"), files[0]?.content ?? "");
    },
    gitPath: "AGENTS.md",
    applyDir: "",
  },
  {
    name: "skills",
    allowlist: /^skills\/[a-z0-9][a-z0-9_-]*\/(SKILL\.md|scripts\/[A-Za-z0-9_.-]+)$/,
    caps: {maxFileBytes: SKILLS_MD_CAP_BYTES},
    validate: validateSkillsFile,
    snapshot: (absDir) => {
      const out: SurfaceFile[] = [];
      walkFiles(join(absDir, "skills"), "skills", out);
      return out;
    },
    stage: stageFiles,
    gitPath: "skills/",
    applyDir: "skills",
  },
  {
    name: "templates",
    allowlist: /^prompts\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/,
    caps: {maxFileBytes: TEMPLATE_CAP_BYTES},
    validate: validateTemplate,
    snapshot: (absDir) => flatFiles(join(absDir, "prompts"), "prompts").filter((f) => /^prompts\/[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/.test(f.relPath)),
    stage: stageFiles,
    gitPath: "prompts/",
    applyDir: "prompts",
  },
  {
    name: "subagents",
    allowlist: /^agents\/[A-Za-z0-9][A-Za-z0-9_-]*\.md$/,
    caps: {maxFileBytes: SUBAGENT_CAP_BYTES},
    validate: validateSubagent,
    snapshot: (absDir) => flatFiles(join(absDir, "agents"), "agents").filter((f) => /^agents\/[A-Za-z0-9][A-Za-z0-9_-]*\.md$/.test(f.relPath)),
    stage: stageFiles,
    gitPath: "agents/",
    applyDir: "agents",
  },
];

/** Registry lookup by kind name. */
export function surfaceKind(name: SurfaceKindName): SurfaceKind {
  const kind = SURFACE_KINDS.find((k) => k.name === name);
  if (kind === undefined) throw new Error(`unknown surface kind: ${name}`);
  return kind;
}

/**
 * Route an agent-dir-relative path to its owning kind (full-match allowlist),
 * or null when the path belongs to no kind (→ "outside the allowlist").
 */
export function kindForPath(relPath: string): SurfaceKind | null {
  return SURFACE_KINDS.find((k) => k.allowlist.test(relPath)) ?? null;
}
