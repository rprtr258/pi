#!/usr/bin/env bun
// Checker for jq-csv-to-json.
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

// 1. Input file must match the prompt verbatim.
const expectedCsv = "id,name,age,active\n1,Alice,30,yes\n2,Bob,25,no\n3,Cara,41,yes\n4,Dan,19,yes";
if (readFileSync(join(ws, "users.csv"), "utf8").trim() !== expectedCsv) {
  fail("users.csv does not match the prompt");
}

// 2. Script exists, is executable, uses jq.
if (!existsSync(join(ws, "convert.sh"))) fail("convert.sh missing");
if (!(statSync(join(ws, "convert.sh")).mode & 0o111)) fail("convert.sh is not executable");
if (!readFileSync(join(ws, "convert.sh"), "utf8").includes("jq")) fail("convert.sh does not use jq");

// 3. Run the converter, then compare normalized JSON (order/whitespace tolerant).
try {
  execFileSync(join(ws, "convert.sh"), [], {cwd: ws, stdio: ["ignore", "pipe", "pipe"]});
} catch (e) {
  const stderr = ((e as {stderr?: Buffer}).stderr ?? "").toString().trim();
  fail(stderr ? `convert.sh exited non-zero: ${stderr.split("\n").slice(-3).join("; ")}` : "convert.sh exited non-zero");
}
if (!existsSync(join(ws, "users.json"))) fail("users.json was not created");

const expectedJson = [
  {id: 1, name: "Alice", age: 30, active: true},
  {id: 2, name: "Bob", age: 25, active: false},
  {id: 3, name: "Cara", age: 41, active: true},
  {id: 4, name: "Dan", age: 19, active: true},
];
let rows: Array<Record<string, unknown>>;
try {
  rows = JSON.parse(readFileSync(join(ws, "users.json"), "utf8"));
} catch {
  fail("users.json is not valid JSON");
}
if (stable(rows) !== stable(expectedJson)) {
  fail(`users.json content wrong; got: ${JSON.stringify(rows)}`);
}

// 4. Types must be numbers/booleans, not strings.
for (const [row, r] of rows.entries()) {
  if (typeof r.id !== "number") fail(`id is not a number in row ${row}`);
  if (typeof r.age !== "number") fail(`age is not a number in row ${row}`);
  if (typeof r.active !== "boolean") fail(`active is not a boolean in row ${row}`);
}

console.log("PASS: users.json correctly typed and ordered");
