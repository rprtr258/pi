#!/usr/bin/env bun
// Checker for jq-log-extract.
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

// 1. Input file must match the prompt verbatim (probe must not game the data).
const expectedLog = [
  '{"ts":"2024-03-01T10:00:00Z","level":"INFO","msg":"boot"}',
  '{"ts":"2024-03-01T10:00:05Z","level":"ERROR","msg":"db connection refused"}',
  '{"ts":"2024-03-01T10:00:10Z","level":"WARN","msg":"retry 1"}',
  '{"ts":"2024-03-01T10:00:15Z","level":"INFO","msg":"db connected"}',
  '{"ts":"2024-03-01T10:01:00Z","level":"ERROR","msg":"timeout on /api/users"}',
  '{"ts":"2024-03-01T10:01:30Z","level":"ERROR","msg":"cache miss storm"}',
  "not-json-at-all",
  '{"ts":"2024-03-01T10:02:00Z","level":"WARN","msg":"slow query"}',
  '{"ts":"2024-03-01T10:02:30Z","level":"INFO","msg":"shutdown"}',
  '{"ts":"2024-03-01T09:59:00Z","level":"ERROR","msg":"clock skew detected"}',
].join("\n");
if (readFileSync(join(ws, "app.log"), "utf8").trim() !== expectedLog) {
  fail("app.log does not match the prompt data");
}

// 2. Script exists, is executable, and uses jq.
if (!existsSync(join(ws, "extract-errors.sh"))) fail("extract-errors.sh missing");
if (!(statSync(join(ws, "extract-errors.sh")).mode & 0o111)) fail("extract-errors.sh is not executable");
if (!readFileSync(join(ws, "extract-errors.sh"), "utf8").includes("jq")) fail("extract-errors.sh does not use jq");

// 3. Run it and compare exact expected output (sorted by ts ascending).
const expectedOut = "clock skew detected\ndb connection refused\ntimeout on /api/users\ncache miss storm";
let actualOut: string;
try {
  actualOut = execFileSync(join(ws, "extract-errors.sh"), [], {cwd: ws, encoding: "utf8"});
} catch (e) {
  const stderr = ((e as {stderr?: Buffer}).stderr ?? "").toString().trim();
  fail(stderr ? `extract-errors.sh exited non-zero: ${stderr.split("\n").slice(-3).join("; ")}` : "extract-errors.sh exited non-zero");
}
if (actualOut.trim() !== expectedOut) {
  fail(`output wrong; got: ${actualOut.trim().split("\n").join("|")}`);
}

console.log("PASS: correct ERROR messages in timestamp order");
