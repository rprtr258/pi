#!/usr/bin/env bun
/**
 * Headless /hloop driver harness for loop/chaos.sh (Step 12).
 *
 * Runs the REAL runLoop state machine (loop/driver.ts) against the REAL
 * suite tasks with REAL nested-pi probes, but:
 *   - the Proposer is a CANNED callModel (no proposer model call, deterministic
 *     candidate — the chaos scenarios kill probe/gate phases, not the proposer);
 *   - apply is always dryRun (chaos must never write to the live agent config);
 *   - runsDir can be redirected to a temp dir via HLOOP_CHAOS_RUNS_DIR so the
 *     rehearsal never churns the real runs/ history (and never triggers
 *     retention pruning of pre-S12 run dirs);
 *   - cacheDir can be redirected via HLOOP_CHAOS_CACHE_DIR so each scenario
 *     starts from a cache MISS (a cache hit would skip probing entirely and
 *     leave nothing to kill mid-phase);
 *   - the code-gate and mcp-startup-probe runners can be wrapped with a
 *     pre-delay (HLOOP_CHAOS_GATES_DELAY_S / HLOOP_CHAOS_MCP_DELAY_S) to
 *     widen the kill window for scenarios (d)/(e): a cached `bunx tsc` in the
 *     sandbox completes in a few seconds, too fast to time a kill against
 *     reliably headlessly. The gates themselves stay REAL (they run after the
 *     delay, on resume, without the env set).
 *
 * Usage:
 *   bun run loop/chaos-run.ts [--resume <runId>] [--suite <glob>]
 *                             [--concurrency N] [--candidate agents-md|gates|mcp]
 *
 * Prints the LoopRunResult JSON on exit; exit code 0 iff the run was ok.
 */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runLoop, type LoopRunResult} from "./driver.ts";
import {DEFAULT_LOOP_CONFIG, type LoopConfig} from "./lib/apply.ts";
import {runCodeGates, runStartupProbe, type CodeGatesResult, type StartupProbeResult} from "./lib/gates.ts";
import type {CallModel} from "./lib/proposer.ts";
import {realPiAgentDir} from "./lib/stage.ts";

function argValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

const resumeRunId = argValue("--resume");
const suiteGlob = resumeRunId === undefined ? argValue("--suite") ?? "smoke-*" : undefined;
const concurrency = Math.max(1, Number(argValue("--concurrency") ?? "1"));
const candidateMode = argValue("--candidate") ?? "agents-md";
const gatesDelayS = Number(process.env.HLOOP_CHAOS_GATES_DELAY_S ?? "0");
const mcpDelayS = Number(process.env.HLOOP_CHAOS_MCP_DELAY_S ?? "0");

/**
 * Canned candidate per mode:
 *   agents-md — an AGENTS.md edit (prose candidate; wins only if a smoke probe
 *               flaked, and even then applies as dry-run).
 *   gates     — an edit to extensions/harness-loop-sample/index.ts (a no-op
 *               comment appended to the REAL file content, so the real tsc +
 *               bun test gates pass on resume).
 *   mcp       — an mcp.json adding one throwaway stdio server to the real
 *               config (exercises the mcp staging + startup-probe path; its
 *               connect outcome on resume is irrelevant to the chaos
 *               assertions — the run completes either way).
 */
/**
 * Canned candidate per mode. Content is UNIQUE per invocation (timestamp +
 * pid baked into the edit): the proposer dedupes candidates against
 * previously REJECTED proposal fingerprints in the run ledger, so a canned
 * candidate reused verbatim across chaos runs would be rejected as a repeat
 * ("0/1 validated" → no-valid-candidates) after the first scenario appended
 * its proposal-rejected entry.
 */
function chaosStamp(): string {
  return `${new Date().toISOString()} pid ${process.pid}`;
}

function candidateJson(mode: string): string {
  if (mode === "gates") {
    const extPath = join(realPiAgentDir(), "extensions", "harness-loop-sample", "index.ts");
    const content = `${readFileSync(extPath, "utf8")}\n// hloop chaos candidate: no-op comment edit (${chaosStamp()})\n`;
    return JSON.stringify([{rationale: "chaos: code candidate for the mid-gate kill scenario", edits: [{path: "extensions/harness-loop-sample/index.ts", content}]}]);
  }
  if (mode === "mcp") {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(readFileSync(join(realPiAgentDir(), "mcp.json"), "utf8"));
    } catch {
      parsed = {};
    }
    const base = (parsed !== null && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const servers = (base["mcpServers"] !== null && typeof base["mcpServers"] === "object" ? base["mcpServers"] : {}) as Record<string, unknown>;
    servers[`hloop-chaos-${process.pid}`] = {command: "false", args: []};
    return JSON.stringify([{rationale: "chaos: mcp candidate for the mid-startup-probe kill scenario", edits: [{path: "mcp.json", content: JSON.stringify({...base, mcpServers: servers}, null, 2)}]}]);
  }
  return JSON.stringify([{rationale: "chaos: prose candidate for the mid-iteration kill scenario", edits: [{path: "AGENTS.md", content: `# harness instructions (chaos rehearsal candidate ${chaosStamp()} — never applied, dryRun)\n`}]}]);
}

const callModel: CallModel = async () => candidateJson(candidateMode);

const config: LoopConfig = {
  ...DEFAULT_LOOP_CONFIG,
  apply: {dryRun: true},
  budget: {maxTotalTokens: 2_000_000, maxIterations: 1},
  candidates: {maxPerIteration: 1},
  parallel: {enabled: concurrency > 1, maxConcurrentProbes: concurrency},
  // The `gates` candidate edits extensions/harness-loop-sample — allowlisted
  // in the real loop/config.json but NOT in DEFAULT_LOOP_CONFIG; carry the
  // real allowlist (the candidate is validated against it at propose time).
  code: {allow: ["harness-loop-sample"], minWin: DEFAULT_LOOP_CONFIG.code.minWin},
};

// Kill-window wideners for scenarios (d)/(e) — see the module header.
const codeGatesFn = gatesDelayS > 0
  ? async (sandboxDir: string, extName: string): Promise<CodeGatesResult> => {
      await Bun.sleep(gatesDelayS * 1000);
      return runCodeGates(sandboxDir, extName);
    }
  : undefined;
const startupProbeFn = mcpDelayS > 0
  ? async (sandboxDir: string): Promise<StartupProbeResult> => {
      await Bun.sleep(mcpDelayS * 1000);
      return runStartupProbe(sandboxDir);
    }
  : undefined;

const result: LoopRunResult = await runLoop({
  callModel,
  configOverride: config,
  iterations: 1,
  suiteGlob,
  resumeRunId,
  ...(process.env.HLOOP_CHAOS_RUNS_DIR !== undefined ? {runsDir: process.env.HLOOP_CHAOS_RUNS_DIR} : {}),
  ...(process.env.HLOOP_CHAOS_CACHE_DIR !== undefined ? {cacheDir: process.env.HLOOP_CHAOS_CACHE_DIR} : {}),
  ...(codeGatesFn !== undefined ? {codeGatesFn} : {}),
  ...(startupProbeFn !== undefined ? {startupProbeFn} : {}),
});
console.log(`[chaos-run] result: ${JSON.stringify(result)}`);
process.exit(result.ok ? 0 : 1);
