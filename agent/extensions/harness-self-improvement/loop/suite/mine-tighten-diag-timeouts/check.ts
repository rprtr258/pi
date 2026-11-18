#!/usr/bin/env bun
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ws = process.argv[2];
if (!ws) {
  console.log("FAIL: no workspace path given");
  process.exit(1);
}

const diagPath = join(ws, "tools", "diag.ts");
if (!existsSync(diagPath)) {
  console.log("FAIL: tools/diag.ts does not exist");
  process.exit(1);
}

let src: string;
try {
  src = readFileSync(diagPath, "utf8");
} catch (e) {
  console.log("FAIL: could not read tools/diag.ts");
  process.exit(1);
}

function constValue(name: string): number | null {
  const m = src.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*(:\\s*number)?\\s*=\\s*(\\d+)`));
  return m ? parseInt(m[2], 10) : null;
}

const pmList = constValue("PM_LIST_TIMEOUT");
const npmView = constValue("NPM_VIEW_TIMEOUT");
const install = constValue("INSTALL_TIMEOUT");
const tsc = constValue("TSC_TIMEOUT");

const problems: string[] = [];

if (pmList === null) problems.push("PM_LIST_TIMEOUT constant missing or not a plain integer");
else if (pmList <= 0 || pmList > 20) problems.push(`PM_LIST_TIMEOUT=${pmList}, must be >0 and <=20`);

if (npmView === null) problems.push("NPM_VIEW_TIMEOUT constant missing or not a plain integer");
else if (npmView <= 0 || npmView > 20) problems.push(`NPM_VIEW_TIMEOUT=${npmView}, must be >0 and <=20`);

if (install === null) problems.push("INSTALL_TIMEOUT constant missing or not a plain integer");
else if (install < 45 || install > 90) problems.push(`INSTALL_TIMEOUT=${install}, must be >=45 and <=90 (install needs headroom)`);

if (tsc === null) problems.push("TSC_TIMEOUT constant missing or not a plain integer");
else if (tsc < 45 || tsc > 120) problems.push(`TSC_TIMEOUT=${tsc}, must be >=45 and <=120 (typecheck needs headroom)`);

// Each timeout constant must still actually be used in a run() invocation.
for (const name of ["PM_LIST_TIMEOUT", "NPM_VIEW_TIMEOUT", "INSTALL_TIMEOUT", "TSC_TIMEOUT"]) {
  const uses = (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
  if (uses < 2) problems.push(`${name} is declared but no longer passed to a run() call`);
}

// The run helper must still invoke the external `timeout` command.
if (!/["'`]timeout["'`]/.test(src)) {
  problems.push("run() no longer shells out through the `timeout` command");
}

// package.json must be valid JSON and expose a diag script.
const pkgPath = join(ws, "package.json");
let pkg: any;
try {
  pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (e) {
  console.log("FAIL: package.json is missing or not valid JSON");
  process.exit(1);
}
const diagScript: string | undefined = pkg?.scripts?.diag;
if (typeof diagScript !== "string" || !/diag\.ts/.test(diagScript)) {
  problems.push(`package.json scripts.diag missing or does not reference diag.ts (got: ${JSON.stringify(diagScript)})`);
}

if (problems.length > 0) {
  console.log("FAIL: " + problems.join("; "));
  process.exit(1);
}

console.log("PASS: quick-op timeouts <=20s, install/typecheck timeouts in [45,90]/[45,120], all constants still wired into run() calls, and package.json has a diag script");
process.exit(0);
