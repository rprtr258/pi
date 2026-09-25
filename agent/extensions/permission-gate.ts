/**
 * Permission Gate Extension
 *
 * Prompts for confirmation before running potentially dangerous bash commands.
 * Patterns checked: rm -rf, sudo, chmod/chown 777
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const dangerousPatterns = [
    /\brm\s+(-rf?|--recursive)/i,
    /\bsudo\b/i,
    /\b(chmod|chown)\b.*777/i,
    /\bgit\s+(add|am|apply|archive|bisect|branch|checkout|cherry-pick|clean|clone|commit|config|merge|mv|notes|pull|push|rebase|reflog|remote|reset|restore|revert|rm|stash|submodule|switch|tag|update-ref).*/i,
  ];

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
    const isDangerous = dangerousPatterns.some(p => p.test(command));

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
