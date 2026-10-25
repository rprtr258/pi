#!/usr/bin/env bun
/**
 * Unit tests for Step 5 apply machinery: selectWinner matrix, applyCandidate
 * rollback on git failure, dry-run no-op, successful apply + revert (incl.
 * the conflict fallback), the tolerant loadLoopConfig, and the
 * proposal-rejected ledger shape as read by buildLedgerDigest.
 *
 * SAFETY: every test operates on temp-dir copies of a fake config git repo
 * via the agentDir/ledgerPath overrides. NOTHING here touches the real
 * ~/.pi/agent or the real run-history.jsonl.
 *
 *   bun test loop/lib/apply.test.ts
 */
import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {pairedDelta, selectWinner, type TaskScoreResult} from "./score.ts";
import {
  applyCandidate,
  appendProposalRejectedEntry,
  DEFAULT_LOOP_CONFIG,
  loadLoopConfig,
  revertByRunId,
  type LoopConfig,
} from "./apply.ts";
import {candidateFingerprint, buildLedgerDigest, type ProposedCandidate} from "./proposer.ts";
import {readLedger} from "./ledger.ts";

const tmpRoots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Fixtures

const USAGE = (totalTokens: number) => ({
  input: totalTokens,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens,
  cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
});

function task(name: string, pass: boolean, tokens: number, durationMs = 1000): TaskScoreResult {
  return {
    task: name,
    category: "test",
    pass,
    durationMs,
    usage: tokens === 0 ? null : USAGE(tokens),
    exit: pass ? 0 : 1,
    piBinary: {bin: "pi", version: "1.3.0-test"},
    timedOut: false,
    checkerOutput: pass ? "" : "checker failed",
    stderrExcerpt: null,
    trajectory: "",
  };
}

function candidate(edits: Array<{path: string; content: string | null}>, rationale = "improve the harness instructions"): ProposedCandidate {
  return {rationale, edits, fingerprint: candidateFingerprint(edits), verdict: "accepted", reasons: []};
}

function git(dir: string, args: string[]): {status: number; stdout: string; stderr: string} {
  const res = spawnSync("git", args, {cwd: dir, encoding: "utf8"});
  return {status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? ""};
}

/** Temp fake config git repo: AGENTS.md + skills/x/SKILL.md, one seed commit. */
function tempAgentRepo(root: string): string {
  const dir = join(root, "agent");
  mkdirSync(join(dir, "skills", "x"), {recursive: true});
  writeFileSync(join(dir, "AGENTS.md"), "# base agents\n");
  writeFileSync(join(dir, "skills/x/SKILL.md"), "---\ndescription: x\n---\nbase skill body\n");
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "harness-loop-test@example.invalid"]);
  git(dir, ["config", "user.name", "harness-loop-test"]);
  git(dir, ["add", "AGENTS.md", "skills/"]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}

const APPLY: LoopConfig = {...DEFAULT_LOOP_CONFIG, apply: {dryRun: false}};

const AGENTS_NEW = "# base agents\n\nimproved instructions for config merging\n";
const SKILL_X_NEW = "---\ndescription: x\n---\nimproved skill body\n";
const SKILL_Y_NEW = "---\ndescription: y\n---\nnew skill\n";

// ---------------------------------------------------------------------------
// selectWinner

