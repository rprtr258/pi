#!/usr/bin/env bun
// Checker for ts-fix-unawaited-promise.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {existsSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

const target = join(ws, "fetch-total.ts");
if (!existsSync(target)) fail("fetch-total.ts missing");

let m: Record<string, unknown>;
try {
  m = await import(pathToFileURL(target).href);
} catch (e) {
  fail(`fetch-total.ts does not pass the behavioral checks (${(e as Error).message})`);
}

function assert(cond: boolean, label: string): void {
  if (!cond) fail(`fetch-total.ts does not pass the behavioral checks (${label})`);
}

assert(typeof m.totalCents === "function", "totalCents is not exported");
const p = (m.totalCents as () => unknown)();
assert(p instanceof Promise, "totalCents() must return a Promise");
let total: unknown;
try {
  total = await p;
} catch {
  fail("totalCents() must resolve to 1150");
}
assert(total === 1150, "totalCents() must resolve to 1150");

console.log("PASS: totalCents resolves to the correct total");
