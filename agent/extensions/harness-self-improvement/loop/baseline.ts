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
 *        "skill", the skill's relPath (POSIX-style, relative to skills/),
 *        then the skill file's full text as its own NUL-terminated field —
 *        relPath and content are separate fields so their boundary can never
 *        be shifted by crafting either string
 *     3. "pi", the resolved pi binary's version ("unknown" when it could not
 *        be determined) — a cache written under a different pi version is
 *        therefore never reused
 *     4. "model", the captured --model flag for nested pi runs (provider +
 *        model id, e.g. "ozon-real/AgentLLM-big"), or "" when no model was
 *        captured — a model change therefore invalidates the fingerprint
 *   The NUL separator makes the encoding prefix-free: no field boundary is
 *   ambiguous regardless of file content.
 *
 * RESULT CACHE: loop/.cache/baseline-<fingerprint>.json holds the per-task
 * results. When it exists, NO new probes run — the report is regenerated from
 * cached results with cached: true, and the ledger entry gets kind
 * "baseline-cached". --cached forces cache-only mode and errors out when no
 * cache exists for the current fingerprint.
 *
 * Usage:
 *   bun run loop/baseline.ts [--cached] [--sandbox <dir>]
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {listTaskDirs, loadTask, suiteRoot} from "./lib/suite.ts";
import {buildSandbox, captureModelFlag, snapshotReal, type ComponentSnapshot} from "./lib/stage.ts";
import {scoreSuite, type ScoreSuiteResult, type TaskScoreResult} from "./lib/score.ts";
import {appendEntry, newRunId, renderReport, type ReportTask} from "./lib/ledger.ts";
import {resolvePiBinary} from "./lib/probe.ts";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const runsDir = join(extensionRoot, "runs");
const cacheDir = join(extensionRoot, "loop", ".cache");

/**
 * sha256 over the canonical snapshot form described in the file header:
 * agentsMd + skills (relPath and content as separate fields, sorted by UTF-16
 * code-unit relPath order) + resolved pi version + captured model flag.
 */
export function fingerprintSnapshot(
  snapshot: ComponentSnapshot,
  model: string | undefined,
  piBinary?: {bin: string; version: string | null} | null,
): string {
  const hash = createHash("sha256");
  const field = (...parts: string[]): void => {
    for (const part of parts) hash.update(part, "utf8");
    hash.update("\0");
  };
  field("agents-md", snapshot.agentsMd);
  for (const skill of [...snapshot.skills].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))) {
    field("skill", skill.relPath);
    field(skill.content);
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

interface CachePayload {
  fingerprint: string;
  model: string | null;
  ts: string;
  results: TaskScoreResult[];
}

function loadAllTasks() {
  const root = suiteRoot();
  const tasks = listTaskDirs(root).map((dirName) => loadTask(root, dirName));
  const invalid = tasks.filter((t) => t.meta === null || t.shapeErrors.length > 0);
  if (invalid.length > 0) {
    console.error("suite has invalid tasks — run `bun run loop/lib/suite.ts validate` first:");
    for (const t of invalid) for (const e of t.shapeErrors) console.error(`  ${t.name}: ${e}`);
    process.exit(1);
  }
  return tasks;
}

function parseArgs(argv: string[]): {cachedOnly: boolean; sandboxArg: string | undefined} {
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
  let piBinary: {bin: string; version: string | null};
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
  const cachePath = join(cacheDir, `baseline-${fingerprint}.json`);

  let results: TaskScoreResult[];
  let aggregate: ScoreSuiteResult["aggregate"];
  let cached: boolean;
  // On a cache hit the report surfaces the pi binary recorded in the cached
  // results (the one that actually produced them), not the current binary.
  const runId = newRunId();
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, {recursive: true});

  let cachedPayload: CachePayload | null = null;
  if (existsSync(cachePath)) {
    try {
      const payload = JSON.parse(readFileSync(cachePath, "utf8")) as CachePayload;
      const isCacheResult = (v: unknown): v is TaskScoreResult =>
        v !== null && typeof v === "object" &&
        typeof (v as TaskScoreResult).task === "string" &&
        typeof (v as TaskScoreResult).pass === "boolean" &&
        typeof (v as TaskScoreResult).durationMs === "number";
      if (!Array.isArray(payload.results) || !payload.results.every(isCacheResult)) {
        throw new Error("cache results are not an array of {task, pass, durationMs} entries");
      }
      cachedPayload = payload;
      console.log(`[baseline] cache hit for fingerprint ${fingerprint} — regenerating report, no probes`);
    } catch (err) {
      console.log(`[baseline] cache file unreadable, treating as cache miss: ${err instanceof Error ? err.message : String(err)}`);
    }
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
    const tasks = loadAllTasks();
    // --sandbox hands a caller-supplied dir over to the baseline run;
    // buildSandbox wipes its target, which is safe for dirs this tool owns
    // (runs/<runId>/sandbox) and is the documented behavior for --sandbox too.
    const sandboxDir = sandboxArg ?? join(runDir, "sandbox");
    buildSandbox(snapshot, sandboxDir);
    console.log(`[baseline] run ${runId}: fingerprint ${fingerprint}, ${tasks.length} tasks, model ${model ?? "<default>"}`);
    const scored = await scoreSuite(tasks, sandboxDir, runDir, {model: model ?? undefined});
    results = scored.results;
    aggregate = scored.aggregate;
    mkdirSync(cacheDir, {recursive: true});
    const payload: CachePayload = {fingerprint, model, ts: new Date().toISOString(), results};
    writeFileSync(cachePath, `${JSON.stringify(payload, null, 2)}\n`);
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
