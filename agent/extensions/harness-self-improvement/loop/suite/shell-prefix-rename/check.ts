#!/usr/bin/env bun
// Checker for shell-prefix-rename.
// $1 = workspace path; read-only for this script. Exit 0 = pass, non-zero = fail.
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: workspace path argument missing");
  process.exit(1);
}
const docs = join(ws, "docs");

function fail(msg: string): never {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

let docsExists = false;
try {
  docsExists = statSync(docs).isDirectory();
} catch {
  docsExists = false;
}
if (!docsExists) fail("docs/ directory missing");

// Exact final file set (robust to nothing else: only docs/ is asserted on).
// `ls` semantics: hidden files are not listed; names come back sorted.
const expectedSet = ["01-a.txt", "02-b.txt", "03-c.txt"];
const actualSet = readdirSync(docs).filter((f) => !f.startsWith(".")).sort();
if (actualSet.join("\n") !== expectedSet.join("\n")) {
  fail(`docs/ contains wrong files; got: ${actualSet.join("|")}`);
}

// Old names must be gone.
for (const old of ["a.txt", "b.txt", "c.txt"]) {
  if (existsSync(join(docs, old))) fail(`old file ${old} still exists in docs/`);
}

// Contents preserved.
if (readFileSync(join(docs, "01-a.txt"), "utf8").trim() !== "content A") fail("01-a.txt content wrong");
if (readFileSync(join(docs, "02-b.txt"), "utf8").trim() !== "content B") fail("02-b.txt content wrong");
if (readFileSync(join(docs, "03-c.txt"), "utf8").trim() !== "content C") fail("03-c.txt content wrong");

console.log("PASS: files renamed with zero-padded prefixes, contents preserved");
