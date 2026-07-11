/**
 * REPLs Extension
 *
 * Allows the agent to create and interact with REPL sessions running inside tmux.
 * Provides three tools: create-repl, send, close-repl.
 * Also provides a /repls command to list active sessions.
 * Automatically cleans up all sessions on agent shutdown.
 */
import {spawnSync} from "child_process";
import {randomUUID} from "crypto";
import {Type, type Static} from "@sinclair/typebox";
import type {AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition} from "@earendil-works/pi-coding-agent";

type ReplSession = {
  tmuxName: string,
  command: string,
  lastCapture: string,
};

const sessions = new Map<string, ReplSession>();

// Safety: cleanup orphan sessions if process exits unexpectedly
let cleanupRegistered = false;
function ensureCleanup(): void {
  if (cleanupRegistered)
    return;
  cleanupRegistered = true;
  process.on("exit", () => {
    killAllSessions();
  });
}

function tmux(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("tmux", args, { encoding: "utf8", timeout: 10000 });
  return {
    stdout: (r.stdout ?? "") as string,
    stderr: (r.stderr ?? "") as string,
    status: r.status ?? -1,
  };
}

function capturePane(tmuxName: string): string {
  const r = tmux(["capture-pane", "-t", tmuxName, "-p"]);
  if (r.status !== 0)
    return "";
  return r.stdout;
}

function diffOutput(prev: string, curr: string): string {
  const prevLines = prev.split("\n");
  const currLines = curr.split("\n");
  let i = 0;
  while (i < prevLines.length && i < currLines.length && prevLines[i] === currLines[i]) {
    i++;
  }
  return currLines.slice(i).join("\n").replace(/\s+$/, "");
}

function killAllSessions(): void {
  for (const [id, s] of sessions) {
    tmux(["kill-session", "-t", s.tmuxName]);
    sessions.delete(id);
  }
}

function isSessionAlive(tmuxName: string): boolean {
  return tmux(["has-session", "-t", tmuxName]).status === 0;
}

const CreateReplParams = Type.Object({
  command: Type.String({ description: "Command to start the REPL, e.g. python3, node, bash" }),
});

async function createRepl({command}: Static<typeof CreateReplParams>): Promise<string> {
  const id = randomUUID();
  const tmuxName = `pi-repl-${id}`;

  const r = tmux(["new-session", "-d", "-s", tmuxName, command]);
  if (r.status !== 0) {
    throw new Error(`Failed to start REPL: ${r.stderr || r.stdout}`);
  }

  // Give REPL time to start
  await new Promise((r) => setTimeout(r, 800));

  if (!isSessionAlive(tmuxName)) {
    throw new Error(`REPL failed to start: "${command}" exited immediately`);
  }

  const initial = capturePane(tmuxName);
  const session: ReplSession = { tmuxName, command, lastCapture: initial };
  sessions.set(id, session);
  ensureCleanup();

  return id;
}

const toolCreate: ToolDefinition<typeof CreateReplParams, void> = {
  name: "repl_create",
  label: "Create REPL",
  description: `Create a new REPL session running inside a tmux terminal. Returns a session ID for use with the repl_send and repl_close tools.`,
  promptSnippet: "create_repl: create a REPL session (python3, node, etc.)",
  promptGuidelines: [
    "Use repl_create to start an interactive REPL (python3, node, bash, etc.) for multi-step exploration.",
    "Keep the session alive between calls using the session ID.",
    "Close REPL sessions with repl_close when done.",
  ],
  parameters: CreateReplParams,
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<void>> {
    const id = await createRepl(params);
    return { content: [{ type: "text", text: `REPL session created: ${id}\nRun: ${params.command}` }], details: void 0 };
  },
};

const SendParams = Type.Object({
  session_id: Type.String({ description: "Session ID returned by create_repl" }),
  line: Type.String({ description: "Single line of code to send to the REPL" }),
});

async function executeSend({session_id, line}: Static<typeof SendParams>): Promise<string> {
  const session = sessions.get(session_id);
  if (!session) {
    throw new Error(`REPL session not found: ${session_id}`);
  }

  // Capture before to diff
  const before = capturePane(session.tmuxName);

  // Send the line via send-keys with literal mode
  const r1 = tmux(["send-keys", "-t", session.tmuxName, "-l", line]);
  if (r1.status !== 0) {
    throw new Error(`Failed to send to REPL: ${r1.stderr || r1.stdout}`);
  }
  const r2 = tmux(["send-keys", "-t", session.tmuxName, "Enter"]);
  if (r2.status !== 0) {
    throw new Error(`Failed to send Enter to REPL: ${r2.stderr || r2.stdout}`);
  }

  // Wait for output
  await new Promise(r => setTimeout(r, 800));

  if (!isSessionAlive(session.tmuxName)) {
    sessions.delete(session_id);
    throw new Error(`REPL session ended: "${session.command}" exited`);
  }

  // Poll up to 3 times for the output to stabilize
  let after = capturePane(session.tmuxName);
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(r => setTimeout(r, 400));
    const next = capturePane(session.tmuxName);
    if (next === after)
      break;
    after = next;
  }

  const newOutput = diffOutput(before, after);
  session.lastCapture = after;
  return newOutput || "(no output)";
}

const toolSend: ToolDefinition<typeof SendParams, void> = {
  name: "repl_send",
  label: "Send to REPL",
  description: "Send a line of code to an active REPL session and return the REPL output.",
  promptSnippet: "repl_send: send a line to a REPL session",
  parameters: SendParams,
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<void>> {
    const output = await executeSend(params);
    return { content: [{ type: "text", text: output }], details: void 0 };
  },
};

const CloseReplParams = Type.Object({
  session_id: Type.String({ description: "Session ID returned by create_repl" }),
});

async function executeCloseRepl({session_id}: Static<typeof CloseReplParams>): Promise<string> {
  const session = sessions.get(session_id);
  if (!session) {
    throw new Error(`REPL session not found: ${session_id}`);
  }
  tmux(["send-keys", "-t", session.tmuxName, "C-d"]);
  await new Promise(r => setTimeout(r, 300));
  const r = tmux(["kill-session", "-t", session.tmuxName]);
  sessions.delete(session_id);
  if (r.status !== 0) {
    return `Session closed (cleanup warning: ${r.stderr || r.stdout})`;
  }
  return "REPL session closed.";
}

const toolClose: ToolDefinition<typeof CloseReplParams, void> = {
  name: "repl_close",
  label: "Close REPL",
  description: "Shut down an active REPL session and clean up its tmux terminal.",
  promptSnippet: "repl_close: close a REPL session",
  parameters: CloseReplParams,
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<void>> {
    const text = await executeCloseRepl(params);
    return { content: [{ type: "text", text }], details: void 0 };
  },
};

export default function (pi: ExtensionAPI) {
  pi.registerTool(toolCreate);
  pi.registerTool(toolSend);
  pi.registerTool(toolClose);

  pi.registerCommand("repls", {
    description: "List active REPL sessions",
    handler: async (_args, ctx: ExtensionContext) => {
      if (sessions.size === 0) {
        ctx.ui.notify("No active REPL sessions", "info");
        return;
      }
      const lines: string[] = sessions.entries().map(([id, s]) => `  ${id.slice(0, 8)}…  ${s.command}`).toArray();
      ctx.ui.notify(`Active REPLs:\n${lines.join("\n")}`, "info");
    },
  });

  // Cleanup all sessions when pi shuts down
  pi.on("session_shutdown", async () => {
    killAllSessions();
  });
}
