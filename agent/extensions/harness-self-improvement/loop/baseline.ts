#!/usr/bin/env bun
/**
 * Baseline run for the harness self-improvement loop: snapshot the real agent
 * components, stage a sandbox, probe all suite tasks, and record the results
 * (report + ledger + result cache).
 *
 * FINGERPRINT CANONICAL FORM (documented contract):
 *   sha256 hex over the UTF-8 string built by concatenating, with NUL (0x00)
 *   separators and a trailing NUL after every field, in exactly this order:
 *     1. "agents-md", the AGENTS.md text
 *     2. for each skill file, in ascending relPath order (a < b UTF-16
 *        code-unit comparison, locale-independent — never localeCompare):
 *        "skill", the skill's relPath (POSIX-style, relative to the agent
 *        dir, e.g. "skills/x/SKILL.md" — S8 note: pre-S8 this was relative
 *        to skills/; the form changed with the kinds-generic snapshot),
 *        then the skill file's full text as its own NUL-terminated field —
 *        relPath and content are separate fields so their boundary can never
 *        be shifted by crafting either string
 *     3. for each prompt template file, same pattern: "template", relPath,
 *        content (ascending relPath order)
 *     4. for each subagent file, same pattern: "subagent", relPath, content
 *     5. "pi", the resolved pi binary's version ("unknown" when it could not
 *        be determined) — a cache written under a different pi version is
 *        therefore never reused
 *     6. "model", the captured --model flag for nested pi runs (provider +
 *        model id, e.g. "ozon-real/AgentLLM-big"), or "" when no model was
 *        captured — a model change therefore invalidates the fingerprint
 *   The NUL separator makes the encoding prefix-free: no field boundary is
 *   ambiguous regardless of file content.
 *   S8 CACHE-INVALIDATION NOTE: the S8 surface-registry migration changed the
 *   canonical form (templates + subagents fields added, skills relPaths now
 *   agent-dir-relative), so every pre-S8 baseline cache misses ONCE by design
 *   and a full probed baseline rebuild is expected.
 *
 * RESULT CACHE: loop/.cache/baseline-<fingerprint>[-<taskset>].json holds the
 * per-task results. <taskset> (a 16-hex-char digest of the sorted task-name
 * set) is appended whenever a caller scopes the baseline to a task subset
 * (the /hloop driver always passes one, so a --suite-filtered baseline can
 * never replay a different task set's cached results). When the cache file
 * exists, NO new probes run — the report is regenerated from cached results
 * with cached: true, and the ledger entry gets kind "baseline-cached".
 * --cached forces cache-only mode and errors out when no cache exists for
 * the current fingerprint.
 *
 * Usage:
 *   bun run loop/baseline.ts [--cached] [--sandbox <dir>]
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {listTaskDirs, loadTask, suiteRoot} from "./lib/suite.ts";
import {agentsMdOf, buildSandbox, captureModelFlag, snapshotReal, type ComponentSnapshot} from "./lib/stage.ts";
import {scoreSuite, type ScoreSuiteResult, type TaskScoreResult} from "./lib/score.ts";
import {appendEntry, newRunId, renderReport, type ReportTask} from "./lib/ledger.ts";
import {resolvePiBinary} from "./lib/probe.ts";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const runsDir = join(extensionRoot, "runs");
const cacheDir = join(extensionRoot, "loop", ".cache");

/**
 * sha256 over the canonical snapshot form described in the file header:
 * agentsMd + skills + prompt templates + subagents (relPath and content as
 * separate fields, each group sorted by UTF-16 code-unit relPath order) +
 * resolved pi version + captured model flag.
 */
export function fingerprintSnapshot(
  snapshot: ComponentSnapshot,
  model: string | undefined,
  piBinary?: {bin: string, version: string | null} | null,
): string {
  const hash = createHash("sha256");
  const field = (...parts: string[]): void => {
    for (const part of parts) hash.update(part, "utf8");
    hash.update("\0");
  };
  const byRelPath = (a: {relPath: string}, b: {relPath: string}): number => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0);
  field("agents-md", agentsMdOf(snapshot));
  for (const skill of [...snapshot.kinds.skills].sort(byRelPath)) {
    field("skill", skill.relPath);
    field(skill.content);
  }
  for (const template of [...snapshot.kinds.templates].sort(byRelPath)) {
    field("template", template.relPath);
    field(template.content);
  }
  for (const subagent of [...snapshot.kinds.subagents].sort(byRelPath)) {
    field("subagent", subagent.relPath);
    field(subagent.content);
  }
  field("pi", piBinary?.version ?? "unknown");
  field("model", model ?? "");
  return hash.digest("hex");
}

