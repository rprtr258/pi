/**
 * Harness — recurring agent-harness improvement cycle trigger.
 *
 * /harness injects the cycle instructions (analyze -> plan -> confirm) as a
 * user message. The process definition lives in PLAN.md; this extension is
 * only the trigger plus the findings-annotation tool used by the Confirm step.
 * Manually triggered, never automatic.
 */
import type {ExtensionAPI, ExtensionCommandContext} from "@earendil-works/pi-coding-agent";
import {Type} from "@earendil-works/pi-ai";
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const CYCLE_PROMPT = `Run one agent harness improvement cycle.

Read PLAN.md first — it defines scope, evidence rules, and the cycle.

1. Analyze: mine session logs for inefficiencies. Start with:
   $ ./stats.ts            — enriched summary (tokens, cost, durations, response times, interruptions, git, languages, concurrency)
   $ ./stats.ts --sessions — compact per-session list; pick classification targets from it
   Keep session bytes out of your context: delegate drilling to subagents. Have subagents classify
   sampled sessions into facets (session type, outcome, satisfaction, friction[]) and write
   harness-facets.json — ./stats.ts auto-merges it and --html renders its distributions.
   Every finding needs evidence (file, count, or user quote).
2. Plan: rank concrete improvement candidates (what / why / how to verify / risk).
3. Confirm: write findings + ranked candidates to harness-findings.md (findings with evidence, then
   candidates: what / why / how to verify / risk). Optionally run ./stats.ts --html for a browsable
   report. Then call the harness_annotate_findings tool with that file — it opens the browser
   annotation UI and returns my notes and next-step marks.
   Wait — no change without my explicit per-change approval (my annotations and my reply both count).`;

// === harness-loop (S4): /hloop-propose debug command (superseded by S6 driver) ===
// Generates + validates improvement candidates against a fixture baseline run.
// Debug-only: prints candidates to the console and writes NOTHING (S5 owns
// apply + ledger bookkeeping).
import {buildLedgerDigest, buildPrompt, loadBaselineFromRunDir, propose, type BuiltPrompt} from "./loop/lib/proposer.ts";
import {extensionRoot, readLedger} from "./loop/lib/ledger.ts";
import {captureModelSettings, realPiAgentDir, snapshotReal, type ComponentSnapshot} from "./loop/lib/stage.ts";

