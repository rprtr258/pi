#!/usr/bin/env bun
/**
 * Task-suite runner for the harness self-improvement loop.
 *
 * The suite lives in loop/suite/<task>/ — see loop/suite/README.md for the
 * TASK.md / check.ts / ref+broken contract. This runner is the objective
 * function's gatekeeper: it lists tasks and validates that every checker
 * passes on the ref fixture, fails on the broken fixture, finishes within
 * 30s, and never mutates the workspace it was given.
 *
 * Usage:
 *   bun run loop/lib/suite.ts list       task names + categories
 *   bun run loop/lib/suite.ts validate   full validation; non-zero exit on any failure
 */
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const CHECKER_TIMEOUT_MS = 30_000;
const SETUP_TIMEOUT_MS = 30_000;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type TaskMeta = {
  name: string,
  description: string,
  timeoutS: number,
};

export type TaskPaths = {
  dir: string,
  taskMd: string,
  checkTs: string,
  ref: string,
  broken: string,
  setupSh: string | null,
};

export type TaskCheckResult = {
  name: string,
  category: string,
  ok: boolean,
  shapeErrors: string[],
  ref: CheckerRun | null, // null when shape checks failed
  broken: CheckerRun | null,
};

export type CheckerRun = {
  /** true when the run had the outcome validation requires */
  ok: boolean,
  exitCode: number | null,
  signal: string | null,
  output: string,
  error: string | null, // setup failure or mutation/timeout description
  mutated: boolean,
};

export function suiteRoot(): string {
  return fileURLToPath(new URL("../suite", import.meta.url));
}

// ---------------------------------------------------------------------------
// Frontmatter parsing

export type ParsedTaskMd = {
  meta: TaskMeta | null,
  errors: string[],
};

export function parseTaskMd(text: string): ParsedTaskMd {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {meta: null, errors: ["missing opening '---' frontmatter delimiter"]};
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return {meta: null, errors: ["missing closing '---' frontmatter delimiter"]};
  }
  const fields = new Map<string, string>();
  const errors: string[] = [];
  for (const line of lines.slice(1, close)) {
    if (!line.trim())
      continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (!m) {
      errors.push(`malformed frontmatter line: ${JSON.stringify(line)}`);
      continue;
    }
    fields.set(m[1]!, m[2]!);
  }
  const name = fields.get("name");
  const description = fields.get("description");
  const timeoutRaw = fields.get("timeout_s");
  const timeoutS = timeoutRaw === undefined ? NaN : Number(timeoutRaw);
  if (name === undefined || !NAME_RE.test(name))
    errors.push("frontmatter 'name' missing or not kebab-case");
  if (description === undefined || description.trim() === "")
    errors.push("frontmatter 'description' missing or empty");
  if (timeoutRaw === undefined || !Number.isInteger(timeoutS) || timeoutS <= 0 || timeoutS > 120)
    errors.push("frontmatter 'timeout_s' missing or not an integer in 1..120");
  if (errors.length > 0)
    return {meta: null, errors};
  return {meta: {name: name!, description: description!, timeoutS}, errors};
}

// ---------------------------------------------------------------------------
// Task discovery + shape checks

export type LoadedTask = {
  name: string,
  category: string,
  paths: TaskPaths,
  meta: TaskMeta | null,
  shapeErrors: string[],
};

