/**
 * Harness — recurring agent-harness improvement cycle trigger.
 *
 * /harness injects the cycle instructions (analyze -> plan -> confirm) as a
 * user message. The process definition lives in PLAN.md; this extension is
 * only the trigger plus the findings-annotation tool used by the Confirm step.
 * Manually triggered, never automatic.
 */
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {Type} from "@earendil-works/pi-ai";

const CYCLE_PROMPT = `Run one agent harness improvement cycle.

Read PLAN.md first — it defines scope, evidence rules, and the cycle.

1. Analyze: mine session logs for inefficiencies. Start with:
   bun ~/.pi/agent/extensions/harness/stats.ts
   Then dig into the top findings with direct session inspection. Every finding needs evidence (file, count, or user quote).
2. Plan: rank concrete improvement candidates (what / why / how to verify / risk).
3. Confirm: write findings + ranked candidates to
   ~/.pi/agent/extensions/harness/harness-findings.md (findings with evidence, then
   candidates: what / why / how to verify / risk). Then call the harness_annotate_findings tool
   with that file — it opens the browser annotation UI and returns my notes and next-step marks.
   Wait — no change without my explicit per-change approval (my annotations and my reply both count).`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("harness", {
    description: "Run an agent harness improvement cycle (see PLAN.md)",
    handler: async () => {
      pi.sendUserMessage(CYCLE_PROMPT);
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