function byteLen(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** AssistantMessage subset used here (shape per pi-ai types). */
interface AssistantMessageLike {
  content: Array<{type: string; text?: string}>;
  stopReason: string;
  errorMessage?: string;
}

/**
 * Minimal structural view of ctx.modelRegistry on the RUNNING pi (1.3.0).
 * `streamSimple(model, {systemPrompt, messages}, {temperature, maxTokens})` and
 * `find(provider, modelId)` exist on pi >= 1.x (docs/extensions.md), but the
 * types resolved at compile time come from the stale 0.80.3 package pinned in
 * extensions/node_modules, which predates them — hence the cast, not a type
 * error. Remove this interface once that pin is upgraded to >= 1.3.
 */
interface SimpleStreamRegistryView {
  find(provider: string, modelId: string): unknown;
  streamSimple(
    model: unknown,
    context: {systemPrompt?: string; messages: Array<{role: "user"; content: string; timestamp: number}>},
    options?: {temperature?: number; maxTokens?: number},
  ): {result(): Promise<AssistantMessageLike>};
}

/**
 * Real-model callModel adapter: binds the pure proposer core to the session's
 * model via ctx.modelRegistry.streamSimple. Signature per pi-ai:
 *   streamSimple(model, {systemPrompt, messages}, {temperature, maxTokens})
 *     -> AssistantMessageEventStream; .result() resolves the AssistantMessage.
 * Model pick: the session's current model, else the captured defaultProvider/
 * defaultModel from settings.json (same capture stage.ts uses for nested runs).
 */
async function callModelViaRegistry(ctx: ExtensionCommandContext, system: string, user: string, options?: {temperature?: number; maxTokens?: number}): Promise<string> {
  const registry = ctx.modelRegistry as unknown as SimpleStreamRegistryView;
  let model: unknown = ctx.model;
  if (!model) {
    const captured = captureModelSettings(realPiAgentDir());
    model = captured.defaultProvider !== undefined && captured.defaultModel !== undefined
      ? registry.find(captured.defaultProvider, captured.defaultModel)
      : undefined;
  }
  if (!model) throw new Error("no model: ctx.model is unset and the captured default model was not found in the registry");
  const stream = registry.streamSimple(
    model,
    {systemPrompt: system, messages: [{role: "user", content: user, timestamp: Date.now()}]},
    {temperature: options?.temperature, maxTokens: options?.maxTokens ?? 16384},
  );
  const message = await stream.result();
  if (message.stopReason === "error" || message.errorMessage !== undefined) {
    throw new Error(`model call failed: ${message.errorMessage ?? message.stopReason}`);
  }
  return message.content
    .filter((c): c is {type: "text"; text: string} => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("");
}

function registerHloopPropose(pi: ExtensionAPI): void {
  pi.registerCommand("hloop-propose", {
    description: "harness-loop S4 (debug): run the Proposer on a fixture baseline run; prints candidates, writes nothing",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      let fixture: string | undefined;
      let dryRun = false;
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--fixture") fixture = argv[i + 1];
        else if (argv[i] === "--dry-run") dryRun = true;
      }
      if (fixture === undefined || fixture.startsWith("-")) {
        console.error("usage: /hloop-propose --fixture <runId> [--dry-run]");
        return;
      }
      const runDir = join(extensionRoot(), "runs", fixture);
      let baseline;
      try {
        baseline = loadBaselineFromRunDir(runDir);
      } catch (err) {
        console.error(`/hloop-propose: cannot load fixture run '${fixture}': ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      let snapshot: ComponentSnapshot;
      let ledgerDigest: string[];
      let findingsPath: string | undefined;
      let harnessFindings: string | undefined;
      let prompt: BuiltPrompt;
      try {
        snapshot = snapshotReal(realPiAgentDir());
        ledgerDigest = buildLedgerDigest(readLedger());
        const findingsCandidates = [join(extensionRoot(), "harness-findings.md"), join(realPiAgentDir(), "harness-findings.md")];
        findingsPath = findingsCandidates.find((p) => existsSync(p));
        harnessFindings = findingsPath !== undefined ? readFileSync(findingsPath, "utf8") : undefined;

        // Prompt stats (cheap, deterministic) — shown in both modes.
        prompt = buildPrompt({snapshot, baseline, ledgerDigest, harnessFindings, model: ctx.model?.id});
      } catch (err) {
        console.error(`/hloop-propose: setup failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      console.log(`[hloop-propose] fixture ${fixture}: baseline ${baseline.aggregate.passCount}/${baseline.aggregate.total} pass`);
      console.log(`[hloop-propose] components: AGENTS.md ${byteLen(snapshot.agentsMd)}B, ${snapshot.skills.length} skill files in manifest, ${prompt.system.length + prompt.user.length} prompt chars total`);
      console.log(`[hloop-propose] ledger digest: ${ledgerDigest.length} rejected proposal fingerprint(s)`);
      console.log(`[hloop-propose] harness-findings: ${findingsPath ?? "(absent)"}`);
      if (dryRun) {
        console.log("[hloop-propose] --dry-run: prompt built, no model call, no proposal.");
        return;
      }

      let result;
      try {
        result = await propose({snapshot, baseline, ledgerDigest, harnessFindings, model: ctx.model?.id}, {callModel: (system, user, options) => callModelViaRegistry(ctx, system, user, options)});
      } catch (err) {
        console.error(`[hloop-propose] proposer failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      console.log(`[hloop-propose] proposal fingerprint: ${result.proposalFingerprint}`);
      if (result.repairRetried) console.log("[hloop-propose] JSON repair retry fired");
      if (result.parseError !== undefined) console.log(`[hloop-propose] parse error: ${result.parseError}`);
      if (result.rawPreview !== undefined) console.log(`[hloop-propose] raw model output preview:\n${result.rawPreview}`);
      console.log(`[hloop-propose] ${result.candidates.length} candidate(s):`);
      result.candidates.forEach((candidate, index) => {
        console.log(`== candidate ${index + 1}: ${candidate.verdict.toUpperCase()} ==`);
        console.log(`rationale: ${candidate.rationale}`);
        console.log(`edits: ${candidate.edits.length}`);
        for (const edit of candidate.edits) {
          console.log(`  - ${edit.path} (${edit.content === null ? "DELETE" : `${byteLen(edit.content)}B`})`);
        }
        console.log(`fingerprint: ${candidate.fingerprint ?? "<invalid structure>"}`);
        if (candidate.verdict === "rejected") {
          console.log("reject reasons:");
          for (const reason of candidate.reasons) console.log(`  ! ${reason}`);
        }
      });
      console.log("[hloop-propose] done — no files were written (S5 owns apply + ledger).");
    },
  });
}
// === end harness-loop (S4) ===

// === harness-loop (S6): /hloop command group — driver, budget, UX ===
// Runs the recursive optimization loop's state machine (loop/driver.ts
// runLoop) to completion INSIDE the command handler — synchronous, like
// /hloop-propose: the session blocks for the whole loop (nested pi probes +
// proposer model calls; expect minutes). Long-running by design.
import {runLoop, type LoopState} from "./loop/driver.ts";
import {loadLoopConfig, revertByRunId} from "./loop/lib/apply.ts";
import {ledgerPath} from "./loop/lib/ledger.ts"; // readLedger/extensionRoot already imported in the S4 block above

function hloopRunsDir(): string {
  return join(extensionRoot(), "runs");
}

function hloopStopFlagPath(): string {
  return join(extensionRoot(), "loop", ".stop");
}

/** The run whose state.json has the newest updatedTs, or null. */
function hloopLatestRun(): {runId: string; state: LoopState} | null {
  const runsDir = hloopRunsDir();
  if (!existsSync(runsDir)) return null;
  let best: {runId: string; state: LoopState} | null = null;
  for (const entry of readdirSync(runsDir, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const statePath = join(runsDir, entry.name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as LoopState;
      if (typeof state.updatedTs !== "string") continue;
      if (best === null || state.updatedTs > best.state.updatedTs) best = {runId: entry.name, state};
    } catch {
      // unreadable state file — not a candidate for "latest"
    }
  }
  return best;
}

async function hloopStart(argv: string[], ctx: ExtensionCommandContext): Promise<void> {
  let iterations: number | undefined;
  let suiteGlob: string | undefined;
  let maxCandidates: number | undefined;
  let resumeRunId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--iterations") iterations = Number(argv[++i]);
    else if (arg === "--suite") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        console.error(`/hloop start: --suite requires a value (a task-name glob like "smoke-*"), not another flag`);
        return;
      }
      suiteGlob = value;
    }
    else if (arg === "--max-candidates") maxCandidates = Number(argv[++i]);
    else if (arg === "--resume") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) {
        console.error(`/hloop start: --resume requires a value (a run id), not another flag`);
        return;
      }
      resumeRunId = value;
    }
    else {
      console.error(`/hloop start: unknown argument '${arg}'`);
      return;
    }
  }
  for (const [name, value] of [["--iterations", iterations], ["--max-candidates", maxCandidates]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      console.error(`/hloop start: ${name} must be an integer >= 1`);
      return;
    }
  }

  const config = loadLoopConfig();
  console.log("[hloop] COST WARNING: /hloop runs the whole loop synchronously in this handler — the session BLOCKS until it finishes (nested pi probes + proposer model calls, real tokens).");
  console.log(`[hloop] budget metric: TOKENS (cost.total is always 0 on this gateway); config budget.maxTotalTokens=${config.budget.maxTotalTokens}, budget.maxIterations=${config.budget.maxIterations}, candidates.maxPerIteration=${config.candidates.maxPerIteration}${iterations !== undefined ? ` (--iterations ${iterations} overrides maxIterations)` : ""}`);
  console.log(`[hloop] apply.dryRun is currently ${config.apply.dryRun}${config.apply.dryRun ? " — winners are NOT written to the live agent config; to enable real apply edit loop/config.json (\"apply\": {\"dryRun\": false})" : " — winners WILL be committed to the live agent config"}`);
  console.log(`[hloop] suite: ${suiteGlob ?? "<full suite>"} — the first live run should use --suite "smoke-*"`);

  try {
    const result = await runLoop({
      iterations,
      suiteGlob,
      maxCandidates,
      resumeRunId,
      callModel: (system, user, options) => callModelViaRegistry(ctx, system, user, options),
      log: (line) => console.log(line),
    });
    console.log(`[hloop] finished: status ${result.status}${result.stopReason ? ` (${result.stopReason})` : ""}, ${result.iterationsCompleted} iteration(s) completed, ${result.budgetSpent} tokens spent`);
    if (result.statePath !== null) console.log(`[hloop] state: ${result.statePath}`);
    if (!result.ok && result.stopReason !== null) console.error(`[hloop] run did not complete: ${result.stopReason}`);
  } catch (err) {
    console.error(`[hloop] runLoop failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function hloopStatus(): void {
  const runsDir = hloopRunsDir();
  const latest = hloopLatestRun();
  if (latest === null) {
    console.log("[hloop] no runs recorded (no state.json under runs/)");
  } else {
    const s = latest.state;
    console.log(`[hloop] latest run ${s.runId}: status ${s.status}${s.stopReason ? ` (${s.stopReason})` : ""}`);
    console.log(`  started ${s.startedTs}, updated ${s.updatedTs}, model ${s.model ?? "<pi default>"}, suite ${s.suiteGlob ?? "<full>"}`);
    console.log(`  budget: ${s.budgetSpent}/${s.config.maxTotalTokens} tokens; config: maxIterations ${s.config.maxIterations}, maxCandidates ${s.config.maxCandidates}, dryRun ${s.config.dryRun}`);
    for (const it of s.iterations) {
      const base = it.baseline === null ? "?" : `${it.baseline.passCount}/${it.baseline.total}${it.baseline.cached ? " (cached)" : ""}`;
      const cands = it.candidates.map((c) => `#${c.index}:${c.decision}`).join(", ") || "none";
      console.log(`  iter ${it.index} [${it.phase}] baseline ${base}${it.decision ? ` — decision: ${it.decision}` : ""}; candidates: ${cands}`);
    }
    console.log(`  state: ${join(runsDir, s.runId, "state.json")}`);
  }
  const entries = readLedger(ledgerPath()).slice(-5);
  console.log(`[hloop] last ${entries.length} ledger entr${entries.length === 1 ? "y" : "ies"}:`);
  for (const e of entries) console.log(`  ${JSON.stringify(e)}`);
}

function hloopStop(): void {
  mkdirSync(join(extensionRoot(), "loop"), {recursive: true});
  writeFileSync(hloopStopFlagPath(), `${new Date().toISOString()}\n`);
  console.log(`[hloop] stop flag created: ${hloopStopFlagPath()} — a running loop stops before its next probe/iteration and deletes the flag.`);
}

function hloopRevert(argv: string[]): void {
  const runId = argv[0];
  if (runId === undefined || runId.startsWith("-")) {
    console.error("usage: /hloop revert <runId>");
    return;
  }
  const res = revertByRunId(runId);
  if (res.ok) {
    console.log(`[hloop] reverted run ${runId}: method ${res.method}${res.sha !== undefined ? `, commit ${res.sha}` : ""}`);
  } else {
    console.error(`[hloop] revert failed for run ${runId}: ${res.error ?? "unknown error"}`);
  }
}

function hloopReport(argv: string[]): void {
  const runId = argv[0] ?? hloopLatestRun()?.runId;
  if (runId === undefined) {
    console.error("[hloop] report: no runId given and no runs recorded");
    return;
  }
  const runDir = join(hloopRunsDir(), runId);
  if (!existsSync(runDir)) {
    console.error(`[hloop] report: no run directory ${runDir}`);
    return;
  }
  const reports: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "report.md") reports.push(full);
    }
  };
  walk(runDir);
  console.log(`[hloop] report for run ${runId} (${reports.length} report.md file(s)):`);
  for (const r of reports) console.log(`  ${r}`);
  const statePath = join(runDir, "state.json");
  if (existsSync(statePath)) {
    try {
      const s = JSON.parse(readFileSync(statePath, "utf8")) as LoopState;
      for (const it of s.iterations) {
        if (it.baseline === null) continue;
        console.log(`  iter ${it.index}: baseline ${it.baseline.passCount}/${it.baseline.total} (${it.baseline.totalTokens} tokens${it.baseline.cached ? ", cached" : ""}) — ${it.decision ?? it.phase}`);
      }
      console.log(`  budget spent: ${s.budgetSpent} tokens; status ${s.status}${s.stopReason ? ` (${s.stopReason})` : ""}`);
    } catch {
      // state unreadable — reports above still listed
    }
  }
}

function registerHloop(pi: ExtensionAPI): void {
  pi.registerCommand("hloop", {
    description: "harness-loop S6: recursive optimization loop — start | status | stop | revert <runId> | report [runId]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const argv = args.trim().split(/\s+/).filter(Boolean);
      const sub = argv.shift() ?? "";
      if (sub === "start") return hloopStart(argv, ctx);
      if (sub === "status") return hloopStatus();
      if (sub === "stop") return hloopStop();
      if (sub === "revert") return hloopRevert(argv);
      if (sub === "report") return hloopReport(argv);
      console.error("usage: /hloop start [--iterations N] [--suite <glob>] [--max-candidates K] [--resume <runId>] | status | stop | revert <runId> | report [runId]");
    },
  });
}
// === end harness-loop (S6) ===

export default function (pi: ExtensionAPI) {
  registerHloopPropose(pi);
  registerHloop(pi);

  pi.registerCommand("harness", {
    description: "Run an agent harness improvement cycle (see PLAN.md)",
    handler: async () => {
      pi.sendUserMessage(CYCLE_PROMPT);
    },
  });

  pi.registerCommand("harness-report", {
    description: "Generate the harness HTML session report (./stats.ts --html)",
    handler: async () => {
      pi.sendUserMessage(
        "Generate the harness HTML report: run `./stats.ts --html` and report the output path. If harness-facets.json exists, ./stats.ts merges it automatically.",
      );
    },
  });

  // Confirm step: open the findings file in plannotator's annotation UI and
  // block until the user is done, then hand their notes back to the agent.
  pi.registerTool({
    name: "harness_annotate_findings",
    label: "Annotate Findings",
    description: "Open a harness findings markdown file in the browser annotation UI so the user can leave notes, comments, and next-step marks. Blocks until the user finishes; returns their feedback text.",
    parameters: Type.Object({
      filePath: Type.String({description: "Path to the findings .md file"}),
    }),
    async execute(_toolCallId, params) {
      const response: any = await new Promise((resolve) => {
        pi.events.emit("plannotator:request", {
          requestId: crypto.randomUUID(),
          action: "annotate",
          payload: {filePath: params.filePath, gate: true},
          respond: resolve,
        });
      });
      if (response?.status !== "handled") {
        return {
          content: [{type: "text", text: `Plannotator unavailable: ${response?.error ?? JSON.stringify(response)}`}],
          details: {ok: false},
        };
      }
      const r = response.result ?? {};
      const text = r.feedback || (r.exit ? "(user closed the UI without notes)" : "(no notes)");
      return {
        content: [{type: "text", text}],
        details: {ok: true, approved: r.approved ?? null, exit: r.exit ?? null},
      };
    },
  });
}
