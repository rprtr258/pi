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
  buildLedgerDigest,
  buildPrompt,
  candidateFingerprint,
  extractJsonArray,
  includeSkills,
  includeSubagents,
  includeTemplates,
  loadBaselineFromRunDir,
  MAX_FILES_PER_CANDIDATE,
  proposalFingerprintOf,
  propose,
  validateCandidate,
  type CallModel,
  type ProposeInput,
} from "./proposer.ts";
import {surfaceKind} from "./surface.ts";
import type {ComponentSnapshot} from "./stage.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

/** Build a ComponentSnapshot (kinds-generic shape, S8) from legacy-style parts. */
function snap(
  agentsMd: string,
  skills: Array<{relPath: string; content: string}> = [],
  templates: Array<{relPath: string; content: string}> = [],
  subagents: Array<{relPath: string; content: string}> = [],
): ComponentSnapshot {
  return {
    kinds: {
      agents: agentsMd === "" ? [] : [{relPath: "AGENTS.md", content: agentsMd}],
      skills: skills.map((s) => ({relPath: `skills/${s.relPath}`, content: s.content})),
      templates: templates.map((t) => ({relPath: t.relPath, content: t.content})),
      subagents: subagents.map((t) => ({relPath: t.relPath, content: t.content})),
      extensions: [],
      mcp: [],
    },
  };
}

const TEMPLATE = [
  "# Role",
  "{{COMPONENTS}}",
  "{{BASELINE}}",
  "{{FOCUS}}",
  "{{LEDGER}}",
  "{{HARNESS_FINDINGS}}",
].join("\n");

function makeInput(overrides: Partial<ProposeInput> = {}): ProposeInput {
  return {
    snapshot: snap("# Agents rules\n", [
      {relPath: "cli-jq/SKILL.md", content: "---\nname: cli-jq\ndescription: jq helper.\n---\nbody"},
    ]),
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
    const skillsCap = surfaceKind("skills").caps.maxFileBytes;
    const candidate = {rationale: "r", edits: [{path: "skills/big/SKILL.md", content: "x".repeat(skillsCap + 1)}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes(`cap ${skillsCap}`))).toBe(true);
  });

  test("AGENTS.md over 48KB rejected", async () => {
    const agentsCap = surfaceKind("agents").caps.maxFileBytes;
    const candidate = {rationale: "r", edits: [{path: "AGENTS.md", content: "x".repeat(agentsCap + 1)}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes(`cap ${agentsCap}`))).toBe(true);
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

  test("AGENTS.md delete (content null) rejected", async () => {
    const {callModel} = fakeModel([JSON.stringify([{rationale: "r", edits: [{path: "AGENTS.md", content: null}]}])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes("AGENTS.md cannot be deleted or emptied"))).toBe(true);
  });

  test("AGENTS.md empty rewrite (0-byte content) rejected", async () => {
    expect(validateCandidate([{path: "AGENTS.md", content: ""}]).some((r) => r.includes("AGENTS.md cannot be deleted or emptied"))).toBe(true);
    expect(validateCandidate([{path: "AGENTS.md", content: "   \n\t"}]).some((r) => r.includes("AGENTS.md cannot be deleted or emptied"))).toBe(true);
  });
});

describe("validation bypass attempts", () => {
  test("trailing space in path rejected", () => {
    const reasons = validateCandidate([{path: "skills/cli-jq/SKILL.md ", content: "x"}]);
    expect(reasons.some((r) => r.includes("path outside the allowlist"))).toBe(true);
  });

  test("embedded newline in path rejected", () => {
    const reasons = validateCandidate([{path: "AGENTS.md\n", content: "x"}]);
    expect(reasons.some((r) => r.includes("path outside the allowlist"))).toBe(true);
  });

  test("backslash-separated path rejected", () => {
    const reasons = validateCandidate([{path: "skills\\cli-jq\\SKILL.md", content: "x"}]);
    expect(reasons.some((r) => r.includes("path outside the allowlist"))).toBe(true);
  });

  test("unicode homoglyph path (Cyrillic 'а') rejected", () => {
    const reasons = validateCandidate([{path: "skills/аgent/SKILL.md", content: "x"}]);
    expect(reasons.some((r) => r.includes("path outside the allowlist"))).toBe(true);
  });

  test("skills/a/scripts/.. rejected as traversal", () => {
    const reasons = validateCandidate([{path: "skills/a/scripts/..", content: "x"}]);
    expect(reasons.some((r) => r.includes("traversal"))).toBe(true);
  });
});

