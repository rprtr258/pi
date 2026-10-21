#!/usr/bin/env bun
/**
 * Unit tests for the probe runner's non-model paths: process-group kill
 * (timeout path), JSONL event parsing, and frontmatter stripping.
 *
 *   bun test loop/lib/probe.test.ts
 */
import {spawn} from "node:child_process";
import {describe, expect, test} from "bun:test";
import {killProcessGroup, parseJsonlEvents, redact, stripFrontmatter} from "./probe.ts";

/** True when the process group is still alive. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("killProcessGroup (timeout path)", () => {
  test("kills the child and its grandchildren", async () => {
    // The shell puts two sleeps in the same process group as grandchildren.
    const child = spawn("bash", ["-c", "sleep 60 & sleep 60 & wait"], {detached: true, stdio: "ignore"});
    await Bun.sleep(300); // let the shell fork the sleeps
    expect(groupAlive(child.pid!)).toBe(true);
    expect(killProcessGroup(child.pid!)).toBe(true);
    // The whole group (child + grandchildren) must be gone shortly after.
    await Bun.sleep(300);
    expect(groupAlive(child.pid!)).toBe(false);
  });

  test("returns false for a dead/nonexistent pid instead of throwing", () => {
    expect(killProcessGroup(999_999_999)).toBe(false);
  });
});

describe("parseJsonlEvents", () => {
  test("extracts assistant text and the LAST message_update usage", () => {
    const msg = (text: string, usage: object) => ({role: "assistant", content: [{type: "text", text}], usage});
    const raw = [
      {type: "session_header", id: "x"},
      // Streaming: cumulative message_update events, then one message_end per message.
      {type: "message_update", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_update", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_end", message: msg("line one", {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}})},
      {type: "message_update", message: msg("line two", {input: 20, output: 9, cacheRead: 1, cacheWrite: 0, totalTokens: 30, cost: {input: 2, output: 4, cacheRead: 0.1, cacheWrite: 0, total: 6.1}})},
      {type: "message_end", message: msg("line two", {input: 20, output: 9, cacheRead: 1, cacheWrite: 0, totalTokens: 30, cost: {input: 2, output: 4, cacheRead: 0.1, cacheWrite: 0, total: 6.1}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed).toEqual({
      trajectoryLines: ["line one", "line two"],
      usage: {
        totalTokens: 30,
        cacheRead: 1,
        cacheWrite: 0,
        cost: {
          cacheRead: 0.1,
          cacheWrite: 0,
          input: 2,
          output: 4,
          total: 6.1,
        },
        input: 20,
        output: 9,
      },
    });
  });

  test("falls back to message_end usage and tolerates junk lines", () => {
    const raw = [
      "not json at all",
      JSON.stringify({type: "message_end", message: {role: "assistant", content: [{type: "text", text: "done"}], usage: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}}}}),
    ].join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.trajectoryLines).toEqual(["done"]);
    expect(parsed.usage!.totalTokens).toBe(2);
  });

  test("ignores non-assistant messages and returns null usage when absent", () => {
    const parsed = parseJsonlEvents(JSON.stringify({type: "message_update", message: {role: "user", content: "hi"}}));
    expect(parsed.trajectoryLines).toEqual([]);
    expect(parsed.usage).toBeNull();
  });

  test("skips a message_end whose message is JSON null instead of throwing", () => {
    const raw = [
      {type: "message_end", message: null},
      {type: "message_update", message: null},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.trajectoryLines).toEqual([]);
    expect(parsed.usage).toBeNull();
  });

  test("a later message_end usage overwrites an earlier message_update usage", () => {
    const msg = (usage: object) => ({role: "assistant", content: [{type: "text", text: "hi"}], usage});
    const raw = [
      {type: "message_update", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
      {type: "message_end", message: msg({input: 2, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: {input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.usage!.totalTokens).toBe(20);
  });

  test("in fallback-only streams the LAST message_end usage wins", () => {
    const msg = (usage: object) => ({role: "assistant", content: [{type: "text", text: "hi"}], usage});
    const raw = [
      {type: "message_end", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
      {type: "message_end", message: msg({input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 22, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}})},
    ].map(j => JSON.stringify(j)).join("\n");
    const parsed = parseJsonlEvents(raw);
    expect(parsed.usage!.totalTokens).toBe(22);
  });
});

describe("redact", () => {
  test("redacts sk- style API keys", () => {
    expect(redact("error with key sk-abc123DEF_-xyz456 at position 0")).toBe("error with key sk-*** at position 0");
  });

  test("redacts bearer tokens, case-insensitively", () => {
    expect(redact("Authorization: Bearer eyJhbGciOi.abc-123_x")).toBe("Authorization: Bearer ***");
  });

  test("redacts api_key assignments but keeps the key reference", () => {
    expect(redact('api_key = "supersecret123"')).toBe('api_key = "***"');
    expect(redact("apiKey: hunter2value")).toBe("apiKey: ***");
    expect(redact("api-key=abc123def")).toBe("api-key=***");
  });

  test("leaves ordinary text untouched", () => {
    expect(redact("plain stderr output with no secrets")).toBe("plain stderr output with no secrets");
  });
});

describe("stripFrontmatter", () => {
  test("strips the frontmatter and keeps the body", () => {
    const text = "---\nname: x\ntimeout_s: 10\n---\nDo the thing.\n";
    expect(stripFrontmatter(text)).toBe("Do the thing.");
  });

  test("returns the text untouched without frontmatter", () => {
    expect(stripFrontmatter("just a prompt")).toBe("just a prompt");
  });
});
