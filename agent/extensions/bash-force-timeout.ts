/**
 * Bash Force Timeout Extension
 *
 * Forces a timeout on every bash tool call: if the call does not specify
 * `timeout`, defaults it to 3 minutes (180 seconds). Calls that provide
 * their own timeout keep it (the tool itself rejects invalid values).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 3 * 60;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") {
      return undefined;
    }

    const input = event.input as { command: string, timeout?: number };
    if (input.timeout === undefined) {
      input.timeout = DEFAULT_TIMEOUT_SECONDS;
    }

    return undefined;
  });
}