describe("includeSkills", () => {
  test("AGENTS.md-referenced skills come first; budget respected greedily", () => {
    const snapshot = snap("Use the zz-zeta skill for Z work.", [
      {relPath: "a/other/SKILL.md", content: "a".repeat(50)},
      {relPath: "zz-zeta/SKILL.md", content: "z".repeat(60)},
      {relPath: "zz-zeta/scripts/run.sh", content: "s".repeat(30)},
    ]);
    const inclusion = includeSkills(snapshot, 100);
    // zz-zeta files (referenced) first, then relPath ascending; the second
    // zz-zeta file fits in the remaining budget (greedy, not stop-on-first).
    expect(inclusion.included.map((s) => s.relPath)).toEqual(["zz-zeta/SKILL.md", "zz-zeta/scripts/run.sh"]);
    expect(inclusion.includedChars).toBe(90);
  });

  test("manifest covers ALL files with sizes and descriptions", () => {
    const snapshot = snap("", [
      {relPath: "a/SKILL.md", content: "---\nname: a\ndescription: The a skill.\n---\nbody"},
      {relPath: "b/scripts/tool.py", content: "print()"},
    ]);
    const inclusion = includeSkills(snapshot, 1000);
    expect(inclusion.manifestLines).toEqual([
      "- a/SKILL.md (46B) — The a skill.",
      "- b/scripts/tool.py (7B)",
    ]);
  });
});

describe("per-kind validation routing (S8 surface registry)", () => {
  test("template edit routes to the template validator: unbalanced {{ rejected, balanced accepted", () => {
    const unbalanced = validateCandidate([{path: "prompts/mode-ask.md", content: "# Mode\nUse {{MODE here"}]);
    expect(unbalanced.some((r) => r.includes("unbalanced {{ without }}"))).toBe(true);
    // Balanced {{...}} tokens and frontmatter-less content are accepted.
    expect(validateCandidate([{path: "prompts/mode-ask.md", content: "# Mode\nUse {{MODE}} wisely."}])).toEqual([]);
  });

  test("subagent edit routes to the subagent validator: missing name/description rejected", () => {
    const missingName = validateCandidate([{path: "agents/worker.md", content: "---\ndescription: Does work.\n---\nbody"}]);
    expect(missingName.some((r) => r.includes('frontmatter field "name" is required'))).toBe(true);
    const missingDescription = validateCandidate([{path: "agents/worker.md", content: "---\nname: worker\n---\nbody"}]);
    expect(missingDescription.some((r) => r.includes('frontmatter field "description" is required'))).toBe(true);
    expect(validateCandidate([{path: "agents/worker.md", content: "---\nname: worker\ndescription: Does work.\n---\nbody"}])).toEqual([]);
    // No frontmatter at all is rejected too.
    expect(validateCandidate([{path: "agents/worker.md", content: "# just text"}]).length).toBeGreaterThan(0);
  });

  test("chain.md subagent paths rejected by the allowlist", () => {
    expect(validateCandidate([{path: "agents/flow.chain.md", content: "---\nname: x\ndescription: y\n---\nbody"}]).some((r) => r.includes("path outside the allowlist"))).toBe(true);
  });

  test("skills and AGENTS.md routing unchanged: skills edit has no content rules; AGENTS.md delete still rejected", () => {
    expect(validateCandidate([{path: "skills/new-skill/SKILL.md", content: "anything goes"}])).toEqual([]);
    expect(validateCandidate([{path: "AGENTS.md", content: null}]).some((r) => r.includes("AGENTS.md cannot be deleted or emptied"))).toBe(true);
  });

  test("per-kind caps: template over 100KB rejected; AGENTS.md over 48KB rejected", () => {
    const templatesCap = surfaceKind("templates").caps.maxFileBytes;
    const agentsCap = surfaceKind("agents").caps.maxFileBytes;
    expect(validateCandidate([{path: "prompts/big.md", content: "x".repeat(templatesCap + 1)}]).some((r) => r.includes(`cap ${templatesCap}`))).toBe(true);
    expect(validateCandidate([{path: "AGENTS.md", content: "x".repeat(agentsCap + 1)}]).some((r) => r.includes(`cap ${agentsCap}`))).toBe(true);
  });

  test("proposer end-to-end: invalid template candidate rejected through propose()", async () => {
    const candidate = {rationale: "r", edits: [{path: "prompts/broken.md", content: "open {{ brace"}]};
    const {callModel} = fakeModel([JSON.stringify([candidate])]);
    const result = await propose(makeInput(), {callModel, systemPromptTemplate: TEMPLATE});
    expect(result.candidates[0]!.verdict).toBe("rejected");
    expect(result.candidates[0]!.reasons.some((r) => r.includes("unbalanced {{ without }}"))).toBe(true);
  });
});

describe("template + subagent inclusion (S8)", () => {
  test("includeTemplates: manifest covers all, contents greedy under budget, first-line description", () => {
    const snapshot = snap("", [], [
      {relPath: "prompts/a-mode.md", content: "# A mode\n\nbody"},
      {relPath: "prompts/b-mode.md", content: "b".repeat(30)},
    ]);
    const inclusion = includeTemplates(snapshot, 20);
    expect(inclusion.manifestLines).toEqual([
      "- prompts/a-mode.md (14B) — # A mode",
      "- prompts/b-mode.md (30B) — " + "b".repeat(30),
    ]);
    expect(inclusion.included.map((f) => f.relPath)).toEqual(["prompts/a-mode.md"]);
    expect(inclusion.includedChars).toBe(14);
  });

  test("includeSubagents: manifest uses the frontmatter description", () => {
    const snapshot = snap("", [], [], [
      {relPath: "agents/miner.md", content: "---\nname: miner\ndescription: Mines logs.\n---\nbody"},
    ]);
    const inclusion = includeSubagents(snapshot, 1000);
    expect(inclusion.manifestLines).toEqual(["- agents/miner.md (49B) — Mines logs."]);
    expect(inclusion.included).toHaveLength(1);
  });
});

