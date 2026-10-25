#!/usr/bin/env bun
/**
 * Code gate pipeline for the `extensions` surface kind (Step 9a).
 *
 * This module is the safety boundary that makes CODE editable by the loop.
 * A candidate that touches extensions/<name>/ must pass ALL gates, in this
 * exact order, before its full-suite probe runs (driver.ts enforces the
 * order; the first failure rejects the candidate with the captured output):
 *
 *   Gate 1 (validation time — proposer.validateCandidate AND apply
 *   re-validation, via ValidationLimits.extensionEnv):
 *     extensionValidationReasons —
 *       a. DYNAMIC allowlist: the extension name must be in
 *          loadLoopConfig().code.allow (config-driven; the surface registry's
 *          regex only constrains the path SHAPE — see surface.ts's two-layer
 *          design note).
 *       b. STATIC exclusions, re-checked here as defense in depth (also hard
 *          rejects in surface.validateExtensionFile): package.json, bun.lock,
 *          anything under node_modules/. The loop NEVER runs `bun install`:
 *          an extension whose imports do not resolve from its EXISTING
 *          node_modules is NOT editable.
 *       c. Test-file presence in the REAL extension dir:
 *          extensions/<name>/*.test.ts or extensions/<name>/test/** — an
 *          untested extension is not editable (gate 3 would have nothing to
 *          run).
 *       d. node_modules presence in the REAL extension dir (best-effort
 *          resolvability proxy; absence → candidate rejected with reason).
 *
 *   Gate 2: `bunx tsc --noEmit` on the SANDBOX copy, cwd = the staged
 *     extension dir. TSCONFIG CHOICE: the extension's own tsconfig.json when
 *     it has one (it is staged with the extension's files); otherwise a
 *     minimal strict one is SYNTHESIZED INTO THE SANDBOX COPY ONLY (never the
 *     real extension dir). Type resolution works because
 *     stageExtensionForSandbox symlinks the extension's REAL node_modules
 *     (realpath-resolved, read-only use) into the sandbox copy. Timeout
 *     TSC_GATE_TIMEOUT_S; the process group is killed on hang.
 *
 *   Gate 3: `bun test` scoped to the touched extension, cwd = the sandbox
 *     extension dir (bun discovers only that dir's *.test.ts files and
 *     excludes node_modules). Timeout BUN_TEST_GATE_TIMEOUT_S; process group
 *     killed on hang. Cannot run for an untested extension — gate 1c already
 *     rejected it. VACUOUS-RUN SEMANTICS (empirical, bun 1.4.2): `bun test`
 *     in a directory with ZERO test files prints "No tests found!" and exits
 *     NON-ZERO, so the status !== 0 check below already fails a vacuous run —
 *     the gate can never pass with 0 tests collected (regression-tested in
 *     gates.test.ts).
 *
 *   Gate 4: the full suite probe (existing driver flow) with the candidate
 *     extension staged into the sandbox extensions/ (probes run nested pi
 *     with HARNESS_LOOP_SAMPLE=1 — see probe.ts nestedPiEnv). After the suite,
 *     scanProbeLoadErrors inspects every task's raw JSONL + stderr excerpt for
 *     extension LOAD ERRORS mentioning the staged extension — any hit fails
 *     the candidate. Empirical error shape (pi 1.3.0, verified by staging a
 *     deliberately-broken extension in a test sandbox):
 *       Error: Failed to load extension "<sandbox>/extensions/<name>/index.ts": ...
 *       Hint: Start without extensions using "pi -ne".
 *     (stderr only; stdout/JSONL stays empty — pi exits before any model call.)
 *
 *   Selection: code-bearing candidates (any edit routed to the extensions
 *     kind) use config code.minWin (default 2) instead of minWin — see
 *     selectionConfigForEdits.
 */
import {spawn} from "node:child_process";
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, type Dirent} from "node:fs";
import {dirname, join} from "node:path";
import {kindForPath, surfaceKind, type SurfaceFile} from "./surface.ts";
import {killProcessGroup} from "./probe.ts";
import type {SelectionConfig} from "./score.ts";
import type {ProposedEdit} from "./proposer.ts";

