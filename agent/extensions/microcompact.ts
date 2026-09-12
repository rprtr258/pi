/**
 * Microcompact Extension for Pi
 *
 * Adapts the microcompact concept from claude-code's context management system
 * into a provider-agnostic Pi extension. Works with any LLM provider (Anthropic,
 * Google, OpenAI, etc.) - no Anthropic API dependency.
 *
 * What it does:
 * 1. Before each LLM call, scans the message list for tool results
 * 2. Content-clears old tool results beyond a configurable keep count
 * 3. Replaces content with a placeholder: "[Tool result content cleared - N chars]"
 * 4. Optionally clears more aggressively when the session has been idle (>1h)
 *
 * Tool results cleared: bash, read, grep, find, ls, glob, fetch, search
 * These produce large output that becomes stale once the LLM has moved on.
 *
 * Unlike full compaction (/compact), microcompact is:
 * - Silent - no summarization API call needed
 * - Near-zero cost - just local message mutation
 * - Fine-grained - clears individual tool results, not entire turns
 * - Reversible - the placeholder preserves the tool name and call ID
 *
 * Usage:
 *   pi --extension microcompact-pi-extension.ts
 *   # or place in ~/.pi/agent/extensions/ for auto-discovery + /reload
 *
 * @module
 */

import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";

// === Configuration ==========================================================

/** Tool names whose result content is compactable (large, stale-able output). */
const COMPACTABLE_TOOL_NAMES = new Set([
  "bash",
  "read",
  "grep",
  "find",
  "ls",
  "glob",
  "fetch",
  "webfetch",
  "search",
  "websearch",
]);

/**
 * Keep this many most-recent compactable tool results per LLM turn.
 * Older results are content-cleared. Set to 0 to clear all but the current turn.
 */
const KEEP_RECENT = 5;

/**
 * When the time gap since the last assistant message exceeds this many
 * minutes, we assume the server-side prompt cache is cold and clear more
 * aggressively (only keep 1 recent result).
 */
const IDLE_GAP_THRESHOLD_MINUTES = 60;

// === State ==================================================================

/** Track which messages we've already cleared to avoid redundant operations. */
const clearedMessageKeys = new Set<string>();

function messageKey(msg: { role: string; toolCallId?: string; timestamp?: number }): string {
  return `${msg.role}:${msg.toolCallId ?? ""}:${msg.timestamp ?? 0}`;
}

/**
 * Check if the session has been idle (no recent assistant message).
 * Returns true when the gap since the last assistant message exceeds the threshold.
 */
function isIdleSession(messages: readonly { role: string; timestamp?: number }[]): boolean {
  const now = Date.now();
  // Walk backwards to find the most recent assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.timestamp) {
      const gapMs = now - m.timestamp;
      return gapMs > IDLE_GAP_THRESHOLD_MINUTES * 60_000;
    }
  }
  return false; // no assistant message found - first turn, not idle
}

/**
 * Build a human-readable size string from a tool result message.
 */
function estimateContentSize(content: unknown): string {
  if (typeof content === "string") return `${content.length} chars`;
  if (Array.isArray(content)) {
    const totalChars = content.reduce((sum: number, c: { text?: string; type?: string }) => {
      if (typeof c === "string") return sum + c.length;
      return sum + (c.text?.length ?? 0);
    }, 0);
    const blockCount = content.length;
    return `${totalChars.toLocaleString()} chars (${blockCount} block${blockCount !== 1 ? "s" : ""})`;
  }
  return "unknown size";
}

/**
 * Content-clear a tool result message in-place.
 * Replaces text/ content blocks with a placeholder showing original size.
 */
function clearToolResult(msg: { content: unknown; toolName?: string }): void {
  const size = estimateContentSize(msg.content);
  const placeholder = `[Cleared by microcompact - old tool result. Original size: ${size}]`;
  msg.content = [{ type: "text" as const, text: placeholder }];
}

/**
 * Deep-clone a message object. Simple implementation sufficient for message
 * shapes (serializable objects with content arrays).
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// === Extension ==============================================================

export default function (pi: ExtensionAPI) {
  pi.on("context", (event) => {
    const messages = event.messages;
    if (!messages || messages.length === 0) return;

    const isIdle = isIdleSession(messages);
    const keepCount = isIdle ? 1 : KEEP_RECENT;

    // Clone messages so we don't mutate the originals
    const cloned = messages.map(deepClone);

    // Collect compactable tool results with their indices
    const compactableIndices: number[] = [];
    for (let i = 0; i < cloned.length; i++) {
      const m = cloned[i];
      if (
        m.role === "toolResult" &&
        typeof (m as any).toolName === "string" &&
        COMPACTABLE_TOOL_NAMES.has((m as any).toolName)
      ) {
        compactableIndices.push(i);
      }
    }

    if (compactableIndices.length <= keepCount)
      return; // nothing to clear

    // Keep the last `keepCount` compactable results; clear the rest
    const clearIndices = new Set(compactableIndices.slice(0, compactableIndices.length - keepCount));

    let clearedCount = 0;
    for (const idx of clearIndices) {
      const msg = cloned[idx];
      const key = messageKey(msg);
      if (clearedMessageKeys.has(key))
        continue; // already cleared

      clearToolResult(msg);
      clearedMessageKeys.add(key);
      clearedCount++;
    }

    if (clearedCount > 0) {
      return { messages: cloned };
    }
  });
}
