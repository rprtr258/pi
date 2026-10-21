#!/usr/bin/env bun
// Checker for smoke-echo-file.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

const target = join(ws, "hello.txt");
if (!existsSync(target)) fail("hello.txt not found in workspace");

const content = readFileSync(target, "utf8");
// Same semantics as the former `grep -qx 'hello harness'`: a full line must
// match exactly (a trailing newline is fine).
if (!content.split("\n").includes("hello harness")) {
  fail(`hello.txt does not contain exactly the line 'hello harness'; content:\n${content}`);
}

console.log("PASS: hello.txt contains exactly 'hello harness'");
