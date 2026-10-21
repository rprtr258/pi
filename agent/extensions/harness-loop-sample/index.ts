/**
 * harness-loop sample extension (Step 9a of the harness-self-improvement
 * loop) — the INERT exercise target for the `extensions` surface kind.
 *
 * INERTNESS CONTRACT: the tool is registered ONLY when
 * process.env.HARNESS_LOOP_SAMPLE === "1" — a variable that is never set in
 * normal sessions. Sandbox probes set it (see the harness-self-improvement
 * loop's probe.ts nestedPiEnv), so nested pi inside probe sandboxes sees the
 * tool while every interactive/headless session outside the loop does not.
 *
 * The registration function is exported for sample.test.ts (the loop's gate 3
 * runs it) and is dependency-free beyond pi's extension API, which resolves
 * from the shared extensions/node_modules via this directory's node_modules
 * symlink (the loop never runs bun install — see gates.ts).
 *
 * FRESH-CLONE CAVEAT: node_modules here is a committed SYMLINK (git mode
 * 120000) to the gitignored extensions/node_modules store — dangling on fresh
 * clones; gate 1 then rejects the sample as un-editable (fails safe).
 */
import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {Type} from "@earendil-works/pi-ai";

export const SAMPLE_TOOL_NAME = "hloop_sample_echo";
export const SAMPLE_ENV_VAR = "HARNESS_LOOP_SAMPLE";

/**
 * Register the sample echo tool. Exported for unit tests; returns true so a
 * test can assert the registration happened.
 */
export function registerSampleTool(pi: Pick<ExtensionAPI, "registerTool">): boolean {
  pi.registerTool({
    name: SAMPLE_TOOL_NAME,
    label: "Sample Echo",
    description: "harness-loop sample: echoes its `text` parameter back. Only present when HARNESS_LOOP_SAMPLE=1.",
    parameters: Type.Object({
      text: Type.String({description: "Text to echo back"}),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{type: "text", text: params.text}],
        details: {echoed: params.text},
      };
    },
  });
  return true;
}

export default function (pi: ExtensionAPI) {
  if (process.env[SAMPLE_ENV_VAR] !== "1") return;
  registerSampleTool(pi);
}
