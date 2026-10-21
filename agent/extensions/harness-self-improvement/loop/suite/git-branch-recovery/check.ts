#!/usr/bin/env bun
// Checker for git-branch-recovery.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {statSync} from "node:fs";
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

const count = git(["rev-list", "--count", "HEAD"]).trim();
if (count !== "2") fail(`expected exactly 2 commits on main, found ${count}`);

const msgs = git(["log", "--reverse", "--format=%s"]).trim();
if (msgs !== "init\nimportant fix") {
  fail(`history is '${msgs.split("\n").join("|")}', expected 'init|important fix'`);
}

const parents = git(["log", "-1", "--format=%P", "HEAD"]).trim().split(/\s+/).filter(Boolean);
if (parents.length !== 1) fail("HEAD must have exactly one parent (the init commit)");

if (gitOr(["show", "HEAD:notes.txt"], "").trim() !== "gold=42") {
  fail("notes.txt not recovered at HEAD (expected single line 'gold=42')");
}
if (gitOr(["show", "HEAD:README.md"], "").trim() !== "project") fail("README.md content changed");

if (git(["status", "--porcelain", "--untracked-files=no"]).trim() !== "") {
  fail("working tree is not clean relative to HEAD");
}

console.log("PASS: lost commit recovered onto main");
