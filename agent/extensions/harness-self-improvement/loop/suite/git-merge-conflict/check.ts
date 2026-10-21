#!/usr/bin/env bun
// Checker for git-merge-conflict.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}
const repo = join(ws, "repo");
process.env.GIT_OPTIONAL_LOCKS = "0";

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {encoding: "utf8", maxBuffer: 16 * 1024 * 1024});
}

// Like git(), but returns a fallback instead of failing (mirrors `2>/dev/null`).
function gitOr(args: string[], fallback: string): string {
  try {
    return git(args);
  } catch {
    return fallback;
  }
}

let repoExists = false;
try {
  repoExists = statSync(join(repo, ".git")).isDirectory();
} catch {
  repoExists = false;
}
if (!repoExists) fail("no git repository at repo/");

if (gitOr(["rev-parse", "--verify", "HEAD"], "") === "") fail("repository has no commits");

const parents = git(["log", "-1", "--format=%P", "HEAD"]).trim().split(/\s+/).filter(Boolean);
if (parents.length !== 2) fail(`HEAD is not a merge commit (parents: '${parents.join(" ")}')`);

const msg = git(["log", "-1", "--format=%s", "HEAD"]).trim();
if (msg !== "Merge branch 'feature/tax'") {
  fail(`merge commit message is '${msg}', expected "Merge branch 'feature/tax'"`);
}

const p1msg = git(["log", "-1", "--format=%s", "HEAD^1"]).trim();
const p2msg = git(["log", "-1", "--format=%s", "HEAD^2"]).trim();
if (p1msg !== "adjust discount") fail(`first parent of merge is '${p1msg}', expected 'adjust discount'`);
if (p2msg !== "tax update") fail(`second parent of merge is '${p2msg}', expected 'tax update'`);

let conf: string;
try {
  conf = readFileSync(join(repo, "app.conf"), "utf8");
} catch {
  fail("app.conf unreadable at repo/app.conf");
}
const confLines = conf.split("\n");
if (confLines.some((line) => /^(<{7}|={7}|>{7})/.test(line))) {
  fail("conflict markers still present in app.conf");
}

// Robust content check: every expected line present, stale resolutions absent.
for (const line of ["[server]", "port=8080", "[billing]", "discount=0.2", "vat=0.05"]) {
  if (!confLines.includes(line)) fail(`app.conf missing line: ${line}`);
}
if (confLines.some((line) => /^discount=0\.(1|15)$/.test(line))) {
  fail("app.conf still contains an unresolved discount value");
}

const subjects = git(["log", "--format=%s"]).trim().split("\n");
for (const m of ["initial config", "tax update", "adjust discount"]) {
  if (!subjects.includes(m)) fail(`history missing commit message: ${m}`);
}

if (git(["status", "--porcelain", "--untracked-files=no"]).trim() !== "") {
  fail("working tree is not clean (staged or modified files)");
}

console.log("PASS: merge commit with correctly resolved app.conf");
