#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: no workspace path given");
  process.exit(1);
}
const file = join(ws, "examples", "squares_sum.ef");
const fail = (r: string): never => {
  console.log("FAIL: " + r);
  process.exit(1);
};

if (!existsSync(file)) fail("examples/squares_sum.ef does not exist");
const src = readFileSync(file, "utf8");

// Blank out comments while preserving offsets so indices stay valid in src.
const noComments = src.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

if ((noComments.match(/\bfn\b/g) ?? []).length !== 1)
  fail("expected exactly one fn definition in the file");

const sig = /fn\s+sumSquares\s*<\s*([A-Za-z_]\w*)\s*>\s*\(\s*([A-Za-z_]\w*)\s*\)\s*\{/.exec(noComments);
if (!sig) fail("no generic signature of the form 'fn sumSquares<T>(arg) {' found (exactly one type parameter, one argument)");

if (noComments.includes(":"))
  fail("file (excluding comments) still contains ':' — type annotations are not allowed");

if (/\b(Int|Float|Num|Number|List|Array|String|Bool|Vector)\b/.test(noComments))
  fail("file mentions a concrete type name outside comments");

if (/385|17\.5/.test(src))
  fail("file hardcodes an expected result literal (385 or 17.5)");

// Extract the body of sumSquares via brace matching.
const open = src.indexOf("{", sig.index);
if (open < 0) fail("could not find opening brace of sumSquares");
let depth = 0;
let close = -1;
for (let i = open; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") {
    depth--;
    if (depth === 0) {
      close = i;
      break;
    }
  }
}
if (close < 0) fail("unbalanced braces in sumSquares");
const body = src.slice(open + 1, close);
const arg = sig[2];

if (!body.includes(arg)) fail("function body never uses its argument");
if (!/\*/.test(body)) fail("function body never multiplies — it does not compute squares");
if (/\^|<<|>>/.test(body)) fail("bit tricks are not allowed; use only numeric + and *");

const after = src.slice(close + 1).replace(/\s+/g, "");
if (!after.includes("print(sumSquares(range(1,11)))"))
  fail("missing top-level print(sumSquares(range(1, 11))) after the function");
if (!after.includes("print(sumSquares([1.5,2.5,3.0]))"))
  fail("missing top-level print(sumSquares([1.5, 2.5, 3.0])) after the function");

console.log("PASS: sumSquares is generic with exactly one type parameter, contains no type annotations, and is demonstrated on both integer and float lists");
process.exit(0);
