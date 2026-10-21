#!/usr/bin/env bun
/**
 * Chaos extra: checker isolation under concurrent probing (Step 10/12).
 *
 * Two probes of a synthetic suite task run CONCURRENTLY (scoreSuite,
 * concurrency 2) against a checker that writes a fixed temp path —
 * "${TMPDIR:-/tmp}/hloop-chaos-iso/marker" — then sleeps, then verifies its
 * own marker survived. With a SHARED temp dir the second checker's write
 * would clobber the first's marker before its read → the first fails. With
 * the per-probe TMPDIR isolation (probe.ts RunProbeOptions.tmpDir, threaded
 * from score.ts) each checker sees its own temp root → no interference.
 *
 * The nested pi is a FAKE binary (PI_BIN) emitting one usage-bearing JSONL
 * event — the scenario targets CHECKER isolation, not the model, so no real
 * model spend is needed. The script also asserts the two probes actually ran
 * under two DISTINCT TMPDIRs (logged by the checker to a fixed shared file).
 *
 *   bun run loop/chaos-isolation.ts     exit 0 = no interference
 */
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {scoreSuite} from "./lib/score.ts";
import {loadTask} from "./lib/suite.ts";
import type {LoadedTask} from "./lib/suite.ts";

const root = mkdtempSync(join(tmpdir(), "hloop-chaos-iso-"));
const suiteRoot = join(root, "suite");
const logDir = join(root, "tmpdir-log"); // FIXED shared path, deliberately OUTSIDE the per-probe TMPDIRs

const CHECKER = `#!/usr/bin/env bash
ws="$1"
dir="\${TMPDIR:-/tmp}/hloop-chaos-iso"
mkdir -p "$dir"
echo "$$" > "$dir/marker"
printf '%s\\n' "\${TMPDIR:-<unset>}" >> "${logDir}/tmpdirs.txt"
sleep 2
if [ "$(cat "$dir/marker")" != "$$" ]; then
  echo "checker marker clobbered by a concurrent checker (shared temp dir)"
  exit 1
fi
rm -rf "$dir"
exit 0
`;

// Fake nested pi: --version + one usage-bearing event, exit 0.
const FAKE_PI = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "fake-pi 1.0"; exit 0; fi
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":4,"output":4,"cacheRead":0,"cacheWrite":0,"totalTokens":8,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}}}'
exit 0
`;

let ok = true;
const problems: string[] = [];
const check = (cond: boolean, what: string): void => {
  if (cond) {
    console.log(`  PASS: ${what}`);
  } else {
    ok = false;
    problems.push(what);
    console.log(`  FAIL: ${what}`);
  }
};

try {
  // Two suite tasks sharing the interfering checker.
  const tasks: LoadedTask[] = [];
  for (const name of ["chaos-iso-a", "chaos-iso-b"]) {
    const dir = join(suiteRoot, name);
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "TASK.md"), `---\nname: ${name}\ndescription: checker isolation fixture\ntimeout_s: 60\n---\nDo the thing.\n`);
    const checkPath = join(dir, "check.sh");
    writeFileSync(checkPath, CHECKER);
    chmodSync(checkPath, 0o755);
    tasks.push(loadTask(suiteRoot, name));
  }
  mkdirSync(logDir, {recursive: true});
  const logFile = join(logDir, "tmpdirs.txt");

  const binPath = join(root, "fake-pi.sh");
  writeFileSync(binPath, FAKE_PI);
  chmodSync(binPath, 0o755);
  process.env.PI_BIN = binPath;

  const scored = await scoreSuite(tasks, join(root, "sandbox"), join(root, "results"), {concurrency: 2});

  check(scored.aggregate.passCount === 2, `both concurrent checkers pass (no interference): ${scored.aggregate.passCount}/2`);
  const tmpdirs = readFileSync(logFile, "utf8").trim().split("\n");
  check(tmpdirs.length === 2, `both checkers logged their TMPDIR (${tmpdirs.length} lines)`);
  check(tmpdirs[0] !== tmpdirs[1], `the two probes ran under DISTINCT TMPDIRs (${tmpdirs[0]} vs ${tmpdirs[1]})`);
  check(scored.stats.maxObservedConcurrency === 2, `probes actually overlapped (max observed concurrency ${scored.stats.maxObservedConcurrency})`);
  check(scored.results.every((r) => (r.usage?.totalTokens ?? 0) === 8), `fake-pi usage parsed for both probes`);
} catch (err) {
  ok = false;
  problems.push(err instanceof Error ? err.message : String(err));
  console.log(`  FAIL: unexpected error: ${problems.at(-1)}`);
} finally {
  delete process.env.PI_BIN;
  rmSync(root, {recursive: true, force: true});
}
console.log(problems.length === 0 ? "[chaos-isolation] PASS" : `[chaos-isolation] FAIL: ${problems.join("; ")}`);
process.exit(ok ? 0 : 1);
