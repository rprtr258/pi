import {Type} from "@earendil-works/pi-ai";
import {defineTool, type ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {Bash, defineCommand, ReadWriteFs} from "just-bash";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

// pi bash-tool convention: tail truncation, whole lines, 2000 lines / 50KB
function truncateTail(text: string): string {
	let out = text;
	const lines = out.split("\n");
	if (lines.length > MAX_LINES) {
		out = lines.slice(-MAX_LINES).join("\n");
	}
	if (Buffer.byteLength(out, "utf8") > MAX_BYTES) {
		const bytes = Buffer.from(out, "utf8");
		out = bytes.subarray(bytes.length - MAX_BYTES).toString("utf8");
		const nl = out.indexOf("\n");
		if (nl !== -1)
      out = out.slice(nl + 1);
	}
	if (out === text)
    return out;
	return `${out}\n\n[output truncated to last ${MAX_LINES} lines / ${MAX_BYTES / 1024}KB]`;
}

function newBash(root: string): Bash {
  return new Bash({
    fs: new ReadWriteFs({ root }),
    cwd: "/",
    customCommands: [
      defineCommand("aboba", async (args, ctx) => {
        console.log(args);
        return {
          stdout: "OK",
          stderr: "",
          exitCode: 0,
        };
      }),
    ],
  });
}

export default function (pi: ExtensionAPI) {
	// One sandbox per project root. Shell state resets per exec; the
	// emulated filesystem is ReadWriteFs passthrough to real disk.
	const sandboxes = new Map<string, Bash>();
	function sandbox(root: string): Bash {
		let bash = sandboxes.get(root);
		if (bash === undefined) {
			bash = newBash(root);
			sandboxes.set(root, bash);
		}
		return bash;
	}

	pi.registerTool(defineTool({
    name: "bash",
    label: "bash",
    description: `Execute a script in a sandboxed bash rooted at the current project directory.
Commands run in an emulation layer: no real processes, no network, no node/python.
Real files under the project root are read AND written by the emulation.
Returns stdout and stderr, tail-truncated to last 2000 lines / 50KB (whichever is hit first).
Forces 300s timeout.`,
    parameters: Type.Object({
      command: Type.String({description: "Bash script to execute"}),
      root: Type.String({description: "Where to run the command"}),
    }),

    async execute(_toolCallId, {command, root}, signal, _onUpdate, ctx) {
      // const root = ctx.cwd || process.cwd();
      const bash = sandbox(root);

      // Combine pi's abort signal with the optional timeout.
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (signal?.aborted)
        controller.abort();
      else
        signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), 300 * 1000);

      try {
        const result = await bash.exec(command, { signal: controller.signal });

        const parts = [
          result.stdout,
          result.stderr,
        ].filter(s => s !== "");
        const output = truncateTail(parts.join("\n")) || "(no output)";

        if (result.exitCode !== 0) {
          throw new Error(`${output}\n\nCommand exited with code ${result.exitCode}`);
        }
        return { content: [{ type: "text", text: output }], details: {} };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  }));
}
