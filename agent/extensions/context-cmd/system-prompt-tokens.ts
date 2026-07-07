/**
 * Extension to get system prompt token count.
 * Demonstrates how to use estimateTokens() with system prompt.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { estimateTokens } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    const prompt = ctx.getSystemPrompt();
    const tokens = estimateTokens({
      role: "user",
      content: [{ type: "text", text: prompt }]
    });
    
    console.log(`System prompt tokens: ${tokens}`);
    ctx.ui.setStatus("system-tokens", `System: ${tokens} tokens`);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("system-tokens", undefined);
  });

  // Register a command to check system prompt tokens
  pi.registerCommand("system-tokens", {
    description: "Show system prompt token count",
    handler: async (_args, ctx) => {
      const prompt = ctx.getSystemPrompt();
      const tokens = estimateTokens({
        role: "user",
        content: [{ type: "text", text: prompt }]
      });
      
      ctx.ui.notify(`System prompt: ${prompt.length} chars, ~${tokens} tokens`, "info");
    }
  });
}