function toReportTasks(results: TaskScoreResult[]): ReportTask[] {
  return results.map((r) => ({
    task: r.task,
    category: r.category,
    pass: r.pass,
    durationMs: r.durationMs,
    tokens: r.usage?.totalTokens ?? 0,
    checkerOutput: r.checkerOutput,
  }));
}

type CachePayload = {
  fingerprint: string,
  model: string | null,
  ts: string,
  results: TaskScoreResult[],
};

/** Cache payload shape shared by baseline.ts and the /hloop driver. */
export type BaselineCachePayload = {} & CachePayload

/** loop/.cache — where baseline result caches live. */
export function baselineCacheDir(): string {
  return cacheDir;
}

/**
 * Cache file for a fingerprint, optionally scoped to a task-name set (the
 * 16-hex digest of the sorted NUL-joined names). Without taskNames this is
 * the legacy fingerprint-only path (compatible with pre-S6 cache files).
 * `dir` overrides the cache directory (the /hloop driver's selftest uses a
 * temp dir so fake runs never touch the real cache).
 */
export function baselineCachePath(fingerprint: string, taskNames?: string[], dir: string = cacheDir): string {
  if (taskNames === undefined || taskNames.length === 0) return join(dir, `baseline-${fingerprint}.json`);
  const digest = createHash("sha256").update([...taskNames].sort().join("\0")).digest("hex").slice(0, 16);
  return join(dir, `baseline-${fingerprint}-${digest}.json`);
}

function isCacheResult(v: unknown): v is TaskScoreResult {
  return v !== null && typeof v === "object" &&
    typeof (v as TaskScoreResult).task === "string" &&
    typeof (v as TaskScoreResult).pass === "boolean" &&
    typeof (v as TaskScoreResult).durationMs === "number";
}

/**
 * Read + validate a baseline cache file; null when missing, unreadable, or
 * malformed (a malformed cache is a cache miss, never fatal).
 */
