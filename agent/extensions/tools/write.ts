/**
 * Write Tool Override - Prevents overwriting existing files
 *
 * Overrides the built-in `write` tool to check whether the target file
 * already exists. If it does, the tool refuses and advises the model
 * to use `edit` or `hashline-edit` instead. If the file does not exist,
 * it writes the file as usual.
 *
 * This prevents accidental data loss from blind overwrites.
 */
import {existsSync} from "fs";
import {mkdir, writeFile} from "fs/promises";
import {dirname} from "path";
import {Type} from "@sinclair/typebox";
import type {AgentToolResult, ToolDefinition} from "@earendil-works/pi-coding-agent";
import {resolveToCwd, shortenPath} from "./path-utils.ts";

const Params = Type.Object({
  path: Type.String({ description: "Path to the file to write" }),
  content: Type.String({ description: "Content to write to the file" }),
});

async function execute(filePath: string, content: string): Promise<string> {
  if (existsSync(filePath)) {
    // TODO: also prohibit files from .gitignore, .gitattributes
    const short = shortenPath(filePath);
    throw new Error(`File already exists: "${short}".\nUse the \`edit\` tool to make precise changes to existing content, or \`hashline-edit\` for line-anchored edits.`);
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return `File written: ${shortenPath(filePath)}`;
}

export default {
  name: "write",
  label: "write (safe)",
  description: [
    "Create file with the given content.",
    "If the file already exists, use edit or hashline-edit instead.",
    "Automatically creates parent directories if they do not exist.",
  ].join(" "),
  parameters: Params,
  async execute(_toolCallId, {path: filePath, content}, _signal, _onUpdate, ctx): Promise<AgentToolResult<void>> {
    const result = await execute(resolveToCwd(filePath, ctx.cwd), content);
    return {content: [{type: "text", text: result}], details: void(0)};
  },
} as ToolDefinition<typeof Params, void>;
