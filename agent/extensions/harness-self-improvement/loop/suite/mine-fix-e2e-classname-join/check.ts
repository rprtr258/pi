#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const E2E_TEST_EXPECTED = `import { describe, expect, test } from "bun:test";
import { buildInputClass } from "../components/input";

describe("form input e2e", () => {
  test("invalid state class chain", () => {
    expect(buildInputClass({ invalid: true, disabled: false })).toBe(
      "input input--invalid",
    );
  });

  test("disabled state class chain", () => {
    expect(buildInputClass({ invalid: false, disabled: true })).toBe(
      "input is-disabled",
    );
  });

  test("combined states keep order and single spaces", () => {
    expect(buildInputClass({ invalid: true, disabled: true })).toBe(
      "input input--invalid is-disabled",
    );
  });

  test("no stray whitespace for clean state", () => {
    expect(buildInputClass({ invalid: false, disabled: false })).toBe("input");
  });
});
`;

const UNIT_TEST_EXPECTED = `import { describe, expect, test } from "bun:test";
import { cn } from "../lib/utils";

describe("cn", () => {
  test("joins with single spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  test("skips falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  test("returns empty string when nothing valid", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
`;

function fail(msg: string): never {
  console.log("FAIL: " + msg);
  process.exit(1);
}

const ws = process.argv[2];
if (!ws) {
  fail("workspace path not provided as argv[2]");
}

function normalized(p: string): string {
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n").trim();
}

// 1. Test files must be unmodified.
const e2ePath = join(ws, "renderer", "e2e", "form.e2e.test.ts");
const unitPath = join(ws, "renderer", "components", "input.test.ts");

let e2eActual: string;
let unitActual: string;
try {
  e2eActual = normalized(e2ePath);
} catch {
  fail("renderer/e2e/form.e2e.test.ts is missing");
}
try {
  unitActual = normalized(unitPath);
} catch {
  fail("renderer/components/input.test.ts is missing");
}

if (e2eActual !== E2E_TEST_EXPECTED.trim()) {
  fail("renderer/e2e/form.e2e.test.ts was modified (tests must stay untouched)");
}
if (unitActual !== UNIT_TEST_EXPECTED.trim()) {
  fail("renderer/components/input.test.ts was modified (tests must stay untouched)");
}

// 2. The e2e script must pass.
const e2eRun = spawnSync("bun", ["run", "test:e2e"], {
  cwd: ws,
  encoding: "utf8",
});
if (e2eRun.status !== 0) {
  const tail = (e2eRun.stdout + e2eRun.stderr).trim().split("\n").slice(-10).join("\n");
  fail("bun run test:e2e exited with code " + e2eRun.status + "\n" + tail);
}

// 3. The unit suite must also pass.
const unitRun = spawnSync("bun", ["test", "renderer/components/input.test.ts"], {
  cwd: ws,
  encoding: "utf8",
});
if (unitRun.status !== 0) {
  const tail = (unitRun.stdout + unitRun.stderr).trim().split("\n").slice(-10).join("\n");
  fail("bun test renderer/components/input.test.ts exited with code " + unitRun.status + "\n" + tail);
}

console.log("PASS: bun run test:e2e exits 0, unit suite passes, and all test files are unmodified");
