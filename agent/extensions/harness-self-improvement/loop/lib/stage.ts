#!/usr/bin/env bun
/**
 * Sandbox staging for the harness self-improvement loop.
 *
 * Phase I probes run nested `pi` processes against a minimal copy of the real
 * ~/.pi/agent directory: settings (model capture), read-only auth.json and
 * models.json (without them every probe fails at provider auth), and every
 * registered surface kind from loop/lib/surface.ts (AGENTS.md, skills/,
 * prompts/, agents/). Extensions, sessions, plans and everything else are
 * deliberately NOT staged — the sandbox must be minimal.
 *
 * S8 PACKAGES REPLICATION (supervisor-approved deviation from the S8 plan):
 *   pi's PackageManager resolves `npm:` packages at <agentDir>/npm/node_modules
 *   (verified in pi 1.3.0 dist/core/package-manager.js), where agentDir comes
 *   from PI_CODING_AGENT_DIR. PI_PACKAGE_DIR is a DIFFERENT setting — it
 *   overrides pi's own binary package dir (themes/assets, dist/config.js
 *   getPackageDir) and was verified INEFFECTIVE for package resolution: a
 *   sandbox with packages in settings.json + PI_PACKAGE_DIR=<real npm> never
 *   loaded pi-subagents. The working replication is therefore:
 *     1. the real settings.json `packages` array is copied into the sandbox
 *        settings.json (so pi knows which packages to load),
 *     2. the real PACKAGE STORES are SYMLINKED into the sandbox READ-ONLY:
 *        <sandbox>/npm/node_modules → real ~/.pi/agent/npm/node_modules and
 *        <sandbox>/git → real ~/.pi/agent/git (the git-sourced package store,
 *        replicated alongside npm because settings.json entries may be
 *        `git:`-sourced too). Each store is symlinked only WHEN PRESENT —
 *        not every install has one — but when the real store exists and is
 *        broken (a dangling symlink), staging FAILS LOUDLY instead of
 *        silently degrading the probe. pi reads package code through the
 *        links and never writes there.
 *     3. probe.ts sets PI_OFFLINE=1 in the nested pi env — WITHOUT it, pi
 *        network-installs packages missing from the sandbox stores (verified)
 *        and update-checks the symlinked ones. PI_OFFLINE=1 is the
 *        write-protection mechanism for BOTH shared real stores (npm and
 *        git); it only disables background network activity
 *        (installs/update checks), NOT model calls, so probes still run
 *        their normal model traffic.
 *   Empirically verified (real nested pi run): with this replication a staged
 *   <sandbox>/agents/<name>.md test subagent is discovered by the subagent
 *   tool's `list` action.
 *
 * STEP 9a (extensions kind): extensions are NOT part of the ambient sandbox
 * (the extensions kind's snapshot contributes no files — see surface.ts);
 * only the touched candidate extension is staged into a candidate's probe
 * sandbox, by the gate pipeline (loop/lib/gates.ts
 * stageExtensionForSandbox, called from loop/driver.ts before the suite
 * probe). Probes run with HARNESS_LOOP_SAMPLE=1 in nestedPiEnv (probe.ts) so
 * env-gated sample extensions are exercisable in sandboxes while staying
 * inert in every normal session.
 *
 * STEP 9b (mcp kind): the real mcp.json IS part of the ambient sandbox (the
 * mcp kind's snapshot returns it when present — an absent file snapshots as
 * an empty list, so the sandbox then has none, exactly like the real dir).
 * No buildSandbox change was needed: staging goes through the registry's
 * per-kind stage, like every other kind. Candidate mcp.json edits are
 * overlaid on top by gates.ts stageMcpForSandbox before the startup probe
 * and the suite probe.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {dirname, join} from "node:path";
import {SURFACE_KINDS, type SurfaceFile, type SurfaceKindName} from "./surface.ts";

export interface ComponentSnapshot {
  /**
   * Kinds-generic snapshot (S8): one SurfaceFile list per registered kind,
   * relPaths relative to the agent dir. Legacy callers: use agentsMdOf() for
   * the AGENTS.md text.
   */
  kinds: Record<SurfaceKindName, SurfaceFile[]>;
}

export const realPiAgentDir = (): string => join(homedir(), ".pi", "agent");

/** The AGENTS.md text of a snapshot ("" when absent) — legacy Phase I view. */
export function agentsMdOf(snapshot: ComponentSnapshot): string {
  return snapshot.kinds.agents[0]?.content ?? "";
}

/**
 * Snapshot the real agent components for every registered surface kind
 * (skipping node_modules and dotfiles; see surface.ts per-kind rules).
 * Throws if the real dir is broken — snapshotting the host is a precondition
 * of staging, not a probe outcome.
 */
