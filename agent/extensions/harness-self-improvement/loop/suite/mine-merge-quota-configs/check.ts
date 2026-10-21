#!/usr/bin/env bun
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.argv[2];
function fail(reason: string): never {
  console.log(`FAIL: ${reason}`);
  process.exit(1);
}
function pass(reason: string): never {
  console.log(`PASS: ${reason}`);
  process.exit(0);
}

const cfgPath = join(workspace, "internal/config/config.go");
const appPath = join(workspace, "internal/config/app.go");
const testPath = join(workspace, "internal/config/app_test.go");

for (const p of [cfgPath, appPath, testPath]) {
  if (!existsSync(p)) fail(`missing expected file: ${p}`);
}

let cfg: string, app: string, test: string;
try {
  cfg = readFileSync(cfgPath, "utf8");
  app = readFileSync(appPath, "utf8");
  test = readFileSync(testPath, "utf8");
} catch (e) {
  fail(`could not read config package files: ${e}`);
}

// Old config must be fully removed everywhere. Line comments are stripped
// first: prose mentions of the old names are not code and must not fail the
// check.
const code = (s: string): string => s.replace(/\/\/[^\n]*/g, "");
if (/QuotaRequestsLimits/.test(code(cfg)))
  fail("config.go still declares the old QuotaRequestsLimits type");
if (/quota_requests_limits/.test(code(cfg)))
  fail("config.go still references quota_requests_limits");
if (/QuotaRequestsLimits/.test(code(app)))
  fail("app.go still references the removed QuotaRequestsLimits type");
if (/quota_requests_limits/.test(code(app)))
  fail("app.go still loads the quota_requests_limits config");
if (/LoadQuotaRequestsLimits/.test(code(test)))
  fail("app_test.go still tests the removed LoadQuotaRequestsLimits loader");

// Merged struct must keep every field from both original configs.
if (!/AutoQuotaLimits/.test(cfg))
  fail("config.go does not define an AutoQuotaLimits type");
for (const field of [
  "MaxRequestsPerDay",
  "MaxConcurrentRequests",
  "Enabled",
  "DefaultQuota",
]) {
  if (!cfg.includes(field))
    fail(`merged AutoQuotaLimits config is missing field ${field}`);
}

// Single loader reading autoquota_limits must remain, and be tested.
if (!app.includes("autoquota_limits"))
  fail("app.go does not load the autoquota_limits config");
if (!/LoadAutoQuotaLimits/.test(app))
  fail("app.go does not define LoadAutoQuotaLimits");
if (!test.includes("LoadAutoQuotaLimits"))
  fail("app_test.go does not test LoadAutoQuotaLimits");

// The package must compile and its tests must pass (isolated Go cache so the
// workspace stays untouched).
const cacheDir = mkdtempSync(join(tmpdir(), "gocache-"));
const res = spawnSync("go", ["test", "./internal/config/..."], {
  cwd: workspace,
  encoding: "utf8",
  env: {
    ...process.env,
    GOCACHE: cacheDir,
    GOPATH: join(cacheDir, "gopath"),
    GOPROXY: "off",
    HOME: cacheDir,
  },
});
rmSync(cacheDir, {recursive: true, force: true});
if (res.error) fail(`could not run go test: ${res.error.message}`);
if (res.status !== 0)
  fail(
    `go test ./internal/config/... failed:\n${res.stdout ?? ""}\n${res.stderr ?? ""}`,
  );

pass(
  "quota_requests_limits fully merged into auto_quota_limits (all fields kept, old code removed) and go test ./internal/config/... passes",
);
