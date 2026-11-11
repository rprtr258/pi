#!/usr/bin/env bun
/**
 * Chaos scenario (c) — "killed between write and commit", simulated per the
 * S5 design: an apply that died after writing files but before committing
 * leaves UNCOMMITTED residue under the managed paths; the S5 dirty-tree
 * preflight makes the NEXT apply (and revert) REFUSE until the residue is
 * resolved manually. This script reproduces exactly that state on a TEMP
 * agent-dir git repo (never the real ~/.pi/agent) and asserts:
 *   1. a pre-dirty managed path + a real (dryRun: false) applyCandidate →
 *      decision "rejected" with the dirty-tree reason, BEFORE any write;
 *   2. after the residue is committed (the manual resolution the preflight
 *      demands), the SAME apply succeeds.
 *
 *   bun run loop/chaos-apply-refusal.ts     exit 0 = scenario passed
 */
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {applyCandidate, DEFAULT_LOOP_CONFIG} from "./lib/apply.ts";
import type {ProposedCandidate} from "./lib/proposer.ts";

const root = mkdtempSync(join(tmpdir(), "hloop-chaos-apply-"));
const agentDir = join(root, "agent");
const git = (args: string[]): void => {
  const res = spawnSync("git", args, {cwd: agentDir, encoding: "utf8"});
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
};

// 1. Fake agent config repo with a committed baseline.
mkdirSync(join(agentDir, "skills", "x"), {recursive: true});
writeFileSync(join(agentDir, "AGENTS.md"), "# base agents\n");
writeFileSync(join(agentDir, "skills/x/SKILL.md"), "---\ndescription: x\n---\nbase skill body\n");
git(["init", "-q"]);
git(["config", "user.email", "harness-loop-chaos@example.invalid"]);
git(["config", "user.name", "harness-loop-chaos"]);
git(["add", "AGENTS.md", "skills/"]);
git(["commit", "-q", "-m", "seed"]);

const winner: ProposedCandidate = {
  rationale: "chaos: kill-between-write-and-commit simulation",
  edits: [{path: "AGENTS.md", content: "# base agents\n\nimproved by the loop\n"}],
  fingerprint: "chaos-fp",
  verdict: "accepted",
  reasons: [],
};
const applyOnce = () =>
  applyCandidate({
    candidates: [winner],
    winner,
    runId: "chaos-apply-refusal",
    config: {...DEFAULT_LOOP_CONFIG, apply: {dryRun: false}},
    agentDir,
    ledgerPath: join(root, "history.jsonl"),
  });

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

// 2. Simulate the crash residue: files written, commit never happened.
writeFileSync(join(agentDir, "AGENTS.md"), "# base agents\n# half-applied loop write (residue)\n");

// 3. The NEXT apply must refuse on the dirty-tree preflight, before any write.
const refused = applyOnce();
check(refused.decision === "rejected", `next apply refuses on a dirty tree (decision=${refused.decision})`);
check(refused.reasons.some((r) => r.includes("working tree dirty")), `rejection cites the dirty managed paths (${JSON.stringify(refused.reasons)})`);
check(readFileSync(join(agentDir, "AGENTS.md"), "utf8").includes("half-applied loop write"), "refusal happened BEFORE any write (residue untouched)");

// 4. Manual resolution (commit the residue) → the same apply now proceeds.
git(["add", "AGENTS.md"]);
git(["commit", "-q", "-m", "manual resolution of the half-applied loop write"]);
const applied = applyOnce();
check(applied.decision === "applied", `apply succeeds after the residue is resolved (decision=${applied.decision})`);
check(readFileSync(join(agentDir, "AGENTS.md"), "utf8") === "# base agents\n\nimproved by the loop\n", "apply wrote the candidate content");

rmSync(root, {recursive: true, force: true});
console.log(problems.length === 0 ? "[chaos-apply-refusal] PASS" : `[chaos-apply-refusal] FAIL: ${problems.join("; ")}`);
process.exit(ok ? 0 : 1);
