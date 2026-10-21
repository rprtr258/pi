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
import {existsSync, readFileSync} from "node:fs";
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
type AssistantMessageLike = {
  content: Array<{type: string, text?: string}>,
  stopReason: string,
  errorMessage?: string,
};

/**
 * Minimal structural view of ctx.modelRegistry on the RUNNING pi (1.3.0).
 * `streamSimple(model, {systemPrompt, messages}, {temperature, maxTokens})` and
 * `find(provider, modelId)` exist on pi >= 1.x (docs/extensions.md), but the
 * types resolved at compile time come from the stale 0.80.3 package pinned in
 * extensions/node_modules, which predates them — hence the cast, not a type
 * error. Remove this type alias once that pin is upgraded to >= 1.3.
 */
type SimpleStreamRegistryView = {
  find(provider: string, modelId: string): unknown,
  streamSimple(
    model: unknown,
    context: {systemPrompt?: string, messages: Array<{role: "user", content: string, timestamp: number}>},
    options?: {temperature?: number, maxTokens?: number},
  ): {result(): Promise<AssistantMessageLike>},
};

/**
 * Real-model callModel adapter: binds the pure proposer core to the session's
 * model via ctx.modelRegistry.streamSimple. Signature per pi-ai:
 *   streamSimple(model, {systemPrompt, messages}, {temperature, maxTokens})
 *     -> AssistantMessageEventStream; .result() resolves the AssistantMessage.
 * Model pick: the session's current model, else the captured defaultProvider/
 * defaultModel from settings.json (same capture stage.ts uses for nested runs).
 */
async function callModelViaRegistry(ctx: ExtensionCommandContext, system: string, user: string, options?: {temperature?: number, maxTokens?: number}): Promise<string> {
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
    .filter((c): c is {type: "text", text: string} => c.type === "text" && typeof c.text === "string")
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
      const runDir = join(extensionRoot, "runs", fixture);
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
        const findingsCandidates = [join(extensionRoot, "harness-findings.md"), join(realPiAgentDir(), "harness-findings.md")];
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

export default function (pi: ExtensionAPI) {
  registerHloopPropose(pi);

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
