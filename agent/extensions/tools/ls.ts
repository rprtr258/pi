import {existsSync, readdirSync, statSync} from "fs";
import nodePath from "path";
import stripAnsi from "strip-ansi";
import {Type, type Static} from "typebox";
import {Text} from "@earendil-works/pi-tui";
import {getCapabilities, getImageDimensions, imageFallback} from "@earendil-works/pi-tui";
import {keyHint, type AgentToolResult, type Theme, type ToolDefinition} from "@earendil-works/pi-coding-agent";
import {resolveToCwd, shortenPath} from "./path-utils.ts";

// Format bytes as human-readable size.
function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KiB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
  }
}

const DEFAULT_MAX_BYTES = 50 * 1024; // 50KiB
const DEFAULT_MAX_LINES = 2000;
/**
 * Truncate content from the head (keep first N lines/bytes).
 * Suitable for file reads where you want to see the beginning.
 *
 * Never returns partial lines. If first line exceeds byte limit,
 * returns empty content with firstLineExceedsLimit=true.
 */
function truncateHead(lines: string[], options: {
  maxLines?: number,
  maxBytes?: number,
}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const totalBytes = lines.map(line => Buffer.byteLength(line, "utf-8")).reduce((a, b) => a + b, 0) + lines.length-1;
  const totalLines = lines.length;
  // Check if no truncation needed
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: lines.join("\n"),
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }
  // Check if first line alone exceeds byte limit
  const firstLineBytes = Buffer.byteLength(lines[0]!, "utf-8");
  if (firstLineBytes > maxBytes) {
    return {
      content: "",
      truncated: true,
      truncatedBy: "bytes",
      totalLines,
      totalBytes,
      outputLines: 0,
      outputBytes: 0,
      lastLinePartial: false,
      firstLineExceedsLimit: true,
      maxLines,
      maxBytes,
    };
  }
  // Collect complete lines that fit
  const outputLinesArr = [];
  let outputBytesCount = 0;
  let truncatedBy = "lines";
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i]!;
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline
    if (outputBytesCount + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    outputLinesArr.push(line);
    outputBytesCount += lineBytes;
  }
  // If we exited due to line limit
  if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
    truncatedBy = "lines";
  }
  const outputContent = outputLinesArr.join("\n");
  const finalOutputBytes = Buffer.byteLength(outputContent, "utf-8");
  return {
    content: outputContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: outputLinesArr.length,
    outputBytes: finalOutputBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
}

/**
 * Sanitize binary output for display/storage.
 * Removes characters that crash string-width or cause display issues:
 * - Control characters (except tab, newline, carriage return)
 * - Lone surrogates
 * - Unicode Format characters (crash string-width due to a bug)
 * - Characters with undefined code points
 */
function sanitizeBinaryOutput(str: string): string {
  // Use Array.from to properly iterate over code points (not code units)
  // This handles surrogate pairs correctly and catches edge cases where
  // codePointAt() might return undefined
  return Array.from(str)
    .filter(char => {
      // Filter out characters that cause string-width to crash
      // This includes:
      // - Unicode format characters
      // - Lone surrogates (already filtered by Array.from)
      // - Control chars except \t \n \r
      // - Characters with undefined code points
      const code = char.codePointAt(0);
      // Skip if code point is undefined (edge case with invalid strings)
      if (code === undefined)
          return false;
      // Allow tab, newline, carriage return
      if (code === 0x09 || code === 0x0a || code === 0x0d)
          return true;
      // Filter out control characters (0x00-0x1F, except 0x09, 0x0a, 0x0x0d)
      if (code <= 0x1f)
          return false;
      // Filter out Unicode format characters
      if (code >= 0xfff9 && code <= 0xfffb)
          return false;
      return true;
    })
    .join("");
}

const caps = getCapabilities();

function getTextOutput(result: AgentToolResult<Details>, showImages: boolean) {
  const textBlocks = result.content.filter((c) => c.type === "text");
  const imageBlocks = result.content.filter((c) => c.type === "image");
  let output = textBlocks.map(c => sanitizeBinaryOutput(stripAnsi(c.text))).join("\n");
  if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
    const imageIndicators = imageBlocks
      .map(img => {
        const mimeType = img.mimeType ?? "image/unknown";
        const dims = img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
        return imageFallback(mimeType, dims);
      })
      .join("\n");
    output = (output ? `${output}\n` : "") + imageIndicators;
  }
  return output;
}

