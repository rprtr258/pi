/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777
 * Exception: rm -rf where every target is under /tmp/ is allowed without asking.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const rmRfPattern = /\brm\s+(-rf?|--recursive)/i;
  const dangerousPatterns = [
    rmRfPattern,
    /\bsudo\b/i,
    /\b(chmod|chown)\b.*777/i,
    /\bgit\s+(add|am|apply|archive|bisect|branch|checkout|cherry-pick|clean|clone|commit|config|merge|mv|notes|pull|push|rebase|reflog|remote|reset|restore|revert|rm|stash|submodule|switch|tag|update-ref).*/i,
  ];

  // True when the command contains rm (recursively) and every target path
  // lies under /tmp/ — those are auto-allowed. Quoted paths with spaces or
  // paths inside /tmp symlinks cannot be verified here and will still prompt.
  function isTmpOnlyRm(command: string): boolean {
    let sawRm = false;
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
      const tokens = segment.trim().split(/\s+/).map(t => t.replace(/^["']|["']$/g, ""));
      if (tokens[0] !== "rm") continue;
      sawRm = true;
      for (const token of tokens.slice(1)) {
        if (token.startsWith("-")) continue; // flags
        if (!token.startsWith("/tmp/")) return false;
        const rest = token.slice("/tmp/".length);
        if (!rest || rest.split("/").includes("..")) return false;
      }
    }
    return sawRm;
  }

  const HIGHLIGHT = "\x1b[1;31m"; // bold red
  const RESET = "\x1b[0m";

  function highlightMatches(command: string): string {
    // Collect non-empty match ranges from all patterns, then merge overlaps
    const ranges: Array<[number, number]> = [];
    for (const pattern of dangerousPatterns) {
      const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = global.exec(command)) !== null) {
        if (m[0]) ranges.push([m.index, m.index + m[0].length]);
        if (m.index === global.lastIndex) global.lastIndex++;
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);

    let out = "";
    let pos = 0;
    for (const [start, end] of ranges) {
      if (start < pos) continue; // covered by an earlier range
      out += command.slice(pos, start) + HIGHLIGHT + command.slice(start, end) + RESET;
      pos = end;
    }
    return out + command.slice(pos);
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash")
      return undefined;

    const command = event.input.command as string;
    const isDangerous = dangerousPatterns.some(
      p => p.test(command) && !(p === rmRfPattern && isTmpOnlyRm(command)),
    );

    if (!isDangerous) {
      return undefined;
    }

    if (!ctx.hasUI) {
      // In non-interactive mode, block by default
      return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
    }

    const choice = await ctx.ui.select(`⚠️ Dangerous command:

  ${highlightMatches(command)}

Allow?`, ["Yes", "No"]);
    if (choice !== "Yes") {
      return { block: true, reason: "Blocked by user" };
    }

    return undefined;
  });
}
