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
 *              ≤48KB (the agents kind's caps.maxFileBytes).
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
 *   extensions extensions/<name>/... (Step 9a) — the ONLY code-bearing kind.
 *              TWO-LAYER ALLOWLIST (deliberate design):
 *                Layer 1 (here): a STATIC shape regex
 *                `^extensions/<name>/...` that only constrains the path shape
 *                (name charset), because the set of editable extension names
 *                is CONFIG-DRIVEN (loop/config.json code.allow) and the pure
 *                surface registry must stay config-free.
 *                Layer 2 (loop/lib/gates.ts extensionValidationReasons, wired
 *                into proposer.validateCandidate + apply re-validation via
 *                ValidationLimits.extensionEnv): the DYNAMIC check — the
 *                extension name must be in loadLoopConfig().code.allow, and
 *                the REAL extension dir must have a test file and a
 *                node_modules directory (resolvability proxy).
 *              STATIC EXCLUSIONS (hard-rejected here, independent of
 *              code.allow): extensions/<name>/package.json, bun.lock, and
 *              anything under node_modules/ — the loop NEVER edits dependency
 *              manifests and NEVER runs `bun install`: an extension whose
 *              imports do not resolve from its EXISTING node_modules is not
 *              editable (gate 1 rejects candidates on such extensions).
 *              extensions/harness-self-improvement/ (the loop's OWN extension)
 *              is likewise hard-rejected — the loop never edits itself
 *              (self-modification ban, same tier as the package.json
 *              exclusion, enforced regardless of code.allow).
 *              Snapshot policy: the extensions kind contributes NO files to
 *              the ambient sandbox snapshot (snapshot returns []) — sandbox
 *              probes stay minimal; only the touched candidate extension is
 *              staged into a probe sandbox, by the gate pipeline
 *              (gates.ts stageExtensionForSandbox). gitPath "extensions/" is
 *              still registered so apply's dirty-tree preflight, explicit
 *              pathspec git add, and revert fallback cover code applies.
 *   mcp        mcp.json (Step 9b) — the agent-dir MCP server config, ONE
 *              file at the agent-dir root (allowlist ^mcp\.json$, 256KB cap).
 *              Validated against the REAL pi 1.3.0 shape (verified in
 *              dist/core/mcp-servers.js validateMcpServerConfig +
 *              dist/extensions/mcp/config.js readConfigFile): top-level
 *              object with an `mcpServers` object; each entry keyed by a
 *              server name /^[A-Za-z0-9_-]+$/ and shaped as EITHER a stdio
 *              server ({command: string, args?: string[]}) OR a streamable
 *              HTTP server ({url: string}); unknown extra fields (exposure,
 *              oauth, type, enabled, timeout, env, cwd, description, …) are
 *              tolerated — this validator is a SHAPE gate, pi re-validates
 *              deeply at load. Deleting mcp.json is rejected outright (an
 *              empty mcpServers map is the legitimate way to disable all
 *              servers). mcp.json is a CODE-bearing kind: mcp-bearing
 *              candidates run the startup-probe gate (loop/lib/gates.ts
 *              runStartupProbe, BEFORE the suite probe — a broken config
 *              must never burn rollout spend) and select with code.minWin
 *              (selectionConfigForEdits). There is NO per-name allowlist:
 *              mcp is one file, editing it is enabled by the kind's
 *              existence (config code.allow does not apply).
 *              Snapshot policy: mcp.json IS part of the ambient sandbox
 *              snapshot (unlike extensions) — probes must run against the
 *              same MCP config the loop scores against. An ABSENT real
 *              mcp.json snapshots as an EMPTY list (the absence flag): the
 *              sandbox then has no mcp.json at all, exactly like the real
 *              dir — staging an empty file would be a parse error, so
 *              absence is expressed by contributing no file.
 *
 * File identity convention: every SurfaceFile.relPath is relative to the
 * AGENT DIR (POSIX separators), e.g. "AGENTS.md", "skills/x/SKILL.md",
 * "prompts/mode-ask.md", "agents/miner.md". That makes staging, validation
 * routing, and git pathspecs unambiguous; consumers that need the legacy
 * skills/-relative view strip the "skills/" prefix themselves.
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent} from "node:fs";
import {dirname, join} from "node:path";

export type SurfaceFile = {
  /** Path relative to the agent dir (POSIX separators). */
  relPath: string,
  content: string,
}

export type SurfaceKindName = "agents" | "skills" | "templates" | "subagents" | "extensions" | "mcp";

export type SurfaceCaps = {
  /** Maximum UTF-8 byte size of one file's content. */
  maxFileBytes: number,
}

export type SurfaceKind = {
  name: SurfaceKindName,
  /** Full-match allowlist over agent-dir-relative paths (case-sensitive). */
  allowlist: RegExp,
  caps: SurfaceCaps,
  /**
   * Kind-specific content validation for a proposed edit. `content === null`
   * means "delete the file"; kinds that must never be deleted (agents)
   * reject that here. Returns reject reasons; empty array = accept.
   */
  validate: (content: string | null, relPath: string) => string[],
  /** Snapshot the kind's real files under `absDir` (an agent dir). */
  snapshot: (absDir: string) => SurfaceFile[],
  /** Stage the kind's files into a sandbox dir (at their agent-dir-relative paths). */
  stage: (sandboxDir: string, files: SurfaceFile[]) => void,
  /** Explicit pathspec for `git add` / `git status` (relative to the agent dir). */
  gitPath: string,
  /** Directory under the agent dir this kind's files live in ("" = agent dir root). */
  applyDir: string,
}

export const SKILLS_MD_CAP_BYTES = 100 * 1024;
export const TEMPLATE_CAP_BYTES = 100 * 1024;
export const SUBAGENT_CAP_BYTES = 100 * 1024;
export const EXTENSION_CAP_BYTES = 100 * 1024;
export const MCP_CAP_BYTES = 256 * 1024;

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

/**
 * Extension file validation (Step 9a): STRUCTURAL checks only, kept minimal
 * by design — byte caps are enforced by the shared caps path in
 * proposer.validateCandidate, the dynamic code.allow + test-file +
 * node_modules checks live in gates.ts (they need config/FS access), and
 * code-level checks beyond that (syntax, secrets, imports) are deliberately
 * OUT OF SCOPE: gates 2–3 (tsc + bun test in the sandbox) are the code
 * quality gate. Rejected unconditionally, even under an allow-listed name:
 *   - package.json / bun.lock — dependency changes are out of scope; the loop
 *     never runs `bun install`.
 *   - anything under node_modules/ — vendored dependency code is never
 *     editable.
 *   - extensions/harness-self-improvement/ — the loop's own extension is not
 *     loop-editable (self-modification ban, independent of code.allow).
 * File deletion is allowed (a load-erroring extension is caught by gate 4).
 */
export function validateExtensionFile(content: string | null, relPath: string): string[] {
  if (relPath.startsWith("extensions/harness-self-improvement/")) {
    return [`extension edit rejected: ${relPath} — the loop's own extension is not loop-editable (self-modification ban, independent of code.allow)`];
  }
  const rest = relPath.replace(/^extensions\/[^/]+\//, "");
  if (rest === "package.json") {
    return [`extension edit rejected: ${relPath} — package.json is never editable (dependency changes are out of scope; the loop never runs bun install)`];
  }
  if (rest === "bun.lock") {
    return [`extension edit rejected: ${relPath} — bun.lock is never editable (dependency changes are out of scope; the loop never runs bun install)`];
  }
  if (rest === "node_modules" || rest.startsWith("node_modules/")) {
    return [`extension edit rejected: ${relPath} — node_modules is never editable (vendored dependency code)`];
  }
  return [];
}

/** pi's isStringRecord: a plain-object map whose every value is a string. */
function isStringRecord(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
}

/**
 * mcp.json validation (Step 9b): mirrors the REAL pi 1.3.0 mcp.json shape
 * (see the mcp kind header). Rejections:
 *   - deletion (null content) — mcp.json cannot be deleted; disable servers
 *     by writing an empty mcpServers map instead.
 *   - non-JSON / non-object top level / missing or non-object mcpServers.
 *   - server entries that are not objects, or whose name is not
 *     /^[A-Za-z0-9_-]+$/ (pi's SERVER_NAME rule — an invalid name would fail
 *     pi's own validation at startup-probe time anyway, but catching it here
 *     is free).
 *   - entries with neither a string `command` (stdio) nor a string `url`
 *     (streamable HTTP), a non-string `command`, or a non-string-array
 *     `args`.
 *   - a `url` entry whose url does not parse (URL.canParse) or whose protocol
 *     is not http/https, a stdio entry whose `env` (when present) is not a
 *     string record, or a url entry whose `headers` (when present) is not a
 *     string record — all three mirror pi 1.3.0 validateMcpServerConfig
 *     (dist/core/mcp-servers.js: `url must be an http or https URL`,
 *     `env must map names to strings`, `headers must map names to strings`).
 * Unknown extra fields are tolerated (pi ignores them too).
 */
export function validateMcpJson(content: string | null, _relPath: string): string[] {
  if (content === null) return ["mcp.json cannot be deleted — write an empty mcpServers map ({\"mcpServers\":{}}) to disable all servers instead"];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return [`mcp.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return ["mcp.json must be a JSON object"];
  const servers = (parsed as Record<string, unknown>)["mcpServers"];
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    return [`mcp.json: top-level "mcpServers" must be an object`];
  }
  const reasons: string[] = [];
  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
    const prefix = `mcp.json: server "${name}":`;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      reasons.push(`${prefix} invalid server name (pi requires letters, digits, "_" and "-")`);
      continue;
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      reasons.push(`${prefix} must be an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    const hasCommand = typeof e["command"] === "string";
    const hasUrl = typeof e["url"] === "string";
    if (!hasCommand && !hasUrl) {
      reasons.push(`${prefix} needs either "command" (stdio) or "url" (streamable HTTP)`);
    }
    if (e["command"] !== undefined && typeof e["command"] !== "string") {
      reasons.push(`${prefix} "command" must be a string`);
    }
    if (e["args"] !== undefined && !(Array.isArray(e["args"]) && e["args"].every((arg) => typeof arg === "string"))) {
      reasons.push(`${prefix} "args" must be an array of strings`);
    }
    if (hasUrl && (!URL.canParse(e["url"] as string) || !/^https?:$/.test(new URL(e["url"] as string).protocol))) {
      reasons.push(`${prefix} "url" must be an http or https URL`);
    }
    if (hasCommand && e["env"] !== undefined && !isStringRecord(e["env"])) {
      reasons.push(`${prefix} "env" must map names to strings`);
    }
    if (hasUrl && e["headers"] !== undefined && !isStringRecord(e["headers"])) {
      reasons.push(`${prefix} "headers" must map names to strings`);
    }
  }
  return reasons;
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
  {
    name: "extensions",
    // Layer 1 of the two-layer allowlist (see the header): path SHAPE only —
    // the editable-name set is enforced dynamically from config code.allow
    // in loop/lib/gates.ts (proposer + apply validation routing).
    allowlist: /^extensions\/[A-Za-z0-9][A-Za-z0-9_-]*\/.+$/,
    caps: {maxFileBytes: EXTENSION_CAP_BYTES},
    validate: validateExtensionFile,
    // Extensions are NOT part of the ambient sandbox (snapshot stays empty —
    // see the header). Candidate extension staging into probe sandboxes is
    // the gate pipeline's job (gates.ts stageExtensionForSandbox).
    snapshot: () => [],
    stage: stageFiles,
    gitPath: "extensions/",
    applyDir: "extensions",
  },
  {
    name: "mcp",
    allowlist: /^mcp\.json$/,
    caps: {maxFileBytes: MCP_CAP_BYTES},
    validate: validateMcpJson,
    // Absent real file → empty list (the absence flag — see the kind header):
    // the sandbox simply has no mcp.json, like the real dir.
    snapshot: (absDir) => {
      const path = join(absDir, "mcp.json");
      return existsSync(path) ? [{relPath: "mcp.json", content: readFileSync(path, "utf8")}] : [];
    },
    stage: stageFiles, // stages mcp.json only when the snapshot has one
    gitPath: "mcp.json",
    applyDir: "",
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