/** Gate 2 budget: tsc on one extension. */
export const TSC_GATE_TIMEOUT_S = 120;
/** Gate 3 budget: bun test on one extension. */
export const BUN_TEST_GATE_TIMEOUT_S = 120;

/** True when the edit path belongs to the extensions surface kind. */
export function isExtensionPath(path: string): boolean {
  return kindForPath(path)?.name === "extensions";
}

/** The extension name of an extensions-kind path ("extensions/<name>/..."). */
export function extensionNameOf(path: string): string {
  return path.split("/")[1] ?? "";
}

/** Distinct extension names touched by an edit set (extensions-kind paths only). */
export function touchedExtensionNames(edits: Array<{path: string}>): string[] {
  const names: string[] = [];
  for (const edit of edits) {
    if (!isExtensionPath(edit.path)) continue;
    const name = extensionNameOf(edit.path);
    if (name !== "" && !names.includes(name)) names.push(name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Gate 1: validation-time checks (config + real-FS dependent)

export type ExtensionEnvChecks = {
  /**
   * The REAL agent dir the extension is read from (apply re-validation passes
   * the same dir apply writes into; proposer-time validation passes the real
   * ~/.pi/agent or the test's temp agent dir).
   */
  agentDir: string,
  /** The config code.allow list (editable extension names). */
  codeAllow: string[],
}

/**
 * Recursively check that `dir` contains at least one regular file (skipping
 * node_modules and dotfiles, mirroring the snapshot walk rules).
 */
function dirHasFiles(dir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, {withFileTypes: true});
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isFile()) return true;
    if (entry.isDirectory() && dirHasFiles(join(dir, entry.name))) return true;
  }
  return false;
}

/**
 * Test-file presence (gate 1c): `*.test.ts` directly in the extension dir, or
 * any file under its `test/` directory.
 */
export function extensionHasTestFile(extDir: string): boolean {
  let entries: Dirent[];
  try {
    entries = readdirSync(extDir, {withFileTypes: true});
  } catch {
    return false;
  }
  if (entries.some((e) => e.isFile() && /\.test\.ts$/.test(e.name))) return true;
  return entries.some((e) => e.isDirectory() && e.name === "test") && dirHasFiles(join(extDir, "test"));
}

/**
 * Gate 1 (see the module header): per-extension dynamic allowlist + test-file
 * + node_modules presence, plus the static exclusions re-checked per edit as
 * defense in depth. Pure w.r.t. the registry — everything config/FS-dependent
 * comes in through `opts`.
 */
export function extensionValidationReasons(edits: ProposedEdit[], opts: ExtensionEnvChecks): string[] {
  const reasons: string[] = [];
  const extNames = new Set<string>();
  for (const edit of edits) {
    if (!isExtensionPath(edit.path)) continue;
    extNames.add(extensionNameOf(edit.path));
    reasons.push(...surfaceKind("extensions").validate(edit.content, edit.path));
  }
  for (const name of [...extNames].sort()) {
    if (!opts.codeAllow.includes(name)) {
      reasons.push(`extension "${name}" is not editable: not in config code.allow (allowed: ${opts.codeAllow.length === 0 ? "(none)" : opts.codeAllow.join(", ")})`);
      continue;
    }
    const realExtDir = join(opts.agentDir, "extensions", name);
    if (!extensionHasTestFile(realExtDir)) {
      reasons.push(`extension "${name}" is not editable: no test file (extensions/${name}/*.test.ts or extensions/${name}/test/**) — code candidates must be unit-testable`);
    }
    if (!existsSync(join(realExtDir, "node_modules"))) {
      reasons.push(`extension "${name}" is not editable: no node_modules directory — its imports may not resolve and the loop never runs bun install; fix the extension's dependencies manually first`);
      continue;
    }
    // Deleting the LAST remaining test file must be rejected at gate 1: gate 3
    // would otherwise run vacuously on the sandbox copy (0 tests collected).
    // Count the REAL test files vs the test files this candidate deletes.
    const realTestFiles = extensionTestFilePaths(realExtDir);
    const deletedTestFiles = new Set(
      edits.filter((e) => e.content === null && isExtensionTestFilePath(name, e.path)).map((e) => e.path),
    ).size;
    if (realTestFiles.length > 0 && deletedTestFiles >= realTestFiles.length) {
      reasons.push(`extension "${name}" is not editable: candidate deletes the last remaining test file (${realTestFiles.length} test file(s) on disk, ${deletedTestFiles} deleted by this candidate)`);
    }
  }
  return reasons;
}

