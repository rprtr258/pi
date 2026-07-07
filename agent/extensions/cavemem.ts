import {execFile} from "child_process";
import {randomUUID} from "crypto";
import type {ExtensionAPI} from "@mariozechner/pi-coding-agent";

function hook(name: string, data: Record<string, unknown>) {
  const child = execFile("cavemem", ["hook", "run", name, "--ide", "pi"], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin!.write(JSON.stringify(data));
  child.stdin!.end();
}

export default function (pi: ExtensionAPI) {
  const sessionId = randomUUID();
  // track tool args by callId — tool_execution_start captures, tool_execution_end reads
  const toolArgs = new Map<string, unknown>();

  pi.on("session_start", async (event, ctx) => {
    hook("session-start", {
      session_id: sessionId,
      ide: "pi",
      cwd: ctx.cwd,
      source: `pi::${event.reason}`,
    });
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    hook("session-end", {session_id: sessionId});
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    toolArgs.set(event.toolCallId, event.args ?? {});
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    const args = toolArgs.get(event.toolCallId) ?? {};
    toolArgs.delete(event.toolCallId);
    hook("post-tool-use", {
      session_id: sessionId,
      tool_name: event.toolName,
      tool_input: args,
      tool_response: typeof event.result === "string" ? event.result.slice(0, 10000) : event.result,
    });
  });

  pi.on("agent_end", async (event, _ctx) => {
    hook("stop", {
      session_id: sessionId,
      turn_summary: event.messages?.slice(-1)?.[0]?.content ?? "",
    });
  });

  pi.on("input", async (event, _ctx) => {
    if (event.source !== "interactive") return;
    hook("user-prompt-submit", {
      session_id: sessionId,
      prompt: event.text,
    });
  });
}