#!/usr/bin/env bun
import { join } from "node:path";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path not provided as argv[2]");
  process.exit(1);
}

const limits: Record<string, number> = {
  pmList: 20_000,
  registryMeta: 15_000,
  install: 60_000,
  typecheck: 60_000,
};

let src: string;
try {
  src = await Bun.file(join(ws, "index.ts")).text();
} catch (e) {
  console.log(`FAIL: cannot read index.ts: ${e}`);
  process.exit(1);
}

const values: Record<string, number> = {};
for (const key of Object.keys(limits)) {
  const m = src.match(new RegExp(`${key}\\s*:\\s*([0-9][0-9_]*)`));
  if (!m) {
    console.log(`FAIL: TIMEOUTS.${key} entry not found in index.ts (constant names must be kept)`);
    process.exit(1);
  }
  values[key] = Number(m[1].replace(/_/g, ""));
}

for (const [key, limit] of Object.entries(limits)) {
  const v = values[key];
  if (!(v > 0)) {
    console.log(`FAIL: TIMEOUTS.${key} must be a positive number of ms, got ${v}`);
    process.exit(1);
  }
  if (v > limit) {
    console.log(`FAIL: TIMEOUTS.${key} is ${v}ms, must be <= ${limit}ms`);
    process.exit(1);
  }
}

const dm = src.match(/DEFAULT_TIMEOUT\s*(?::\s*number\s*)?=\s*([0-9][0-9_]*)/);
if (!dm) {
  console.log("FAIL: DEFAULT_TIMEOUT definition not found in index.ts");
  process.exit(1);
}
const dv = Number(dm[1].replace(/_/g, ""));
if (!(dv > 0)) {
  console.log(`FAIL: DEFAULT_TIMEOUT must be a positive number of ms, got ${dv}`);
  process.exit(1);
}
if (dv > 60_000) {
  console.log(`FAIL: DEFAULT_TIMEOUT is ${dv}ms, must be <= 60000ms`);
  process.exit(1);
}

try {
  await new Bun.Transpiler({ loader: "ts" }).transform(src);
} catch (e) {
  console.log(`FAIL: index.ts no longer parses as valid TypeScript: ${e}`);
  process.exit(1);
}

console.log("PASS: all timeouts (including DEFAULT_TIMEOUT) are within limits and index.ts is still valid TypeScript");