/**
 * Test files of one real extension dir (gate 1): `*.test.ts` directly in the
 * dir, or any file under its `test/` directory — same discovery as
 * extensionHasTestFile, but enumerated so candidate deletions can be counted
 * against the real set.
 */
export function extensionTestFilePaths(extDir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(extDir, {withFileTypes: true});
  } catch {
    return out;
  }
  const walkTestDir = (dir: string, relBase: string): void => {
    let sub: Dirent[];
    try {
      sub = readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of sub) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = `${relBase}/${entry.name}`;
      if (entry.isFile()) out.push(rel);
      else if (entry.isDirectory()) walkTestDir(join(dir, entry.name), rel);
    }
  };
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.isFile() && /\.test\.ts$/.test(entry.name)) out.push(entry.name);
    else if (entry.isDirectory() && entry.name === "test") walkTestDir(join(extDir, "test"), "test");
  }
  return out;
}

/** True when `path` (agent-dir-relative) is a test file of extension `name`. */
function isExtensionTestFilePath(name: string, path: string): boolean {
  const prefix = `extensions/${name}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /\.test\.ts$/.test(rest) || rest.startsWith("test/");
}

// ---------------------------------------------------------------------------
// Sandbox staging of the candidate extension (gate 4 precondition)

/** Walk the real extension dir into SurfaceFiles (agent-dir-relative relPaths); skip node_modules and dotfiles. */
function walkExtensionFiles(extDir: string, relBase: string, out: SurfaceFile[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(extDir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = relBase === "" ? entry.name : `${relBase}/${entry.name}`;
    const full = join(extDir, entry.name);
    if (entry.isDirectory()) walkExtensionFiles(full, rel, out);
    else if (entry.isFile()) out.push({relPath: rel, content: readFileSync(full, "utf8")});
  }
}

/**
 * Stage the touched extension into a probe sandbox at its agent-dir-relative
 * path (sandbox/extensions/<name>/...): the extension's REAL files (minus
 * node_modules), overlaid with the candidate's edits (writes + deletes), plus
 * a node_modules symlink to the REAL node_modules (read-by-convention — gates
 * are quality gates, not a security sandbox: allowlisted extensions execute
 * with the loop's privileges; realpath so a
 * symlinked real node_modules resolves once, not relatively into the sandbox).
 * Throws when the real extension dir or its node_modules is missing — the
 * driver treats a throw as a gate failure (it should be unreachable: gate 1
 * checks both).
 */
export function stageExtensionForSandbox(sandboxDir: string, agentDir: string, extName: string, edits: ProposedEdit[]): void {
  const realExtDir = join(agentDir, "extensions", extName);
  const realNodeModules = join(realExtDir, "node_modules");
  if (!existsSync(realExtDir)) throw new Error(`cannot stage extension "${extName}": real extension dir ${realExtDir} does not exist`);
  if (!existsSync(realNodeModules)) throw new Error(`cannot stage extension "${extName}": ${realNodeModules} does not exist`);
  const sandboxExtDir = join(sandboxDir, "extensions", extName);
  rmSync(sandboxExtDir, {recursive: true, force: true});
  mkdirSync(sandboxExtDir, {recursive: true});
  const files: SurfaceFile[] = [];
  walkExtensionFiles(realExtDir, "", files);
  for (const file of files) {
    const target = join(sandboxExtDir, file.relPath);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, file.content);
  }
  // Candidate edits on top (agent-dir-relative paths → sandbox paths).
  const prefix = `extensions/${extName}/`;
  for (const edit of edits) {
    if (!edit.path.startsWith(prefix)) continue;
    const target = join(sandboxDir, edit.path);
    if (edit.content === null) {
      rmSync(target, {force: true});
    } else {
      mkdirSync(dirname(target), {recursive: true});
      writeFileSync(target, edit.content);
    }
  }
  // Realpath: the real node_modules may itself be a symlink (e.g. the sample
  // extension's node_modules → ../node_modules); link the RESOLVED dir so the
  // sandbox copy cannot dangle and pi/tsc/bun read the real store read-only.
  symlinkSync(realpathSync(realNodeModules), join(sandboxExtDir, "node_modules"), "dir");
}

// ---------------------------------------------------------------------------
// Gates 2+3: tsc + bun test in the sandbox

export type CommandResult = {
  status: number | null,
  stdout: string,
  stderr: string,
  timedOut: boolean,
}

const OUTPUT_TAIL_BYTES = 512 * 1024;

/**
 * Run a command with a hard timeout: spawned detached in its own process
 * group so the timeout kill (SIGKILL to -pid, see probe.ts killProcessGroup)
 * takes the whole tree. Output is capped at a tail each (gates only need the
 * error tail for the report).
 */
export async function runCommand(args: string[], opts: {cwd: string, timeoutS: number}): Promise<CommandResult> {
  const child = spawn(args[0]!, args.slice(1), {
    cwd: opts.cwd,
    env: {...process.env},
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const cap = (text: string): string => (text.length > OUTPUT_TAIL_BYTES ? `…(truncated)…${text.slice(-OUTPUT_TAIL_BYTES)}` : text);
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    stdout = cap(stdout + chunk);
  });
  child.stderr!.on("data", (chunk: string) => {
    stderr = cap(stderr + chunk);
  });
  const status = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killProcessGroup(child.pid, "SIGKILL");
    }, opts.timeoutS * 1000);
    child.on("error", (err) => {
      stderr = cap(`${stderr}\nspawn error: ${err.message}`);
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return {status, stdout, stderr, timedOut};
}

export type GateRunner = (args: string[], opts: {cwd: string, timeoutS: number}) => Promise<CommandResult>;

/**
 * Minimal strict tsconfig synthesized into the SANDBOX extension copy when it
 * has no tsconfig.json of its own (mirrors the repo's extension tsconfigs:
 * bundler resolution, TS extensions imports, noEmit, strict, skipLibCheck).
 */
const SYNTHETIC_TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleDetection: "force",
      types: ["bun"],
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
    },
  },
  null,
  2,
)}\n`;

export type CodeGatesOptions = {
  /** Runner override (tests inject a fake); defaults to runCommand. */
  runCmd?: GateRunner,
  tscTimeoutS?: number,
  testTimeoutS?: number,
}

export type CodeGatesResult = {
  ok: boolean,
  /** Which gate failed ("tsc" = gate 2, "bun-test" = gate 3); null on success. */
  failedGate: "tsc" | "bun-test" | null,
  /** Captured output of the failed gate (tail); "" on success. */
  output: string,
  timedOut: boolean,
}

function gateOutput(result: CommandResult, timeoutS: number): {output: string, timedOut: boolean} {
  if (result.timedOut) {
    return {output: `gate timed out after ${timeoutS}s and its process group was killed\n${(result.stdout + result.stderr).trim()}`, timedOut: true};
  }
  return {output: (result.stdout + result.stderr).trim(), timedOut: false};
}

/**
 * Gates 2 and 3, in order, on the SANDBOX copy of `extName`. STOPS AT THE
 * FIRST FAILURE: when tsc fails, `bun test` is NOT run (verified by the gate
 * ordering unit test). Never throws for gate outcomes; a missing sandbox
 * extension dir surfaces as a tsc failure.
 */
export async function runCodeGates(sandboxDir: string, extName: string, options: CodeGatesOptions = {}): Promise<CodeGatesResult> {
  const run = options.runCmd ?? runCommand;
  const extDir = join(sandboxDir, "extensions", extName);
  // Gate 2: tsc on the sandbox copy — own tsconfig.json when staged, else the
  // synthesized minimal one (sandbox copy only, never the real extension).
  if (!existsSync(join(extDir, "tsconfig.json"))) writeFileSync(join(extDir, "tsconfig.json"), SYNTHETIC_TSCONFIG);
  const tscTimeoutS = options.tscTimeoutS ?? TSC_GATE_TIMEOUT_S;
  const tsc = await run(["bunx", "tsc", "--noEmit"], {cwd: extDir, timeoutS: tscTimeoutS});
  if (tsc.timedOut || tsc.status !== 0) {
    const {output, timedOut} = gateOutput(tsc, tscTimeoutS);
    return {ok: false, failedGate: "tsc", output, timedOut};
  }
  // Gate 3: bun test scoped to the extension (cwd = the sandbox extension
  // dir; bun discovers only that dir's *.test.ts files, node_modules excluded).
  const testTimeoutS = options.testTimeoutS ?? BUN_TEST_GATE_TIMEOUT_S;
  const test = await run(["bun", "test"], {cwd: extDir, timeoutS: testTimeoutS});
  if (test.timedOut || test.status !== 0) {
    const {output, timedOut} = gateOutput(test, testTimeoutS);
    return {ok: false, failedGate: "bun-test", output, timedOut};
  }
  return {ok: true, failedGate: null, output: "", timedOut: false};
}

// ---------------------------------------------------------------------------
// Gate 4: extension load-error capture from probe output

/**
 * Lines of captured nested-pi output (raw JSONL and/or stderr excerpts) that
 * report a failure to load the STAGED extension. A line counts when it
 * mentions `extensions/<name>/` (or the quoted name) AND is error-flavored —
 * either the empirical "Failed to load extension" phrasing or any
 * error/failed/exception wording. Everything else in the stream is ignored.
 */
export function loadErrorLines(raw: string, extName: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const mentionsName = trimmed.includes(`extensions/${extName}/`) || trimmed.includes(`extensions/${extName}"`) || trimmed.includes(`"${extName}"`);
    if (!mentionsName) continue;
    if (/failed to load extension/i.test(trimmed) || /error|failed|exception/i.test(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Gate 4 scan over one candidate's probe artifacts: every
 * `<candDir>/ws/*.raw.jsonl` plus every stderrExcerpt recorded in
 * `<candDir>/tasks/*.json`. Returns the captured load-error lines (deduped,
 * first occurrence order) — empty means the staged extension loaded cleanly.
 */
export function scanProbeLoadErrors(candDir: string, extName: string): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    for (const line of loadErrorLines(raw, extName)) {
      if (!seen.has(line)) {
        seen.add(line);
        errs.push(line);
      }
    }
  };
  const wsDir = join(candDir, "ws");
  if (existsSync(wsDir)) {
    for (const file of readdirSync(wsDir).filter((f) => f.endsWith(".raw.jsonl")).sort()) {
      try {
        push(readFileSync(join(wsDir, file), "utf8"));
      } catch {
        // unreadable raw JSONL — the tasks/*.json stderr excerpts are the fallback
      }
    }
  }
  const tasksDir = join(candDir, "tasks");
  if (existsSync(tasksDir)) {
    for (const file of readdirSync(tasksDir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const parsed = JSON.parse(readFileSync(join(tasksDir, file), "utf8")) as {stderrExcerpt?: unknown};
        if (typeof parsed.stderrExcerpt === "string") push(parsed.stderrExcerpt);
      } catch {
        // corrupt result file — scoreSuite resume would re-probe it anyway
      }
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Selection: per-candidate minWin for code-bearing candidates

/**
 * Per-candidate selection thresholds: a candidate with ANY edit under the
 * extensions kind uses `codeMinWin` (config code.minWin, default 2) instead
 * of the global minWin — code wins must be worth more than prose wins.
 */
export function selectionConfigForEdits(edits: Array<{path: string}>, base: SelectionConfig, codeMinWin: number): SelectionConfig {
  return edits.some((e) => isExtensionPath(e.path)) ? {...base, minWin: codeMinWin} : base;
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  // Usage: bun run loop/lib/gates.ts <sandboxDir> <extName> — runs gates 2+3
  // on an already-staged sandbox extension (debugging aid; gate 1 and the
  // probe staging live in proposer validation and driver.ts).
  const [sandboxDir, extName] = process.argv.slice(2);
  if (sandboxDir === undefined || extName === undefined) {
    console.error("usage: bun run loop/lib/gates.ts <sandboxDir> <extName>");
    process.exitCode = 2;
  } else {
    const result = await runCodeGates(sandboxDir, extName);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}
