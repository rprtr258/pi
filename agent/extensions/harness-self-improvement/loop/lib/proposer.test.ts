#!/usr/bin/env bun
/**
 * Unit tests for the Proposer (proposer.ts): prompt assembly, JSON
 * extraction, repair retry, and the validation pipeline — all against a
 * fake callModel. No model calls, no real agent dir.
 *
 *   bun test loop/lib/proposer.test.ts
 */
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {
  AGENTS_MD_CAP_BYTES,
  buildLedgerDigest,
  buildPrompt,
  candidateFingerprint,
  extractJsonArray,
  FILE_CAP_BYTES,
  includeSkills,
  loadBaselineFromRunDir,
  MAX_FILES_PER_CANDIDATE,
  proposalFingerprintOf,
  propose,
  validateCandidate,
  type CallModel,
  type ProposeInput,
} from "./proposer.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

const TEMPLATE = [
  "# Role",
  "{{COMPONENTS}}",
  "{{BASELINE}}",
  "{{LEDGER}}",
  "{{HARNESS_FINDINGS}}",
].join("\n");

function makeInput(overrides: Partial<ProposeInput> = {}): ProposeInput {
  return {
    snapshot: {
      agentsMd: "# Agents rules\n",
      skills: [{relPath: "cli-jq/SKILL.md", content: "---\nname: cli-jq\ndescription: jq helper.\n---\nbody"}],
    },
    baseline: {
      tasks: [{task: "jq-config-merge", category: "jq", pass: false, durationMs: 1000, tokens: 10, checkerOutput: "FAIL: wrong output"}],
      aggregate: {passCount: 11, total: 12},
    },
    ledgerDigest: [],
    ...overrides,
  };
}

const VALID_CANDIDATE = {
  rationale: "tighten jq guidance",
  edits: [{path: "AGENTS.md", content: "# Agents rules\nRead cli-jq skill before JSON work.\n"}],
};

/** Fake model returning the given texts in order; records calls. */
function fakeModel(texts: string[]): {callModel: CallModel; calls: Array<{system: string; user: string; options?: {temperature?: number}}>} {
  const calls: Array<{system: string; user: string; options?: {temperature?: number}}> = [];
  const callModel: CallModel = async (system, user, options) => {
    calls.push({system, user, options});
    const next = calls.length <= texts.length ? texts[calls.length - 1]! : texts[texts.length - 1]!;
    return next;
  };
  return {callModel, calls};
}

describe("extractJsonArray", () => {
  test("extracts fenced ```json blocks", () => {
    const text = `Here is my proposal:\n\`\`\`json\n[${JSON.stringify(VALID_CANDIDATE)}]\n\`\`\`\nDone.`;
    const result = extractJsonArray(text);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.value)).toBe(true);
  });

  test("extracts bare arrays", () => {
    const text = `Sure! [${JSON.stringify(VALID_CANDIDATE)}] hope this helps`;
    const result = extractJsonArray(text);
    expect(result.ok).toBe(true);
  });

  test("fails with an error on non-JSON output", () => {
    const result = extractJsonArray("I cannot comply.");
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("fails when the fenced block is not a JSON array", () => {
    const result = extractJsonArray("```\n{\"not\": \"an array\"}\n```");
    expect(result.ok).toBe(false);
  });
});