function invalidArgText(theme: Theme): string {
  return theme.fg("error", "[invalid arg]");
}

function formatLsCall(args: Static<typeof Params>, theme: Theme): string {
  const rawPath = args?.path ?? "";
  const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
  const limit = args?.limit;
  const invalidArg = invalidArgText(theme);
  let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${path === null ? invalidArg : theme.fg("accent", path)}`;
  if (limit !== undefined) {
    text += theme.fg("toolOutput", ` (limit ${limit})`);
  }
  return text;
}

function formatLsResult(result: AgentToolResult<Details>, options: {
  expanded: boolean,
}, theme: Theme, showImages: boolean) {
  const output = getTextOutput(result, showImages).trim();
  let text = "";
  if (output) {
    const lines = output.split("\n");
    const maxLines = options.expanded ? lines.length : 20;
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;
    text += `\n${displayLines.map(line => theme.fg("toolOutput", line)).join("\n")}`;
    if (remaining > 0) {
      text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
    }
  }
  const entryLimit = result.details?.entryLimitReached;
  const truncation = result.details?.truncation;
  if (entryLimit || truncation?.truncated) {
    const warnings = [];
    if (entryLimit)
      warnings.push(`${entryLimit} entries limit`);
    if (truncation?.truncated)
      warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
    text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
  }
  return text;
}

const DEFAULT_LIMIT = 500;
const Params = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)." })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});
type Details = {
  entryLimitReached?: number,
  truncation?: ReturnType<typeof truncateHead>,
};

const ops = {
  exists: existsSync,
  stat: statSync,
  readdir: readdirSync,
};

export default {
  name: "ls",
  label: "ls",
  description: [
    "List directory contents.",
    "Dot (.) means current directory and is preferred.",
    "Returns entries sorted alphabetically, with '/' suffix for directories.",
    "Includes dotfiles.",
    `Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
  ].join(" "),
  promptSnippet: "List directory contents",
  parameters: Params,
  async execute(_toolCallId, { path, limit }, signal, _onUpdate, ctx): Promise<AgentToolResult<Details>> {
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }
    const onAbort = () => {throw new Error("Operation aborted")};
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const dirPath = resolveToCwd(path || ".", ctx.cwd);
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      if (!ops.exists(dirPath)) {
        throw new Error(`Path not found: ${dirPath}`);
      }

      const stat = ops.stat(dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${dirPath}`);
      }

      const entries = ops.readdir(dirPath);
      // Sort alphabetically, case-insensitive.
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      // Format entries with directory indicators.
      const results = entries.slice(0, effectiveLimit).map(entry => {
        const fullPath = nodePath.join(dirPath, entry);
        const suffix = ops.stat(fullPath).isDirectory() ? "/" : "";
        return entry + suffix;
      });

      signal?.removeEventListener("abort", onAbort);
      if (results.length === 0) {
        return { content: [{ type: "text", text: "(empty directory)" }], details: {} };
      }

      // Apply byte truncation. There is no separate line limit because entry count is already capped.
      const truncation = truncateHead(results, { maxLines: Number.MAX_SAFE_INTEGER });

      const details: Details = {};
      // Build actionable notices for truncation and entry limits.
      const notices = [];
      if (entries.length >= effectiveLimit) {
        notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more.`);
        details.entryLimitReached = effectiveLimit;
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached.`);
        details.truncation = truncation;
      }

      let output = truncation.content;
      if (notices.length > 0) {
        output += `\n\n[${notices.join(" ")}]`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: details,
      };
    }
    catch (e) {
      signal?.removeEventListener("abort", onAbort);
      throw e;
    }
  },
  renderCall(args, theme, context) {
    const text = context.lastComponent as Text ?? new Text("", 0, 0);
    text.setText(formatLsCall(args, theme));
    return text;
  },
  renderResult(result, options, theme, context) {
    const text = context.lastComponent as Text ?? new Text("", 0, 0);
    text.setText(formatLsResult(result, options, theme, context.showImages));
    return text;
  },
} as ToolDefinition<typeof Params, Details>;