describe("buildPrompt (S8 components)", () => {
  test("includes templates and subagents in the components section", () => {
    const snapshot = snap("", [], [{relPath: "prompts/mode-ask.md", content: "# Ask mode\n"}], [
      {relPath: "agents/scout.md", content: "---\nname: scout\ndescription: Fast recon.\n---\nbody"},
    ]);
    const prompt = buildPrompt(makeInput({snapshot}), TEMPLATE);
    expect(prompt.system).toContain("## Prompt templates manifest (ALL 1");
    expect(prompt.system).toContain("- prompts/mode-ask.md (11B) — # Ask mode");
    expect(prompt.system).toContain("### templates-source: prompts/mode-ask.md");
    expect(prompt.system).toContain("## Subagent manifest (ALL 1");
    expect(prompt.system).toContain("- agents/scout.md (");
    expect(prompt.system).toContain("— Fast recon.");
    expect(prompt.system).toContain("### subagents-source: agents/scout.md");
  });

  test("empty template/subagent kinds render '(none found)' manifests", () => {
    const prompt = buildPrompt(makeInput({snapshot: snap("# rules\n")}), TEMPLATE);
    expect(prompt.system).toContain("## Prompt templates manifest (ALL 0");
    expect(prompt.system).toContain("(none found)");
    expect(prompt.system).toContain("## Subagent manifest (ALL 0");
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
    const prompt = buildPrompt(makeInput({snapshot: snap("", [{relPath: "a/SKILL.md", content: "x"}])}), TEMPLATE);
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

  test("single-pass substitution: $-patterns and placeholders in content stay literal", () => {
    const tricky = "value $& $' $` {{LEDGER}}";
    const prompt = buildPrompt(makeInput({snapshot: snap(tricky)}), TEMPLATE);
    // The bytes appear verbatim in the components section (AGENTS.md full text).
    expect(prompt.system).toContain(tricky);
    // Exactly ONE ledger section — the template's own placeholder, not the
    // injected {{LEDGER}} (which must remain unsubstituted, appearing once).
    expect(prompt.system.split("(no rejected proposals recorded yet)").length - 1).toBe(1);
    expect(prompt.system.split("{{LEDGER}}").length - 1).toBe(1);
  });

  test("Step 11 FOCUS section: targeted-iteration failing tasks rendered verbatim; absent focus leaves no FOCUS section", () => {
    const failing = {task: "smoke-x", category: "smoke", pass: false, durationMs: 10, tokens: 5, checkerOutput: "FAIL: boom"};
    const focused = buildPrompt(makeInput({focus: {tasks: [failing], note: "improve the failing subset"}}), TEMPLATE);
    expect(focused.system).toContain("## FOCUS — targeted iteration (improve the failing subset)");
    expect(focused.system).toContain("### smoke-x (FAIL)");
    expect(focused.system).toContain("FAIL: boom");
    expect(focused.system).not.toContain("{{FOCUS}}");
    expect(focused.user).toContain("TARGETED iteration");

    const unfocused = buildPrompt(makeInput(), TEMPLATE);
    expect(unfocused.system).not.toContain("## FOCUS");
    expect(unfocused.system).not.toContain("{{FOCUS}}");
    expect(unfocused.user).not.toContain("TARGETED");
  });

  test("baseline table escapes pipes in cells; checker output uses a 4-backtick fence", () => {
    const prompt = buildPrompt(
      makeInput({
        baseline: {
          tasks: [{task: "weird | task", category: "a|b", pass: false, durationMs: 1, tokens: 1, checkerOutput: "FAIL\n```nested```\nboom"}],
          aggregate: {passCount: 0, total: 1},
        },
      }),
      TEMPLATE,
    );
    expect(prompt.system).toContain("| weird \\| task | a\\|b |");
    expect(prompt.system).toContain("````\nFAIL\n```nested```\nboom\n````");
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
    for (const placeholder of ["{{COMPONENTS}}", "{{BASELINE}}", "{{FOCUS}}", "{{LEDGER}}", "{{HARNESS_FINDINGS}}"]) {
      expect(text).toContain(placeholder);
    }
    // S8 contracts: template invocation syntax + subagent frontmatter rules
    // are part of the prompt the Proposer sees.
    expect(text).toContain("{{");
    expect(text).toContain("unbalanced");
    expect(text).toContain("`description:` is REQUIRED");
    const lines = text.split("\n").length;
    // 80–120 (S8) extended to 130 in Step 9a: the extensions/code-gate
    // contract the Proposer must see adds ~10 lines (kept as tight as the
    // contract allows; still a bloat guard, not a hard spec).
    expect(lines).toBeGreaterThanOrEqual(80);
    expect(lines).toBeLessThanOrEqual(130);
  });
});