export function readBaselineCache(path: string): BaselineCachePayload | null {
  if (!existsSync(path)) return null;
  try {
    const payload = JSON.parse(readFileSync(path, "utf8")) as BaselineCachePayload;
    if (typeof payload.fingerprint !== "string" || !Array.isArray(payload.results) || !payload.results.every(isCacheResult)) {
      throw new Error("cache results are not an array of {task, pass, durationMs} entries");
    }
    return payload;
  } catch (err) {
    console.log(`[baseline] cache file unreadable, treating as cache miss: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Write a baseline cache file (creating the cache dir as needed). */
export function writeBaselineCache(payload: BaselineCachePayload, path: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

/** True when the result list's task-name set equals `taskNames` exactly. */
export function cacheMatchesTaskSet(results: Array<{task: string}>, taskNames: string[]): boolean {
  return results.length === taskNames.length && [...results.map((r) => r.task)].sort().join("\0") === [...taskNames].sort().join("\0");
}

function loadAllTasks() {
  const root = suiteRoot();
  const tasks = listTaskDirs(root).map((dirName) => loadTask(root, dirName));
  const invalid = tasks.filter((t) => t.meta === null || t.shapeErrors.length > 0);
  if (invalid.length > 0) {
    console.error("suite has invalid tasks — run `bun run loop/lib/suite.ts validate` first:");
    for (const t of invalid)
      for (const e of t.shapeErrors)
        console.error(`  ${t.name}: ${e}`);
    process.exit(1);
  }
  return tasks;
}

function parseArgs(argv: string[]): {cachedOnly: boolean, sandboxArg: string | undefined} {
  let cachedOnly = false;
  let sandboxArg: string | undefined;
  const sandboxIdx = argv.indexOf("--sandbox");
  if (sandboxIdx !== -1) sandboxArg = argv[sandboxIdx + 1];
  if (argv.includes("--cached")) cachedOnly = true;
  if (sandboxIdx !== -1 && sandboxArg === undefined) {
    console.error("usage: bun run loop/baseline.ts [--cached] [--sandbox <dir>]");
    process.exit(2);
  }
  return {cachedOnly, sandboxArg};
}

async function main(): Promise<void> {
  const {cachedOnly, sandboxArg} = parseArgs(process.argv.slice(2));
  // Fail fast on a bad PI_BIN before creating any run directory or probing.
  let piBinary: {bin: string, version: string | null};
  try {
    piBinary = resolvePiBinary();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const snapshot = snapshotReal();
  const model = captureModelFlag() ?? null;
  let reportPiBinary = piBinary;
  const fingerprint = fingerprintSnapshot(snapshot, model ?? undefined, piBinary);
  // Cache is keyed by fingerprint + task set: a --suite-scoped baseline must
  // never replay a cache written for a different set of tasks.
  const tasks = loadAllTasks();
  const taskNames = tasks.map((t) => t.name);
  const cachePath = baselineCachePath(fingerprint, taskNames);

  let results: TaskScoreResult[];
  let aggregate: ScoreSuiteResult["aggregate"];
  let cached: boolean;
  // On a cache hit the report surfaces the pi binary recorded in the cached
  // results (the one that actually produced them), not the current binary.
  const runId = newRunId();
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, {recursive: true});

  let cachedPayload: CachePayload | null = null;
  const hit = readBaselineCache(cachePath);
  if (hit !== null && cacheMatchesTaskSet(hit.results, taskNames)) {
    cachedPayload = hit;
    console.log(`[baseline] cache hit for fingerprint ${fingerprint} (${taskNames.length} tasks) — regenerating report, no probes`);
  }

  if (cachedPayload !== null) {
    results = cachedPayload.results;
    aggregate = {
      passCount: results.filter((r) => r.pass).length,
      total: results.length,
      totalTokens: results.reduce((sum, r) => sum + (r.usage?.totalTokens ?? 0), 0),
    };
    cached = true;
    reportPiBinary = results.find((r) => r.piBinary)?.piBinary ?? piBinary;
  } else {
    if (cachedOnly) {
      console.error(`--cached: no baseline cache for fingerprint ${fingerprint} (expected ${cachePath})`);
      process.exit(1);
    }
    // --sandbox hands a caller-supplied dir over to the baseline run;
    // buildSandbox wipes its target, which is safe for dirs this tool owns
    // (runs/<runId>/sandbox) and is the documented behavior for --sandbox too.
    const sandboxDir = sandboxArg ?? join(runDir, "sandbox");
    buildSandbox(snapshot, sandboxDir);
    console.log(`[baseline] run ${runId}: fingerprint ${fingerprint}, ${tasks.length} tasks, model ${model ?? "<default>"}`);
    const scored = await scoreSuite(tasks, sandboxDir, runDir, {model: model ?? undefined});
    results = scored.results;
    aggregate = scored.aggregate;
    writeBaselineCache({fingerprint, model, ts: new Date().toISOString(), results}, cachePath);
    cached = false;
  }

  const report = renderReport({
    runId,
    ts: new Date().toISOString(),
    kind: cached ? "baseline-cached" : "baseline",
    model,
    fingerprint,
    cached,
    piBinary: reportPiBinary,
    tasks: toReportTasks(results),
    aggregate,
  });
  writeFileSync(join(runDir, "report.md"), report);

  appendEntry({
    runId,
    ts: new Date().toISOString(),
    kind: cached ? "baseline-cached" : "baseline",
    fingerprint,
    scores: {passCount: aggregate.passCount, total: aggregate.total},
    usage: {totalTokens: aggregate.totalTokens},
    cached,
  });

  console.log(`[baseline] ${aggregate.passCount}/${aggregate.total} pass, ${aggregate.totalTokens} tokens (${cached ? "cached" : "probed"})`);
  console.log(`[baseline] report: ${join(runDir, "report.md")}`);
  if (!cached) console.log(`[baseline] cache: ${cachePath}`);
}

if (import.meta.main) {
  await main();
}
