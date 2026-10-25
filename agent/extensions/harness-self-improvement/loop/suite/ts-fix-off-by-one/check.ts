#!/usr/bin/env bun
// Checker for ts-fix-off-by-one.
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

const target = join(ws, "chunk.ts");
if (!existsSync(target)) fail("chunk.ts missing");

let m: Record<string, unknown>;
try {
  m = await import(pathToFileURL(target).href);
} catch (e) {
  fail(`chunk.ts does not pass the behavioral checks (${(e as Error).message})`);
}

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function assert(cond: boolean, label: string): void {
  if (!cond) fail(`chunk.ts does not pass the behavioral checks (${label})`);
}

assert(typeof m.chunk === "function", "chunk is not exported");
assert(eq((m.chunk as (items: unknown[], size: number) => unknown)([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]), "chunk([1,2,3,4,5],2)");
assert(eq((m.chunk as (items: unknown[], size: number) => unknown)([1, 2], 2), [[1, 2]]), "chunk([1,2],2) has no trailing empty array");
assert(eq((m.chunk as (items: unknown[], size: number) => unknown)([], 3), []), "chunk([],3)");
assert(eq((m.chunk as (items: unknown[], size: number) => unknown)(["a", "b", "c"], 5), [["a", "b", "c"]]), "chunk([a,b,c],5)");
assert(eq((m.chunk as (items: unknown[], size: number) => unknown)([1, 2, 3, 4], 2), [[1, 2], [3, 4]]), "chunk([1,2,3,4],2)");

console.log("PASS: chunk.ts fixed");
