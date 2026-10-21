#!/usr/bin/env bun
/**
 * End-to-end verification harness for Step 5 apply + revert (temp dirs only).
 *
 * Builds a TEMP fake config dir (git repo seeded with AGENTS.md +
 * skills/x/SKILL.md), runs applyCandidate against it via the `agentDir`
 * override (the mechanism that keeps every test off the live ~/.pi/agent),
 * then reverts and checks byte-identical trees. Prints PASS/FAIL per
 * assertion and exits 0 (all pass) or 1 (any failure).
 *
 *   bun run loop/apply-test.ts
 */
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {applyCandidate, revertByRunId, DEFAULT_LOOP_CONFIG, type LoopConfig} from "./lib/apply.ts";
import {candidateFingerprint, type ProposedCandidate} from "./lib/proposer.ts";

// ---------------------------------------------------------------------------
// Harness plumbing

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail === "" ? "" : ` — ${detail}`}`);
  }
}

function git(dir: string, args: string[]): {status: number; stdout: string; stderr: string} {
  const res = spawnSync("git", args, {cwd: dir, encoding: "utf8"});
  return {status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? ""};
}

const APPLY: LoopConfig = {...DEFAULT_LOOP_CONFIG, apply: {dryRun: false}};

const AGENTS_BASE = "# base agents\n\nFollow the skill playbook.\n";
const SKILL_X_BASE = "---\ndescription: x\n---\nbase skill body\n";
const AGENTS_NEW = "# base agents\n\nFollow the skill playbook.\n\n## Config merging\nMerge configs with jq, never by hand.\n";
const SKILL_X_NEW = "---\ndescription: x\n---\nimproved skill body with a worked example\n";
const SKILL_Y_NEW = "---\ndescription: y\n---\nbrand new skill about config merging\n";

const root = mkdtempSync(join(tmpdir(), "harness-apply-test-"));
const agentDir = join(root, "agent");
const ledger = join(root, "history.jsonl");
const runId = `apply-test-${Date.now()}`;

try {
  // --- Stage the temp fake config git repo ---------------------------------
  const skillsX = join(agentDir, "skills", "x");
  const skillsY = join(agentDir, "skills", "y");
  mkdirSync(skillsX, {recursive: true});
  writeFileSync(join(agentDir, "AGENTS.md"), AGENTS_BASE);
  writeFileSync(join(skillsX, "SKILL.md"), SKILL_X_BASE);
  git(agentDir, ["init", "-q"]);
  git(agentDir, ["config", "user.email", "harness-apply-test@example.invalid"]);
  git(agentDir, ["config", "user.name", "harness-apply-test"]);
  git(agentDir, ["add", "AGENTS.md", "skills/"]);
  git(agentDir, ["commit", "-q", "-m", "seed fake agent config"]);
  const treeBefore = git(agentDir, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  check("temp repo seeded, tree sha captured", treeBefore !== "");

  // --- Apply the winning candidate ----------------------------------------
  const edits = [
    {path: "AGENTS.md", content: AGENTS_NEW},
    {path: "skills/x/SKILL.md", content: SKILL_X_NEW},
    {path: "skills/y/SKILL.md", content: SKILL_Y_NEW}, // create
  ];
  const winner: ProposedCandidate = {
    rationale: "Add a config-merging section to AGENTS.md and a worked example skill; add a new skill covering the jq merge pattern.",
    edits,
    fingerprint: candidateFingerprint(edits),
    verdict: "accepted",
    reasons: [],
  };
  const applied = applyCandidate({candidates: [winner], winner, runId, config: APPLY, agentDir, ledgerPath: ledger});

  check("apply decision is applied", applied.decision === "applied", `decision=${applied.decision} reasons=${JSON.stringify(applied.reasons)}`);
  check("apply returned a sha", Boolean(applied.sha));
  check("AGENTS.md changed on disk", readFileSync(join(agentDir, "AGENTS.md"), "utf8") === AGENTS_NEW);
  check("skills/x/SKILL.md rewritten", readFileSync(join(skillsX, "SKILL.md"), "utf8") === SKILL_X_NEW);
  check("skills/y/SKILL.md created", readFileSync(join(skillsY, "SKILL.md"), "utf8") === SKILL_Y_NEW);

  const markerLog = git(agentDir, ["log", "--format=%H %s"]);
  const marker = `harness-loop(run ${runId}):`;
  check("commit with harness-loop marker exists", markerLog.stdout.includes(marker), markerLog.stdout);
  check("marker commit sha matches the reported sha", applied.sha !== undefined && markerLog.stdout.includes(applied.sha));
  check("commit message carries the rationale head", markerLog.stdout.includes("Add a config-merging section"));

  const ledgerLines = readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  const applyEntry = ledgerLines.find((e) => e["kind"] === "apply");
  check("ledger has the apply entry", applyEntry !== undefined);
  check("apply entry decision=applied with sha", applyEntry?.["decision"] === "applied" && applyEntry?.["sha"] === applied.sha);

  // --- Revert --------------------------------------------------------------
  const reverted = revertByRunId(runId, {agentDir, ledgerPath: ledger});
  check("revert succeeded", reverted.ok, `method=${reverted.method} error=${reverted.error ?? ""}`);
  check("revert sha is the marker commit", reverted.sha !== undefined && markerLog.stdout.split("\n").some((l) => l.startsWith(`${reverted.sha} ${marker}`)));
  const revertEntry = ledgerLines.concat(
    readFileSync(ledger, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>),
  ).find((e) => e["kind"] === "revert");
  check("ledger has the revert entry", revertEntry !== undefined);
  check("revert entry decision=reverted with sha+method", revertEntry?.["decision"] === "reverted" && revertEntry?.["sha"] === reverted.sha && revertEntry?.["method"] === "revert");

  const treeAfter = git(agentDir, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
  check("tree sha byte-identical after revert", treeAfter === treeBefore, `${treeBefore} vs ${treeAfter}`);
  const status = git(agentDir, ["status", "--porcelain"]).stdout;
  check("working tree clean after revert (diff empty)", status === "", status);
  check("AGENTS.md restored", readFileSync(join(agentDir, "AGENTS.md"), "utf8") === AGENTS_BASE);
  check("skills/x/SKILL.md restored", readFileSync(join(skillsX, "SKILL.md"), "utf8") === SKILL_X_BASE);
  check("skills/y/SKILL.md removed by revert", !existsSync(join(skillsY, "SKILL.md")));

  // --- Safety: the live repo was never involved ----------------------------
  check("ledger path is inside the temp root", ledger.startsWith(root));
  check("agentDir override used (temp root)", agentDir.startsWith(root));
} finally {
  rmSync(root, {recursive: true, force: true});
}

console.log(failures === 0 ? "\napply-test: ALL PASS" : `\napply-test: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
