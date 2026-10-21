#!/usr/bin/env bun
// Checker for smoke-json-edit.
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

const target = join(ws, "config.json");
if (!existsSync(target)) fail("config.json not found in workspace");

const raw = readFileSync(target, "utf8");
let config: Record<string, unknown>;
try {
  config = JSON.parse(raw);
} catch (e) {
  fail(`config.json is not valid JSON (${(e as Error).message}); content:\n${raw}`);
}

// Same semantics as the former `jq -e '(.name == "demo") and (.version == 1)
// and (.enabled == true)'`.
if (!(config["name"] === "demo" && config["version"] === 1 && config["enabled"] === true)) {
  fail(`config.json does not satisfy name=="demo", version==1, enabled==true; content:\n${raw}`);
}

console.log("PASS: config.json has name=demo, version=1, enabled=true");
