#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ws = process.argv[2] ? resolve(process.argv[2]) : "";
if (!ws) {
  console.log("FAIL: workspace path not provided");
  process.exit(1);
}

const fail = (r: string): never => {
  console.log(`FAIL: ${r}`);
  process.exit(1);
};
const pass = (r: string): never => {
  console.log(`PASS: ${r}`);
  process.exit(0);
};

const cfgPath = join(ws, "eslint.config.js");
const pkgPath = join(ws, "package.json");
const srcPath = join(ws, "wasm.ts");
for (const p of [cfgPath, pkgPath, srcPath]) {
  if (!existsSync(p)) fail(`required file missing: ${p}`);
}

const EXPECTED_CONFIG = `import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "no-debugger": "error",
    },
  },
];
`;

const cfg = readFileSync(cfgPath, "utf8");
if (cfg !== EXPECTED_CONFIG)
  fail("eslint.config.js was modified; lint rules/config must remain untouched");

let pkg: any;
try {
  pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch {
  fail("package.json is not valid JSON");
}
if (pkg?.scripts?.lint !== "eslint .")
  fail("the lint script in package.json was changed");
if (!pkg?.devDependencies?.eslint)
  fail("eslint was removed from devDependencies");

const src = readFileSync(srcPath, "utf8");

// Strip comments so mentions in comments don't trip the pattern checks.
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

if (src.includes("__DBGEMIT"))
  fail("debug marker __DBGEMIT is still present in wasm.ts");
if (/console\./.test(stripped))
  fail("console.* call still present in wasm.ts (no-console)");
if (/^\s*debugger\s*;/m.test(stripped))
  fail("debugger statement still present in wasm.ts");
if (/debugBuf/.test(stripped))
  fail("unused debug variable debugBuf is still declared in wasm.ts");
if (/eslint-disable/i.test(src))
  fail("eslint-disable comments are not allowed; fix the source instead");

let exports: string[];
try {
  const t = new Bun.Transpiler({ loader: "ts" });
  exports = t.scan(src).exports;
} catch {
  fail("wasm.ts does not parse as valid TypeScript");
}
for (const name of ["typeSection", "exportSection", "emitModule"]) {
  if (!exports.includes(name)) fail(`wasm.ts no longer exports ${name}`);
}

const eslintBin = join(ws, "node_modules", "eslint", "bin", "eslint.js");
if (existsSync(eslintBin)) {
  const proc = Bun.spawnSync(["node", eslintBin, "."], {
    cwd: ws,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const tail = new TextDecoder()
      .decode(proc.stderr || proc.stdout)
      .trim()
      .split("\n")
      .slice(-5)
      .join(" | ");
    fail(`eslint still reports problems: ${tail}`);
  }
  pass(
    "eslint exits cleanly, config untouched, public API intact, debug scaffolding removed"
  );
}

pass(
  "static checks pass: config untouched, public API intact, debug scaffolding removed (eslint not installed, live lint run skipped)"
);
