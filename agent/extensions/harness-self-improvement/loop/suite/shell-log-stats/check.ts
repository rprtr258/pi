#!/usr/bin/env bun
// Checker for shell-log-stats.
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

const expectedLog = "200 /home\n404 /missing\n200 /about\n500 /broken\n200 /home\n404 /missing\n301 /old\n200 /contact";
if (readFileSync(join(ws, "events.log"), "utf8").trim() !== expectedLog)
  fail("events.log does not match the prompt");

if (!existsSync(join(ws, "stats.sh")))
  fail("stats.sh missing");
if (!(statSync(join(ws, "stats.sh")).mode & 0o111))
  fail("stats.sh is not executable");

const expectedOut = "200 4\n301 1\n404 2\n500 1";
let actualOut: string;
try {
  actualOut = execFileSync(join(ws, "stats.sh"), [], {cwd: ws, encoding: "utf8"});
} catch (e) {
  const stderr = ((e as {stderr?: Buffer}).stderr ?? "").toString().trim();
  fail(stderr ? `stats.sh exited non-zero: ${stderr.split("\n").slice(-3).join("; ")}` : "stats.sh exited non-zero");
}
if (actualOut.trim() !== expectedOut)
  fail(`output wrong; got: ${actualOut.trim().split("\n").join("|")}`);

console.log("PASS: status counts aggregated and sorted correctly");
