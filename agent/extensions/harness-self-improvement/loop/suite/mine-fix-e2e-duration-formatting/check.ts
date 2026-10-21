#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ws = path.resolve(process.argv[2] ?? ".");
const fail = (msg: string): never => {
  console.log("FAIL: " + msg);
  process.exit(1);
};

const E2E_TEST_PATH = "renderer/e2e/utils.e2e.test.ts";
const UNIT_TEST_PATH = "renderer/components/input.test.ts";

const E2E_TEST_ORIGINAL = [
  'import { describe, test, expect } from "bun:test";',
  'import { formatDuration } from "../lib/utils";',
  "",
  "// E2E coverage for the session timer shown in the input bar.",
  "// Do not change expectations here; fix the implementation instead.",
  'describe("formatDuration (e2e)", () => {',
  '  test("renders zero as 0:00", () => {',
  '    expect(formatDuration(0)).toBe("0:00");',
  "  });",
  "",
  '  test("rounds to the nearest second", () => {',
  '    expect(formatDuration(500)).toBe("0:01");',
  '    expect(formatDuration(65_500)).toBe("1:06");',
  "  });",
  "",
  '  test("does not lose a second at minute boundaries", () => {',
  '    expect(formatDuration(3_599_900)).toBe("60:00");',
  "  });",
  "",
  '  test("keeps seconds zero-padded", () => {',
  '    expect(formatDuration(65_000)).toBe("1:05");',
  "  });",
  "});",
  "",
].join("\n");

const UNIT_TEST_ORIGINAL = [
  'import { describe, test, expect } from "bun:test";',
  'import { clampInput } from "../lib/utils";',
  "",
  'describe("clampInput", () => {',
  '  test("truncates values longer than max", () => {',
  '    expect(clampInput("hello", 3)).toBe("hel");',
  "  });",
  "",
  '  test("leaves short values untouched", () => {',
  '    expect(clampInput("hi", 5)).toBe("hi");',
  '    expect(clampInput("", 3)).toBe("");',
  "  });",
  "});",
  "",
].join("\n");

const trimTrailing = (s: string) => s.replace(/\s+$/, "");

for (const [rel, original] of [
  [E2E_TEST_PATH, E2E_TEST_ORIGINAL],
  [UNIT_TEST_PATH, UNIT_TEST_ORIGINAL],
] as const) {
  const p = path.join(ws, rel);
  if (!existsSync(p)) fail("required test file " + rel + " is missing");
  const actual = readFileSync(p, "utf8");
  if (trimTrailing(actual) !== trimTrailing(original)) {
    fail(rel + " was modified — fix the implementation, not the tests");
  }
}

const pkgPath = path.join(ws, "package.json");
if (!existsSync(pkgPath)) fail("package.json is missing");
let script: unknown;
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  script = pkg?.scripts?.["test:e2e"];
} catch {
  fail("package.json is not valid JSON");
}
if (typeof script !== "string" || !script.includes("bun test")) {
  fail("the test:e2e script in package.json must still run the bun test suite");
}

const run = spawnSync("bun", ["run", "test:e2e"], {
  cwd: ws,
  encoding: "utf8",
  timeout: 25_000,
});
if (run.error) fail("could not execute 'bun run test:e2e': " + run.error.message);
const output = (run.stdout ?? "") + (run.stderr ?? "");
if (run.status !== 0) {
  fail(
    "'bun run test:e2e' exited with code " +
      run.status +
      "\n--- output tail ---\n" +
      output.slice(-2000),
  );
}

console.log(
  "PASS: 'bun run test:e2e' exits 0 with all test files and the test:e2e script unmodified",
);