describe("propose", () => {
  test("valid candidate accepted", async () => {
    const {callModel, calls} = fakeModel([JSON.stringify([VALID_CANDIDATE])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.parseError).toBeUndefined();
    expect(result.repairRetried).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.verdict).toBe("accepted");
    expect(result.candidates[0]!.reasons).toEqual([]);
    expect(result.candidates[0]!.fingerprint).toBe(candidateFingerprint(VALID_CANDIDATE.edits));
    // The prompt carries the placeholder-substituted system prompt.
    expect(calls[0]!.system).toContain("# Agents rules");
    expect(calls[0]!.system).toContain("FAIL: wrong output");
  });

  test("fenced JSON extracted and accepted", async () => {
    const {callModel} = fakeModel(["```json\n" + JSON.stringify([VALID_CANDIDATE]) + "\n```"]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("accepted");
  });

  test("non-JSON triggers ONE repair retry; repaired output accepted", async () => {
    const {callModel, calls} = fakeModel([
      "Sorry, here is my proposal: it edits files.",
      JSON.stringify([VALID_CANDIDATE]),
    ]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.repairRetried).toBe(true);
    expect(result.parseError).toBeUndefined();
    expect(result.candidates[0]!.verdict).toBe("accepted");
    expect(calls).toHaveLength(2);
    // The repair call contains the malformed output and the parse error.
    expect(calls[1]!.user).toContain("not valid JSON");
    expect(calls[1]!.user).toContain("Sorry, here is my proposal");
  });

  test("non-JSON that survives repair is rejected with parseError", async () => {
    const {callModel} = fakeModel(["still not json", "still not json 2"]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.repairRetried).toBe(true);
    expect(result.candidates).toHaveLength(0);
    expect(result.parseError).toContain("unparseable after repair retry");
  });

  test("path traversal ../ rejected", async () => {
    const candidate = {rationale: "r", edits: [{path: "skills/../../AGENTS.md", content: "x"}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes("traversal"))).toBe(true);
  });

  test("absolute path rejected", async () => {
    const candidate = {rationale: "r", edits: [{path: "/home/rprtr258/.pi/agent/AGENTS.md", content: "x"}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes("absolute path"))).toBe(true);
  });

  test("case variant and disallowed location rejected", async () => {
    const reasons = validateCandidate([
      {path: "skills/CLI-JQ/SKILL.md", content: "x"},
      {path: "agents.md", content: "x"},
      {path: "skills/cli-jq/other.md", content: "x"},
    ]);
    expect(reasons).toHaveLength(3);
  });

  test("more than 6 files rejected", async () => {
    const edits = Array.from({length: MAX_FILES_PER_CANDIDATE + 1}, (_, i) => ({
      path: `skills/skill-${i}/SKILL.md`,
      content: "x",
    }));
    const {callModel} = fakeModel([JSON.stringify([{rationale: "r", edits}])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes("max 6"))).toBe(true);
  });

  test("file over 100KB rejected", async () => {
    const candidate = {rationale: "r", edits: [{path: "skills/big/SKILL.md", content: "x".repeat(FILE_CAP_BYTES + 1)}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes(`cap ${FILE_CAP_BYTES}`))).toBe(true);
  });

  test("AGENTS.md over 48KB rejected", async () => {
    const candidate = {rationale: "r", edits: [{path: "AGENTS.md", content: "x".repeat(AGENTS_MD_CAP_BYTES + 1)}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes(`cap ${AGENTS_MD_CAP_BYTES}`))).toBe(true);
  });

  test("duplicate combined fingerprint vs ledgerDigest rejected", async () => {
    const c1 = {rationale: "a", edits: [{path: "AGENTS.md", content: "A"}]};
    const c2 = {rationale: "b", edits: [{path: "skills/cli-jq/SKILL.md", content: "B"}]};
    const fp = proposalFingerprintOf([c1, c2]);
    const {callModel} = fakeModel([JSON.stringify([c1, c2])]);
    const result = await propose(makeInput({ledgerDigest: ["deadbeef", fp]}), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.proposalFingerprint).toBe(fp);
    expect(result.candidates.every((c) => c.verdict === "rejected")).toBe(true);
    expect(result.candidates.every((c) => c.reasons.some((r) => r.includes("duplicate of rejected proposal")))).toBe(true);
  });

  test("proposal with 0 or >3 candidates rejected", async () => {
    const four = Array.from({length: 4}, () => VALID_CANDIDATE);
    const {callModel} = fakeModel([JSON.stringify(four)]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates.every((c) => c.verdict === "rejected")).toBe(true);
    expect(result.candidates.every((c) => c.reasons.some((r) => r.includes("1–3 required")))).toBe(true);
  });
});

describe("includeSkills", () => {
  test("AGENTS.md-referenced skills come first; budget respected greedily", () => {
    const snapshot = {
      agentsMd: "Use the zz-zeta skill for Z work.",
      skills: [
        {relPath: "a/other/SKILL.md", content: "a".repeat(50)},
        {relPath: "zz-zeta/SKILL.md", content: "z".repeat(60)},
        {relPath: "zz-zeta/scripts/run.sh", content: "s".repeat(30)},
      ],
    };
    const inclusion = includeSkills(snapshot, 100);
    // zz-zeta files (referenced) first, then relPath ascending; the second
    // zz-zeta file fits in the remaining budget (greedy, not stop-on-first).
    expect(inclusion.included.map((s) => s.relPath)).toEqual(["zz-zeta/SKILL.md", "zz-zeta/scripts/run.sh"]);
    expect(inclusion.includedChars).toBe(90);
  });

  test("manifest covers ALL files with sizes and descriptions", () => {
    const snapshot = {
      agentsMd: "",
      skills: [
        {relPath: "a/SKILL.md", content: "---\nname: a\ndescription: The a skill.\n---\nbody"},
        {relPath: "b/scripts/tool.py", content: "print()"},
      ],
    };
    const inclusion = includeSkills(snapshot, 1000);
    expect(inclusion.manifestLines).toEqual([
      "- a/SKILL.md (46B) — The a skill.",
      "- b/scripts/tool.py (7B)",
    ]);
  });
});

describe("buildLedgerDigest", () => {
  test("collects proposal fingerprints from proposal-rejected entries, last 20", () => {
    const entries = [
      {runId: "r1", ts: "t", kind: "baseline", scores: {passCount: 1, total: 1}, usage: {totalTokens: 0}, fingerprint: "ff1"},
      {runId: "r2", ts: "t", kind: "proposal-rejected", proposalFingerprint: "fp2", scores: {passCount: 1, total: 1}, usage: {totalTokens: 0}},
      {runId: "r3", ts: "t", kind: "candidate", decision: "rejected", proposalFingerprint: "fp3", scores: {passCount: 1, total: 1}, usage: {totalTokens: 0}},
      {runId: "r4", ts: "t", kind: "proposal-rejected", scores: {passCount: 1, total: 1}, usage: {totalTokens: 0}},
    ];
    expect(buildLedgerDigest(entries)).toEqual(["fp2", "fp3"]);
    expect(buildLedgerDigest(entries, 1)).toEqual(["fp3"]);
  });
});

describe("buildPrompt", () => {
  test("mentions un-included skills are not editable this round", () => {
    const prompt = buildPrompt(makeInput({snapshot: {agentsMd: "", skills: [{relPath: "a/SKILL.md", content: "x"}]}}), TEMPLATE);
    expect(prompt.system).toContain("a/SKILL.md");
    expect(prompt.system).toContain("manifest-only");
  });

  test("all-pass baseline says there are no failures to fix", () => {
    const prompt = buildPrompt(
      makeInput({baseline: {tasks: [{task: "t", category: "c", pass: true, durationMs: 1, tokens: 1, checkerOutput: "PASS"}], aggregate: {passCount: 1, total: 1}}}),
      TEMPLATE,
    );
    expect(prompt.system).toContain("All tasks pass");
  });
});

describe("loadBaselineFromRunDir", () => {
  test("reads tasks/*.json into BaselineData with aggregate", () => {
    const root = mkdtempSync(join(tmpdir(), "proposer-test-"));
    tmpRoots.push(root);
    mkdirSync(join(root, "tasks"));
    writeFileSync(join(root, "tasks", "a.json"), JSON.stringify({task: "a", category: "git", pass: true, durationMs: 5, usage: {totalTokens: 7}, checkerOutput: "PASS"}));
    writeFileSync(join(root, "tasks", "b.json"), JSON.stringify({task: "b", category: "jq", pass: false, durationMs: 6, usage: {totalTokens: 8}, checkerOutput: "FAIL: no"}));
    const data = loadBaselineFromRunDir(root);
    expect(data.tasks).toHaveLength(2);
    expect(data.aggregate).toEqual({passCount: 1, total: 2});
    expect(data.tasks[1]).toEqual({task: "b", category: "jq", pass: false, durationMs: 6, tokens: 8, checkerOutput: "FAIL: no"});
  });
});

describe("system prompt template", () => {
  test("proposer.md contains all placeholders and is within the 80–120 line spec", () => {
    const dir = new URL("../prompts/proposer.md", import.meta.url);
    const text = readFileSync(dir, "utf8");
    for (const placeholder of ["{{COMPONENTS}}", "{{BASELINE}}", "{{LEDGER}}", "{{HARNESS_FINDINGS}}"]) {
      expect(text).toContain(placeholder);
    }
    const lines = text.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(80);
    expect(lines).toBeLessThanOrEqual(120);
  });
});
