#!/usr/bin/env bun
// Checker for jq-config-merge.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

// Canonical form like `jq -Sc`: compact, object keys recursively sorted.
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
}

function readJson(name: string): unknown {
  try {
    return JSON.parse(readFileSync(join(ws, name), "utf8"));
  } catch {
    fail(`${name} is not valid JSON`);
  }
}

// 1. Inputs must match the prompt verbatim.
const expectedBase = {feature: {cache: {ttl: 60}}, server: {host: "localhost", port: 8080, tls: false}, tags: ["a", "b"]};
if (stable(readJson("base.json")) !== stable(expectedBase)) fail("base.json does not match the prompt");

const expectedPatch = {feature: {beta: true, cache: {ttl: 120}}, server: {port: 9090}, tags: ["x"]};
if (stable(readJson("patch.json")) !== stable(expectedPatch)) fail("patch.json does not match the prompt");

// 2. Script exists, is executable, uses jq.
if (!existsSync(join(ws, "merge.sh"))) fail("merge.sh missing");
if (!(statSync(join(ws, "merge.sh")).mode & 0o111)) fail("merge.sh is not executable");
if (!readFileSync(join(ws, "merge.sh"), "utf8").includes("jq")) fail("merge.sh does not use jq");

// 3. Run the merge and compare normalized output (whitespace/order tolerant).
try {
  execFileSync(join(ws, "merge.sh"), [], {cwd: ws, stdio: ["ignore", "pipe", "pipe"]});
} catch (e) {
  const stderr = ((e as {stderr?: Buffer}).stderr ?? "").toString().trim();
  fail(stderr ? `merge.sh exited non-zero: ${stderr.split("\n").slice(-3).join("; ")}` : "merge.sh exited non-zero");
}
if (!existsSync(join(ws, "merged.json"))) fail("merged.json was not created");

const expectedMerged = {feature: {beta: true, cache: {ttl: 120}}, server: {host: "localhost", port: 9090, tls: false}, tags: ["x"]};
const merged = readJson("merged.json");
if (stable(merged) !== stable(expectedMerged)) {
  fail(`merged.json content wrong; got: ${JSON.stringify(merged)}`);
}

console.log("PASS: deep merge correct, patch values win");