describe("selectWinner", () => {
  test("win by minWin (passDelta 1, no regressions, ratio ok)", () => {
    const base = [task("a", false, 100), task("b", true, 100)];
    const cand = [task("a", true, 100), task("b", true, 100)];
    const res = selectWinner(base, cand, DEFAULT_LOOP_CONFIG);
    expect(res.win).toBe(true);
    expect(res.reasons.some((r) => r.includes("pass delta 1"))).toBe(true);
  });

  test("veto by regression (passDelta +1 but a pass→fail flip)", () => {
    const base = [task("a", false, 100), task("b", false, 100), task("c", true, 100)];
    const cand = [task("a", true, 100), task("b", true, 100), task("c", false, 100)];
    const res = selectWinner(base, cand, DEFAULT_LOOP_CONFIG);
    expect(res.win).toBe(false);
    expect(res.reasons.some((r) => r.startsWith("VETO:") && r.includes("regression"))).toBe(true);
  });

  test("veto by tokenRatio 1.6 > usageFactor 1.5", () => {
    const base = [task("a", true, 100), task("b", true, 100)];
    const cand = [task("a", true, 160), task("b", true, 160)];
    const res = selectWinner(base, cand, DEFAULT_LOOP_CONFIG);
    expect(res.win).toBe(false);
    expect(res.reasons.some((r) => r.includes("token ratio 1.60"))).toBe(true);
  });

  test("pass-equal + minQualityGain null → no win (default)", () => {
    const base = [task("a", true, 100), task("b", true, 100)];
    const cand = [task("a", true, 100), task("b", true, 100)];
    const res = selectWinner(base, cand, DEFAULT_LOOP_CONFIG);
    expect(res.win).toBe(false);
    expect(res.reasons.some((r) => r.includes("minQualityGain is null"))).toBe(true);
  });

  test("pass-equal + minQualityGain 0.9 + duration improvement → win", () => {
    const base = [task("a", true, 100, 1000), task("b", true, 100, 1000)];
    const cand = [task("a", true, 100, 50), task("b", true, 100, 50)];
    const res = selectWinner(base, cand, {minWin: 1, minQualityGain: 0.9, usageFactor: 1.5});
    expect(res.win).toBe(true);
    expect(res.reasons.some((r) => r.includes("duration improvement"))).toBe(true);
  });

  test("unpaired tasks → refuse", () => {
    const base = [task("a", false, 100), task("b", true, 100)];
    const cand = [task("a", true, 100)];
    const res = selectWinner(base, cand, DEFAULT_LOOP_CONFIG);
    expect(res.win).toBe(false);
    expect(res.reasons.some((r) => r.includes("unpaired") && r.includes("b"))).toBe(true);
  });

  test("pairedDelta still usable directly (shape untouched)", () => {
    const delta = pairedDelta([task("a", false, 100)], [task("a", true, 100)]);
    expect(delta.aggregates.passDelta).toBe(1);
    expect(delta.aggregates.regressions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// loadLoopConfig

describe("loadLoopConfig", () => {
  test("missing file → defaults, no throw", () => {
    expect(loadLoopConfig(join(tempRoot("cfg-"), "absent.json"))).toEqual(DEFAULT_LOOP_CONFIG);
  });

  test("invalid JSON → defaults", () => {
    const p = join(tempRoot("cfg-"), "broken.json");
    writeFileSync(p, "{not json");
    expect(loadLoopConfig(p)).toEqual(DEFAULT_LOOP_CONFIG);
  });

  test("valid file overrides fields", () => {
    const p = join(tempRoot("cfg-"), "ok.json");
    writeFileSync(p, JSON.stringify({minWin: 2, minQualityGain: 0.5, usageFactor: 1.2, apply: {dryRun: false}}));
    const cfg = loadLoopConfig(p);
    expect(cfg.minWin).toBe(2);
    expect(cfg.minQualityGain).toBe(0.5);
    expect(cfg.usageFactor).toBe(1.2);
    expect(cfg.apply.dryRun).toBe(false);
  });

  test("wrong-typed field falls back to default", () => {
    const p = join(tempRoot("cfg-"), "mixed.json");
    writeFileSync(p, JSON.stringify({minWin: "lots", usageFactor: 2}));
    const cfg = loadLoopConfig(p);
    expect(cfg.minWin).toBe(DEFAULT_LOOP_CONFIG.minWin);
    expect(cfg.usageFactor).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applyCandidate

describe("applyCandidate", () => {
  test("dry-run writes nothing and appends an apply-dryrun ledger entry", () => {
    const root = tempRoot("apply-dry-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/y/SKILL.md", content: SKILL_Y_NEW},
    ]);
    const res = applyCandidate({candidates: [winner], winner, runId: "dry-1", config: DEFAULT_LOOP_CONFIG, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("dry-run");
    expect(res.ok).toBe(true);
    expect(res.files.map((f) => [f.path, f.action])).toEqual([["AGENTS.md", "write"], ["skills/y/SKILL.md", "create"]]);
    // Nothing on disk changed.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(existsSync(join(agentDir, "skills/y/SKILL.md"))).toBe(false);
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
    // Ledger got the dry-run entry.
    const entries = readLedger(ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("apply-dryrun");
  });

  test("rollback on git failure (agentDir is not a git repo)", () => {
    const root = tempRoot("apply-fail-");
    const agentDir = join(root, "agent"); // no git init → git add fails
    mkdirSync(join(agentDir, "skills", "x"), {recursive: true});
    writeFileSync(join(agentDir, "AGENTS.md"), "# base agents\n");
    writeFileSync(join(agentDir, "skills/x/SKILL.md"), "base skill body\n");
    const ledger = join(root, "history.jsonl");
    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/y/SKILL.md", content: SKILL_Y_NEW},
      {path: "skills/x/SKILL.md", content: null}, // delete also rolled back
    ]);
    const res = applyCandidate({candidates: [winner], winner, runId: "fail-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("apply-failed");
    expect(res.ok).toBe(false);
    expect(res.reasons[0]).toContain("git add failed");
    // Every write rolled back to the snapshot taken before applying.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(readFileSync(join(agentDir, "skills/x/SKILL.md"), "utf8")).toBe("base skill body\n");
    expect(existsSync(join(agentDir, "skills/y/SKILL.md"))).toBe(false);
    const entries = readLedger(ledger);
    expect(entries[0]!.kind).toBe("apply");
    expect(entries[0]!.decision).toBe("apply-failed");
  });

  test("apply success: files changed, commit with marker, sha recorded", () => {
    const root = tempRoot("apply-ok-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/y/SKILL.md", content: SKILL_Y_NEW},
    ]);
    const res = applyCandidate({candidates: [winner], winner, runId: "ok-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("applied");
    expect(res.ok).toBe(true);
    expect(res.sha).toBeDefined();
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe(AGENTS_NEW);
    expect(readFileSync(join(agentDir, "skills/y/SKILL.md"), "utf8")).toBe(SKILL_Y_NEW);
    const log = git(agentDir, ["log", "--format=%H %s"]);
    expect(log.stdout).toContain(`harness-loop(run ok-1):`);
    expect(log.stdout).toContain(res.sha!);
    const entries = readLedger(ledger);
    expect(entries[0]!.kind).toBe("apply");
    expect(entries[0]!.decision).toBe("applied");
    expect(entries[0]!.sha).toBe(res.sha);
  });

  test("invalid winner path → rejected without touching files", () => {
    const root = tempRoot("apply-rej-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([{path: "../escape.md", content: "nope"}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "rej-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("rejected");
    expect(res.reasons[0]).toContain("path traversal");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(readLedger(ledger)[0]!.decision).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// revertByRunId

describe("revertByRunId", () => {
  test("clean revert restores the pre-apply tree", () => {
    const root = tempRoot("revert-ok-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const treeBefore = git(agentDir, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/y/SKILL.md", content: SKILL_Y_NEW},
    ]);
    const applied = applyCandidate({candidates: [winner], winner, runId: "rev-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(applied.decision).toBe("applied");

    const reverted = revertByRunId("rev-1", {agentDir});
    expect(reverted.ok).toBe(true);
    expect(reverted.method).toBe("revert");
    expect(reverted.sha).toBe(applied.sha);
    expect(git(agentDir, ["rev-parse", "HEAD^{tree}"]).stdout.trim()).toBe(treeBefore);
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(existsSync(join(agentDir, "skills/y/SKILL.md"))).toBe(false);
  });

  test("revert conflict → checkout fallback restores pre-apply paths", () => {
    const root = tempRoot("revert-conf-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([{path: "AGENTS.md", content: AGENTS_NEW}]);
    const applied = applyCandidate({candidates: [winner], winner, runId: "rev-2", config: APPLY, agentDir, ledgerPath: ledger});
    expect(applied.decision).toBe("applied");
    // Diverge the applied line so `git revert` conflicts.
    writeFileSync(join(agentDir, "AGENTS.md"), "# divergent manual edit after apply\n");
    git(agentDir, ["add", "AGENTS.md"]);
    git(agentDir, ["commit", "-q", "-m", "manual post-apply edit"]);

    const reverted = revertByRunId("rev-2", {agentDir});
    expect(reverted.ok).toBe(true);
    expect(reverted.method).toBe("checkout-fallback");
    // Loop-managed path restored to the pre-apply content.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
  });

  test("refuses an unknown runId and never touches other commits", () => {
    const root = tempRoot("revert-none-");
    const agentDir = tempAgentRepo(root);
    const headBefore = git(agentDir, ["rev-parse", "HEAD"]).stdout.trim();
    const res = revertByRunId("no-such-run", {agentDir});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no harness-loop commit found");
    expect(git(agentDir, ["rev-parse", "HEAD"]).stdout.trim()).toBe(headBefore);
  });
});

// ---------------------------------------------------------------------------
// proposal-rejected ledger shape vs buildLedgerDigest

describe("proposal-rejected ledger shape", () => {
  test("appendProposalRejectedEntry shape is read by buildLedgerDigest", () => {
    const ledger = join(tempRoot("ledger-"), "history.jsonl");
    const edits = [{path: "AGENTS.md", content: AGENTS_NEW}];
    appendProposalRejectedEntry({
      runId: "sc-1",
      proposalFingerprint: candidateFingerprint(edits),
      scores: {passCount: 3, total: 5},
      usage: {totalTokens: 1234},
      reasons: ["selection lost: pass delta 0"],
      ledgerPath: ledger,
    });
    const digest = buildLedgerDigest(readLedger(ledger));
    expect(digest).toEqual([candidateFingerprint(edits)]);
  });
});
