#!/usr/bin/env bun
// Checker for git-rebase-fix.
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
if (count !== "4") fail(`expected exactly 4 commits on main, found ${count}`);

const merges = git(["rev-list", "--merges", "--count", "HEAD"]).trim();
if (merges !== "0") fail("history contains merge commits");

// Messages, in order.
const actualMsgs = git(["log", "--reverse", "--format=%s"]).trim();
const expectedMsgs = "add alpha\nadd beta\nadd gamma\nadd delta";
if (actualMsgs !== expectedMsgs) {
  fail(`commit messages/order wrong; got: ${actualMsgs.split("\n").join("|")}`);
}

// No commit tree anywhere may contain the typo.
for (const c of git(["rev-list", "HEAD"]).trim().split("\n").filter(Boolean)) {
  if (gitOr(["show", `${c}:notes.txt`], "").includes("gammma")) {
    fail(`commit ${c.slice(0, 7)} still contains 'gammma' in its tree`);
  }
}

// Per-commit tree contents.
const commits = git(["log", "--reverse", "--format=%H"]).trim().split("\n");
const expectedTrees = [
  ["alpha"],
  ["alpha", "beta"],
  ["alpha", "beta", "gamma"],
  ["alpha", "beta", "gamma", "delta"],
];
for (const [i, expected] of expectedTrees.entries()) {
  const c = commits[i]!;
  for (const [j, line] of expected.entries()) {
    const lineAt = gitOr(["show", `${c}:notes.txt`], "").split("\n")[j] ?? "";
    if (lineAt.trim() !== line) fail(`notes.txt at ${c.slice(0, 7)} line ${j + 1} is not '${line}'`);
  }
}

if (git(["status", "--porcelain", "--untracked-files=no"]).trim() !== "") {
  fail("working tree is not clean relative to HEAD");
}

console.log("PASS: typo fixed inside the original commit, history rewritten cleanly");
