#!/usr/bin/env bun
// Checker for ts-fix-wrong-export.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {existsSync, readFileSync} from "node:fs";
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

const target = join(ws, "pricing.ts");
if (!existsSync(target)) fail("pricing.ts missing");

let m: Record<string, unknown>;
try {
  m = await import(pathToFileURL(target).href);
} catch (e) {
  fail(`pricing.ts does not pass the behavioral checks (${(e as Error).message})`);
}

function assert(cond: boolean, label: string): void {
  if (!cond) fail(`pricing.ts does not pass the behavioral checks (${label})`);
}

assert(typeof m.formatPrice === "function", "formatPrice is not a named export");
const formatPrice = m.formatPrice as (cents: number) => string;
assert(formatPrice(1250) === "$12.50", "formatPrice(1250)");
assert(formatPrice(5) === "$0.05", "formatPrice(5)");
assert(formatPrice(0) === "$0.00", "formatPrice(0)");

// No default export needed anymore.
if (/export\s+default/.test(readFileSync(target, "utf8"))) {
  fail("pricing.ts still declares a default export");
}

console.log("PASS: pricing.ts exports formatPrice as a named export");