export function listTaskDirs(root: string): string[] {
  if (!existsSync(root))
    return [];
  // Every suite subdirectory is discovered; dirs without a loadable TASK.md are
  // surfaced as failures/warnings by loadTask instead of being silently skipped.
  return readdirSync(root, {withFileTypes: true})
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function loadTask(root: string, dirName: string): LoadedTask {
  const dir = join(root, dirName);
  const paths: TaskPaths = {
    dir,
    taskMd: join(dir, "TASK.md"),
    checkTs: join(dir, "check.ts"),
    ref: join(dir, "ref"),
    broken: join(dir, "broken"),
    setupSh: existsSync(join(dir, "setup.sh")) ? join(dir, "setup.sh") : null,
  };
  const shapeErrors: string[] = [];
  if (!NAME_RE.test(dirName)) {
    shapeErrors.push(`task directory name not kebab-case: ${dirName}`);
  } else if (dirName.startsWith("smoke-")) {
    shapeErrors.push("smoke- prefix is reserved for a later step");
  }
  if (dirName.includes(".")) {
    // e.g. checker accidentally placed as <name>.ts sibling — keep discovery strict
    shapeErrors.push("task directory name contains '.'");
  }
  let meta: TaskMeta | null = null;
  if (!existsSync(paths.taskMd) || !statSync(paths.taskMd).isFile()) {
    shapeErrors.push(existsSync(paths.taskMd) ? "TASK.md is not a file" : "TASK.md missing");
  } else {
    const parsed = parseTaskMd(readFileSync(paths.taskMd, "utf8"));
    shapeErrors.push(...parsed.errors.map((e) => `TASK.md: ${e}`));
    meta = parsed.meta;
    if (meta && meta.name !== dirName) {
      shapeErrors.push(`TASK.md name '${meta.name}' does not match directory name '${dirName}'`);
    }
  }
  try {
    if (!statSync(paths.checkTs).isFile()) shapeErrors.push("check.ts is not a file");
  } catch {
    shapeErrors.push("check.ts missing");
  }
  if (existsSync(paths.checkTs) && !(statSync(paths.checkTs).mode & 0o111)) {
    shapeErrors.push("check.ts is not executable");
  }
  for (const [label, p] of [["ref/", paths.ref], ["broken/", paths.broken]] as const) {
    try {
      if (readdirSync(p).length === 0) shapeErrors.push(`${label} is empty`);
    } catch {
      shapeErrors.push(`${label} missing or unreadable`);
    }
  }
  const category = dirName.split("-")[0] ?? dirName;
  return {name: dirName, category, paths, meta, shapeErrors};
}

// ---------------------------------------------------------------------------
// Workspace snapshot (mutation detection)

function hashSnapshot(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    const entries = readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      const full = join(dir, e.name);
      if (e.isSymbolicLink()) {
        hash.update(`l ${rel}\n${readlinkSync(full)}\n`);
      } else if (e.isDirectory()) {
        walk(full, rel);
      } else {
        hash.update(`f ${rel} ${statSync(full).mode.toString(8)}\n`);
        hash.update(readFileSync(full));
        hash.update("\n");
      }
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

// ---------------------------------------------------------------------------
// Checker execution

function runSetup(paths: TaskPaths, ws: string): string | null {
  if (!paths.setupSh) return null;
  const proc = spawnSync("bash", [paths.setupSh, ws], {
    cwd: ws,
    timeout: SETUP_TIMEOUT_MS,
    encoding: "utf8",
  });
  if (proc.error)
    return `setup.sh failed to run: ${proc.error.message}`;
  if (proc.status !== 0) 
    return `setup.sh exited ${proc.status ?? `signal ${proc.signal}`}\n${(proc.stderr ?? "").trim()}`;
  return null;
}

function runCheckerOnce(paths: TaskPaths, fixtureDir: string, expect: "pass" | "fail", timeoutMs: number): CheckerRun {
  const tmp = mkdtempSync(join(tmpdir(), "harness-suite-"));
  const ws = join(tmp, "ws");
  try {
    cpSync(fixtureDir, ws, {recursive: true});
    const setupError = runSetup(paths, ws);
    if (setupError) {
      return {ok: false, exitCode: null, signal: null, output: "", error: setupError, mutated: false};
    }
    const before = hashSnapshot(ws);
    // Direct exec: the checker is an executable script (bun shebang), not a
    // bash invocation — any language works as long as the shebang is right.
    const proc = spawnSync(paths.checkTs, [ws], {
      cwd: ws,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const mutated = hashSnapshot(ws) !== before;
    const exitCode = proc.status;
    const timedOut = proc.signal === "SIGTERM" && exitCode === null;
    const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
    let error: string | null = null;
    if (timedOut)
      error = `checker timed out after ${timeoutMs / 1000}s`;
    else if (proc.error)
      error = `checker failed to run: ${proc.error.message}`;
    else if (mutated)
      error = "checker modified the workspace (checksum changed)";
    else if (expect === "pass" && exitCode !== 0)
      error = `expected exit 0, got ${exitCode}`;
    else if (expect === "fail" && exitCode === 0)
      error = "expected non-zero exit on broken fixture, got 0";
    return {
      ok: error === null,
      exitCode,
      signal: proc.signal ?? null,
      output,
      error,
      mutated,
    };
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
}

// ---------------------------------------------------------------------------
// Commands

export type ValidateOptions = {
  /** Checker timeout override in ms; defaults to 30s. */
  checkerTimeoutMs?: number,
};

export function validateSuite(root: string, options: ValidateOptions = {}): {ok: boolean; results: TaskCheckResult[]} {
  const checkerTimeoutMs = options.checkerTimeoutMs ?? CHECKER_TIMEOUT_MS;
  const results: TaskCheckResult[] = [];
  for (const dirName of listTaskDirs(root)) {
    const task = loadTask(root, dirName);
    let ref: CheckerRun | null = null;
    let broken: CheckerRun | null = null;
    if (task.shapeErrors.length === 0) {
      ref = runCheckerOnce(task.paths, task.paths.ref, "pass", checkerTimeoutMs);
      broken = runCheckerOnce(task.paths, task.paths.broken, "fail", checkerTimeoutMs);
    }
    const ok = task.shapeErrors.length === 0 && (ref?.ok ?? false) && (broken?.ok ?? false);
    results.push({name: task.name, category: task.category, ok, shapeErrors: task.shapeErrors, ref, broken});
  }
  return {ok: results.every((r) => r.ok), results};
}

function printCheckRun(label: string, run: CheckerRun): void {
  const status = run.ok ? "ok" : "FAIL";
  console.log(`  ${label.padEnd(7)} ${status}${run.exitCode !== null ? ` (exit ${run.exitCode})` : ""}`);
  if (run.error)
    console.log(`          ${run.error}`);
  if (!run.ok && run.output) {
    for (const line of run.output.split("\n").slice(-10))
      console.log(`          | ${line}`);
  }
}

export function runList(root: string): void {
  const dirs = listTaskDirs(root);
  const byCategory = new Map<string, string[]>();
  for (const dirName of dirs) {
    const cat = dirName.split("-")[0] ?? dirName;
    if (!byCategory.has(cat))
      byCategory.set(cat, []);
    byCategory.get(cat)!.push(dirName);
  }
  for (const cat of [...byCategory.keys()].sort()) {
    for (const name of byCategory.get(cat)!) {
      const task = loadTask(root, name);
      const desc = task.meta?.description ?? "";
      console.log(`${name.padEnd(28)} ${cat.padEnd(8)} ${desc}`);
      if (task.meta === null) {
        console.log(`  WARNING: suite/${name} has no loadable TASK.md and will fail validation`);
      }
    }
  }
  console.log(`\n${dirs.length} tasks in ${byCategory.size} categories: ${[...byCategory.keys()].sort().join(", ")}`);
}

export function runValidate(root: string): number {
  const {ok, results} = validateSuite(root);
  for (const r of results) {
    console.log(`== ${r.name} [${r.category}] ==`);
    if (r.shapeErrors.length > 0) {
      for (const e of r.shapeErrors)
        console.log(`  shape  FAIL ${e}`);
    } else {
      printCheckRun("ref:", r.ref!);
      printCheckRun("broken:", r.broken!);
    }
    console.log(`  => ${r.ok ? "PASS" : "FAIL"}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tasks valid`);
  if (failed.length > 0)
    console.log(`failing: ${failed.map((r) => r.name).join(", ")}`);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const cmd = process.argv[2];
  const root = suiteRoot();
  if (cmd === "list") {
    runList(root);
  } else if (cmd === "validate") {
    process.exitCode = runValidate(root);
  } else {
    console.error("usage: bun run loop/lib/suite.ts [list|validate]");
    process.exitCode = 2;
  }
}
