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
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync} from "node:fs";
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

  test("passDelta 1 below minWin 2 → NOT win even with a big duration improvement", () => {
    // The duration branch is pass-equal (passDelta === 0) ONLY: a partial
    // pass improvement under minWin must never leak into it.
    const base = [task("a", false, 100, 1000), task("b", true, 100, 1000)];
    const cand = [task("a", true, 100, 10), task("b", true, 100, 10)];
    const res = selectWinner(base, cand, {minWin: 2, minQualityGain: 0.1, usageFactor: 1.5});
    expect(res.win).toBe(false);
    expect(res.reasons.some((r) => r.includes("pass delta 1 is below minWin 2 and not pass-equal"))).toBe(true);
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

  test("minWin must be an integer ≥ 1; usageFactor must be a finite number > 0", () => {
    const p = join(tempRoot("cfg-"), "bad-thresholds.json");
    writeFileSync(p, JSON.stringify({minWin: 0, usageFactor: -1}));
    const cfg = loadLoopConfig(p);
    expect(cfg.minWin).toBe(DEFAULT_LOOP_CONFIG.minWin);
    expect(cfg.usageFactor).toBe(DEFAULT_LOOP_CONFIG.usageFactor);

    const p2 = join(tempRoot("cfg-"), "fractional-minwin.json");
    writeFileSync(p2, JSON.stringify({minWin: 1.5}));
    expect(loadLoopConfig(p2).minWin).toBe(DEFAULT_LOOP_CONFIG.minWin);

    const p3 = join(tempRoot("cfg-"), "zero-usage.json");
    writeFileSync(p3, JSON.stringify({usageFactor: 0}));
    expect(loadLoopConfig(p3).usageFactor).toBe(DEFAULT_LOOP_CONFIG.usageFactor);

    const p4 = join(tempRoot("cfg-"), "good-thresholds.json");
    writeFileSync(p4, JSON.stringify({minWin: 3, usageFactor: 0.5}));
    const good = loadLoopConfig(p4);
    expect(good.minWin).toBe(3);
    expect(good.usageFactor).toBe(0.5);
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
    // Fix 6: skills/y was created by apply's mkdir -p — rollback rmdirs it.
    expect(existsSync(join(agentDir, "skills/y"))).toBe(false);
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

  test("apply with a prompts/ template edit: commit contains prompts/<file> and the file lands (review fix)", () => {
    const root = tempRoot("apply-prompt-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const template = "# Ask mode\n\nUse {{QUESTION}} wisely.\n";
    const winner = candidate([{path: "prompts/mode-ask.md", content: template}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "prompt-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("applied");
    expect(res.ok).toBe(true);
    expect(res.sha).toBeDefined();
    // The file lands on disk with the proposed content.
    expect(readFileSync(join(agentDir, "prompts", "mode-ask.md"), "utf8")).toBe(template);
    // The apply commit contains prompts/mode-ask.md.
    const names = git(agentDir, ["show", "--name-only", "--format=", res.sha!]).stdout.split("\n").filter((l) => l !== "");
    expect(names).toContain("prompts/mode-ask.md");
    const entries = readLedger(ledger);
    expect(entries[0]!.kind).toBe("apply");
    expect(entries[0]!.decision).toBe("applied");
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

  test("symlinked path component → whole candidate rejected, nothing touched outside", () => {
    const root = tempRoot("apply-sym-");
    const ledger = join(root, "history.jsonl");
    // skills/x is a symlink to a directory OUTSIDE the agent dir, committed
    // as such so the test setup itself leaves the tree clean.
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "SKILL.md"), "outside original\n");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "skills"), {recursive: true});
    writeFileSync(join(agentDir, "AGENTS.md"), "# base agents\n");
    symlinkSync(outside, join(agentDir, "skills/x"), "dir");
    git(agentDir, ["init", "-q"]);
    git(agentDir, ["config", "user.email", "harness-loop-test@example.invalid"]);
    git(agentDir, ["config", "user.name", "harness-loop-test"]);
    git(agentDir, ["add", "AGENTS.md", "skills/"]);
    git(agentDir, ["commit", "-q", "-m", "seed with symlinked skill dir"]);

    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/x/SKILL.md", content: "hijacked through symlink\n"},
    ]);
    const res = applyCandidate({candidates: [winner], winner, runId: "sym-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("rejected");
    expect(res.reasons.some((r) => r.includes("symlink in path escapes containment"))).toBe(true);
    // Nothing written through the symlink, nothing committed.
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe("outside original\n");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
    // Lock released even on the rejection path.
    expect(existsSync(join(agentDir, ".harness-loop.apply.lock"))).toBe(false);
    expect(readLedger(ledger)[0]!.decision).toBe("rejected");
  });

  test("dirty tree under AGENTS.md/skills → apply refused before any write", () => {
    const root = tempRoot("apply-dirty-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    writeFileSync(join(agentDir, "AGENTS.md"), "# uncommitted manual edit\n"); // pre-dirty

    const winner = candidate([{path: "skills/y/SKILL.md", content: SKILL_Y_NEW}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "dirty-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("rejected");
    expect(res.reasons[0]).toContain("working tree dirty under AGENTS.md/skills/prompts/agents/extensions — resolve before apply");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# uncommitted manual edit\n");
    expect(existsSync(join(agentDir, "skills/y"))).toBe(false);
    expect(readLedger(ledger)[0]!.decision).toBe("rejected");
  });

  test("second concurrent apply is refused while the apply lock is held", () => {
    const root = tempRoot("apply-lock-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    // Simulate an in-flight apply holding the advisory lock.
    writeFileSync(join(agentDir, ".harness-loop.apply.lock"), "999999\n");

    const winner = candidate([{path: "AGENTS.md", content: AGENTS_NEW}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "lock-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("rejected");
    expect(res.reasons[0]).toContain("another apply in progress");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    // A fresh (non-stale) lock is never stolen and left in place.
    expect(existsSync(join(agentDir, ".harness-loop.apply.lock"))).toBe(true);
  });

  test("stale lock (mtime > 10 min old) is stolen and the apply proceeds", () => {
    const root = tempRoot("apply-stale-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const lockPath = join(agentDir, ".harness-loop.apply.lock");
    writeFileSync(lockPath, "999999\n");
    const old = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(lockPath, old, old);

    const winner = candidate([{path: "AGENTS.md", content: AGENTS_NEW}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "stale-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("applied");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe(AGENTS_NEW);
    // Released in the finally block after a successful apply.
    expect(existsSync(lockPath)).toBe(false);
  });

  test("commit failure in a real temp repo: apply-failed, index clean, tree restored byte-exactly", () => {
    const root = tempRoot("apply-commitfail-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    // Pre-commit hook that always fails → git commit fails AFTER git add.
    const hook = join(agentDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "skills/y/SKILL.md", content: SKILL_Y_NEW},
    ]);
    const res = applyCandidate({candidates: [winner], winner, runId: "commitfail-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("apply-failed");
    expect(res.reasons[0]).toContain("git commit failed");
    // Working tree restored to the pre-apply snapshot.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(existsSync(join(agentDir, "skills/y/SKILL.md"))).toBe(false);
    expect(existsSync(join(agentDir, "skills/y"))).toBe(false);
    // Index clean: nothing left staged by the failed add/commit.
    expect(git(agentDir, ["diff", "--cached", "--name-only"]).stdout).toBe("");
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
    expect(readLedger(ledger)[0]!.decision).toBe("apply-failed");
  });

  test("rollback restores non-UTF-8 prior content byte-exactly (Buffer snapshot)", () => {
    const root = tempRoot("apply-binary-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const scriptPath = join(agentDir, "skills", "x", "scripts", "tool.py");
    const originalBytes = Buffer.from([0x23, 0x21, 0x75, 0x73, 0x2e, 0xff, 0xfe, 0x00, 0x80, 0x81, 0x0a]);
    mkdirSync(join(agentDir, "skills", "x", "scripts"), {recursive: true});
    writeFileSync(scriptPath, originalBytes);
    git(agentDir, ["add", "skills/"]);
    git(agentDir, ["commit", "-q", "-m", "seed binary script"]);
    // Same always-failing pre-commit hook → rollback path.
    const hook = join(agentDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    const winner = candidate([{path: "skills/x/scripts/tool.py", content: "#!/bin/sh\nplain utf8 rewrite\n"}]);
    const res = applyCandidate({candidates: [winner], winner, runId: "binary-1", config: APPLY, agentDir, ledgerPath: ledger});
    expect(res.decision).toBe("apply-failed");
    // Byte-exact restore of the non-UTF-8 prior content.
    expect(readFileSync(scriptPath)).toEqual(originalBytes);
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
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

    const reverted = revertByRunId("rev-1", {agentDir, ledgerPath: ledger});
    expect(reverted.ok).toBe(true);
    expect(reverted.method).toBe("revert");
    expect(reverted.sha).toBe(applied.sha);
    expect(git(agentDir, ["rev-parse", "HEAD^{tree}"]).stdout.trim()).toBe(treeBefore);
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(existsSync(join(agentDir, "skills/y/SKILL.md"))).toBe(false);
    // Fix 11: kind "revert" ledger entry with the reverted outcome.
    const revertEntries = readLedger(ledger).filter((e) => e.kind === "revert");
    expect(revertEntries).toHaveLength(1);
    expect(revertEntries[0]!.decision).toBe("reverted");
    expect(revertEntries[0]!.sha).toBe(applied.sha);
    expect(revertEntries[0]!.method).toBe("revert");
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

    const reverted = revertByRunId("rev-2", {agentDir, ledgerPath: ledger});
    expect(reverted.ok).toBe(true);
    expect(reverted.method).toBe("checkout-fallback");
    // Loop-managed path restored to the pre-apply content.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
  });

  test("checkout fallback succeeds when prompts/ is ABSENT from the apply commit's parent tree (review fix)", () => {
    const root = tempRoot("revert-noprompts-");
    // Seed repo has NO prompts/ — a pre-S8-style apply commit's parent tree.
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const template = "# Ask mode\n\nUse {{QUESTION}} wisely.\n";
    const winner = candidate([
      {path: "AGENTS.md", content: AGENTS_NEW},
      {path: "prompts/mode-ask.md", content: template},
    ]);
    const applied = applyCandidate({candidates: [winner], winner, runId: "rev-np", config: APPLY, agentDir, ledgerPath: ledger});
    expect(applied.decision).toBe("applied");
    // Precondition: prompts/ is NOT in the apply commit's parent tree, so the
    // ls-tree filter must drop it from the fallback checkout pathspecs.
    const parentTree = git(agentDir, ["ls-tree", "--name-only", `${applied.sha}^`]).stdout;
    expect(parentTree).not.toContain("prompts");
    // Diverge the applied line so `git revert` conflicts.
    writeFileSync(join(agentDir, "AGENTS.md"), "# divergent manual edit after apply\n");
    git(agentDir, ["add", "AGENTS.md"]);
    git(agentDir, ["commit", "-q", "-m", "manual post-apply edit"]);

    const reverted = revertByRunId("rev-np", {agentDir, ledgerPath: ledger});
    expect(reverted.ok).toBe(true);
    expect(reverted.method).toBe("checkout-fallback");
    // Managed path in the parent tree restored to pre-apply content.
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# base agents\n");
    // prompts/ was never in the parent tree — left at its applied state.
    expect(readFileSync(join(agentDir, "prompts", "mode-ask.md"), "utf8")).toBe(template);
    expect(git(agentDir, ["status", "--porcelain"]).stdout).toBe("");
  });

  test("refuses an unknown runId and never touches other commits", () => {
    const root = tempRoot("revert-none-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const headBefore = git(agentDir, ["rev-parse", "HEAD"]).stdout.trim();
    const res = revertByRunId("no-such-run", {agentDir, ledgerPath: ledger});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no harness-loop commit found");
    expect(git(agentDir, ["rev-parse", "HEAD"]).stdout.trim()).toBe(headBefore);
    const revertEntries = readLedger(ledger).filter((e) => e.kind === "revert");
    expect(revertEntries[0]!.decision).toBe("revert-failed");
  });

  test("dirty tree under AGENTS.md/skills → revert refused, files untouched", () => {
    const root = tempRoot("revert-dirty-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([{path: "AGENTS.md", content: AGENTS_NEW}]);
    const applied = applyCandidate({candidates: [winner], winner, runId: "rev-dirty", config: APPLY, agentDir, ledgerPath: ledger});
    expect(applied.decision).toBe("applied");
    const headAfterApply = git(agentDir, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(agentDir, "AGENTS.md"), "# uncommitted manual edit\n"); // pre-dirty

    const reverted = revertByRunId("rev-dirty", {agentDir, ledgerPath: ledger});
    expect(reverted.ok).toBe(false);
    expect(reverted.error).toContain("working tree dirty under AGENTS.md/skills/prompts/agents/extensions — resolve before apply");
    // No revert commit was made and the manual edit is untouched.
    expect(git(agentDir, ["rev-parse", "HEAD"]).stdout.trim()).toBe(headAfterApply);
    expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# uncommitted manual edit\n");
    const revertEntries = readLedger(ledger).filter((e) => e.kind === "revert");
    expect(revertEntries[0]!.decision).toBe("revert-failed");
    expect(revertEntries[0]!.sha).toBe(applied.sha);
  });

  test("revert is refused while the apply lock is held", () => {
    const root = tempRoot("revert-lock-");
    const agentDir = tempAgentRepo(root);
    const ledger = join(root, "history.jsonl");
    const winner = candidate([{path: "AGENTS.md", content: AGENTS_NEW}]);
    const applied = applyCandidate({candidates: [winner], winner, runId: "rev-lock", config: APPLY, agentDir, ledgerPath: ledger});
    expect(applied.decision).toBe("applied");
    writeFileSync(join(agentDir, ".harness-loop.apply.lock"), "999999\n");

    const reverted = revertByRunId("rev-lock", {agentDir, ledgerPath: ledger});
    expect(reverted.ok).toBe(false);
    expect(reverted.error).toContain("another apply in progress");
    expect(existsSync(join(agentDir, ".harness-loop.apply.lock"))).toBe(true);
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