export function snapshotReal(piAgentDir: string = realPiAgentDir()): ComponentSnapshot {
  const kinds = {} as Record<SurfaceKindName, SurfaceFile[]>;
  for (const kind of SURFACE_KINDS) kinds[kind.name] = kind.snapshot(piAgentDir);
  return {kinds};
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

/**
 * Extract the real settings.json `packages` array (string entries only) for
 * replication into the sandbox settings.json (see the S8 header note).
 * Tolerant: missing/invalid settings or a non-array packages field → [].
 */
export function capturePackages(piAgentDir: string = realPiAgentDir()): string[] {
  const settingsPath = join(piAgentDir, "settings.json");
  if (!existsSync(settingsPath)) return [];
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return [];
  }
  const packages = (settings as Record<string, unknown> | null)?.["packages"];
  return Array.isArray(packages) ? packages.filter((p): p is string => typeof p === "string" && p !== "") : [];
}

/** `--model` value for a nested pi run, or undefined when nothing was captured. */
export function captureModelFlag(piAgentDir: string = realPiAgentDir()): string | undefined {
  const captured = captureModelSettings(piAgentDir);
  if (captured.defaultModel === undefined) return undefined;
  return captured.defaultProvider === undefined ? captured.defaultModel : `${captured.defaultProvider}/${captured.defaultModel}`;
}

export interface BuildSandboxResult {
  dir: string;
  /** Model-capture keys written into the sandbox settings.json (may be empty). */
  captured: Record<string, string>;
  /** `packages` entries replicated from the real settings.json (may be empty). */
  packages: string[];
}

/**
 * Symlink a real package store into the sandbox for read-by-convention use —
 * pi reads through the link and PI_OFFLINE=1 in the probe env prevents
 * writes, but this is NOT a security sandbox: gates are quality gates, not a
 * security boundary, and allowlisted extensions execute with the loop's
 * privileges. A dangling real store fails staging loudly; no real store at
 * all skips replication (nothing to replicate).
 */
function replicateStore(real: string, link: string, label: string): void {
  let realStat: ReturnType<typeof lstatSync>;
  try {
    realStat = lstatSync(real);
  } catch {
    return; // no real store — nothing to replicate
  }
  if (realStat.isSymbolicLink() && !existsSync(real)) {
    throw new Error(`sandbox staging failed: real ${label} ${real} is a dangling symlink`);
  }
  if (!existsSync(real)) return;
  mkdirSync(dirname(link), {recursive: true});
  symlinkSync(real, link);
  // Verify the link resolves: a broken replication must fail staging with a
  // clear error, never degrade the probe silently.
  let resolved: string;
  try {
    resolved = realpathSync(link);
  } catch (err) {
    throw new Error(`sandbox staging failed: ${label} symlink does not resolve (${err instanceof Error ? err.message : String(err)})`);
  }
  if (resolved !== realpathSync(real)) {
    throw new Error(`sandbox staging failed: ${label} symlink resolves to ${resolved}, expected ${realpathSync(real)}`);
  }
}

/** npm store: <sandbox>/npm/node_modules → the real node_modules (see header). */
function replicateNpmStore(piAgentDir: string, sandboxDir: string): void {
  replicateStore(join(piAgentDir, "npm", "node_modules"), join(sandboxDir, "npm", "node_modules"), "npm node_modules");
}

/** git store: <sandbox>/git → the real ~/.pi/agent/git (see header). */
function replicateGitStore(piAgentDir: string, sandboxDir: string): void {
  replicateStore(join(piAgentDir, "git"), join(sandboxDir, "git"), "git store");
}

/**
 * Create a minimal sandbox at `dir` (recreated from scratch if it exists):
 * minimal settings.json with the captured model keys and the replicated
 * `packages` array, READ-ONLY copies of auth.json and models.json when
 * present, every registered surface kind's files, and the package-store
 * symlinks (npm node_modules + git, each when present — see the header).
 *
 * WARNING: this wipes `dir` first. Call it only with a directory this tool
 * created itself (e.g. a fresh mkdtemp path) — never with a caller-supplied
 * or externally staged path.
 */
export function buildSandbox(snapshot: ComponentSnapshot, dir: string, piAgentDir: string = realPiAgentDir()): BuildSandboxResult {
  rmSync(dir, {recursive: true, force: true});
  mkdirSync(dir, {recursive: true});
  const captured = captureModelSettings(piAgentDir);
  const packages = capturePackages(piAgentDir);
  const settings = packages.length > 0 ? {...captured, packages} : captured;
  writeFileSync(join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  for (const name of ["auth.json", "models.json"]) {
    const src = join(piAgentDir, name);
    if (existsSync(src) && statSync(src).isFile()) {
      copyFileSync(src, join(dir, name));
      chmodSync(join(dir, name), 0o444);
    }
  }
  for (const kind of SURFACE_KINDS) kind.stage(dir, snapshot.kinds[kind.name]);
  replicateNpmStore(piAgentDir, dir);
  replicateGitStore(piAgentDir, dir);
  return {dir, captured, packages};
}
