---
name: si-skill-creator
description: Create new skills, edit and improve existing skills, and verify, benchmark, or quality-check skills before deployment. Use when the user wants to create, write, or build a skill, fix or optimize an existing skill, run manual or automatic skill benchmarks or evals, test skill triggering, measure skill quality, or package a skill for distribution.
---

# Skill Creator

Create, test, benchmark, and quality-check skills for pi. A skill is a reference document that makes an agent better at a recurring task. Three scenarios cover the lifecycle — find where the user is and jump in, but never ship an untested skill (the Iron Law).

## Scenario router

- **Create a new skill** → [Scenario A](#scenario-a--create)
- **Edit, fix, or improve an existing skill** → [Editing an existing skill](#editing-an-existing-skill)
- **Test or benchmark a skill (manual or automatic)** → [Scenario B](#scenario-b--test-and-benchmark)
- **Measure quality, triggering, or token cost; decide "is it ready?"** → [Scenario C](#scenario-c--measure-and-quality-check)
- **Package a finished skill** → [Packaging](#packaging)

## The Iron Law

**No skill ships without a failing test first.** Testing a skill is TDD applied to process documentation: RED = agent fails a pressure scenario WITHOUT the skill (record what it does and verbatim rationalizations); GREEN = write the minimal SKILL.md addressing those failures, re-run, agent complies; REFACTOR = agent finds a loophole → add an explicit counter → re-test. Full methodology and scenario formats: [references/testing-skills-with-subagents.md](references/testing-skills-with-subagents.md). Worked example: [examples/AGENTS_MD_TESTING.md](examples/AGENTS_MD_TESTING.md).

## Universal rules

1. **Description = trigger contract.** It's the ONLY thing the agent sees when deciding to read the skill. Lead with specific, pushy "Use when..." triggers (over-trigger is easier to fix than under-trigger); one clause on what it provides. NEVER compress workflow steps into it — tested agents follow the summary instead of reading the skill, then miss details. Limit 1024 chars; aim 300–500.
2. **Token budget.** Body under 500 lines (aim under 200). Push detail into `references/`, `scripts/`, `assets/` and link them — the body loads into context, references only when read.
3. **Naming.** Directory name = skill name, lowercase-hyphenated, ≤64 chars, gerund preferred (`processing-pdfs`). When editing an existing skill, preserve its original name — users may have automations referencing it.
4. **Keyword coverage.** Include both domain terms users would say AND concrete technical keywords ("xlsx", "OAuth callback") in the description — it's the only search surface.
5. **Never claim a skill exists without evidence.** "Skill not in your context. Create skill files now." — false without evidence; don't do it.
6. **Principle of lack of surprise.** Skills get shared beyond their creator: no secrets, personal data, or instructions the sharer wouldn't want broadcast.
7. **Match the user's jargon level.** If they say "skills", say "skills". Use established domain names for concepts.

## Scenario A — Create

### When a skill is worth creating

**Create when:** the task recurs, succeeds reliably today, and has a specific workflow worth documenting; it would be reused across prompts/sessions/projects; you know the domain (from conversation, docs, or experimentation) — write what you learned down. **Don't:** single-task prompt, or no established procedure — a failing workflow needs debugging first, not documentation.

**Mechanical check:** if the task needs deterministic code (parsing, math, extraction), write a **script** and reference it — don't document instructions an LLM executes unreliably. Over ~150 lines or 2 domains of instructions → split into reference files.

### Step 1 — Capture intent

Ask the user (skip questions already answered): what should this skill enable or change? When should it trigger — and NOT trigger? Show 2–3 example prompts that should invoke it. What's the core workflow and required context? If the user says "turn this into a skill", extract requirements from the conversation and confirm them back.

### Step 2 — RED: write failing tests first

Verify agents actually fail without the skill:

1. **Write 3–6 pressure scenarios** — hard ones that tempt the agent to skip or half-do the work (time pressure, explicit request to skip steps, partial context). Match emphasis to skill type: discipline (TDD, security) → pressure to skip + rationalization resistance; technique (how-to) → correct procedure under realistic task; pattern (code/config to adapt) → adapts template, follows conventions; reference (API/knowledge) → finds and applies the right entry.
2. **Run each scenario WITHOUT the skill** — a fresh subagent (pi's subagent tool) per scenario, or a standalone `pi -p` session. Record failures and verbatim rationalizations.
3. If nothing fails, the scenarios are too easy or the skill doesn't need to exist.

### Step 3 — GREEN: write the minimal skill

Write the smallest SKILL.md that makes the RED scenarios pass. Skeleton, writing patterns (imperative, explain-why, concrete, consistent terminology), and what belongs in scripts/references/assets/flowcharts: [references/authoring-patterns.md](references/authoring-patterns.md).

Non-negotiables: imperative steps ("Run X. Then do Y"), rules with reasons (they survive edge cases), one excellent example, one concept = one word.

### Step 4 — REFACTOR: close loopholes

Re-run the scenarios. For every rationalization used ("just this once", "task too small", "running low on context"): add a rationalization-table row (| Rationalization | Reality |), add explicit "If tempted to skip X, do Y" counters where the skill is weakest, define boundary behavior, and test the skill's spirit — give a scenario where following the letter produces a bad outcome; the agent should refuse.

### Editing an existing skill

Same loop: snapshot the current skill (comparison + rollback), run scenarios against it, find where it fails or drifts, fix, REFACTOR. Preserve the skill's name and frontmatter `name`. If the description changed, run the trigger check from Scenario C.

## Scenario B — Test and benchmark

### How skill triggering works

The agent consults a skill only when a task is substantive enough that the skill's expected benefit outweighs reading it — trivial one-liner tasks never trigger. Eval queries must be realistic, self-contained tasks, not chat.

### Manual benchmarking

Best for quick iteration and qualitative signal. Run with-skill and baseline **in the same turn** (identical conditions):

1. Write 5–10 eval prompts (task variations + one adversarial edge case) and expected behaviors.
2. Per prompt, spawn two fresh subagents (pi's subagent tool) in parallel: **with-skill** (task + skill path, read SKILL.md first) and **baseline** (task alone, no skill mention).
3. While they run, write **assertions** — must-contain items, MUST-NOTs, and skill-following specifics.
4. Compare outputs to assertions; for quantitative grading spawn a grader per [agents/grader.md](agents/grader.md) (writes `grading.json`: `text`, `passed`, `evidence` per assertion). For blind A/B comparison use [agents/comparator.md](agents/comparator.md); [agents/analyzer.md](agents/analyzer.md) dissects the winner.

### Automatic benchmarking

Scripted and repeatable; all tools run on pi (`pi -p` headless sessions) and inherit the session's model via `$PI_MODEL`/`$PI_PROVIDER`, or take `--model`/`--provider`. Workspace layout, run/aggregate/review commands, and output schemas: [references/benchmarking-tooling.md](references/benchmarking-tooling.md).

### Improving from feedback

Generalize (would future agents benefit?), keep it lean (guidance, not a transcript), explain why so agents can extrapolate, encode repeated work — anything done more than once in this conversation is a candidate. Full guidance: [references/quality-and-feedback.md](references/quality-and-feedback.md).

## Scenario C — Measure and quality-check

### Quality gates

- [ ] Description ≤1024 chars, "Use when..." triggers present, no workflow summary; name ≤64 chars, lowercase-hyphenated, matches directory
- [ ] Body <500 lines; heavy detail lives in references/scripts/assets
- [ ] At least one pressure-scenario passed WITH the skill (and failed WITHOUT it — the RED baseline exists)
- [ ] Benchmark pass rate acceptable to the user (manual or automatic)
- [ ] No regression on the previous version's passing scenarios
- [ ] Description trigger check (below) passed, if triggering matters

### Trigger evaluation and description optimization (automatic)

Whether a description actually triggers is hard to predict — evaluate it, don't guess.

1. **Generate 10–20 eval queries**: realistic, self-contained tasks; a few clearly in-scope, several clearly out-of-scope but surface-similar (e.g. ask about React Testing Library "useEffect" when the skill is about the React useEffect *hook pattern* — should NOT trigger).
2. **Review with the user**: render [assets/eval_review.html](assets/eval_review.html) in a browser, then save as `evals.json`.
3. **Optimize in a loop** with train/test split (prevents overfitting):

```bash
python3 <path>/scripts/run_loop.py \
  --eval-set evals/evals.json --skill-path skill --report none
```

The loop runs run_eval → improve_description → re-eval until all pass or max iterations, outputting the best description (held-out-split tested) — apply it to the frontmatter and re-run the eval to confirm. Single-pass variants: [scripts/run_eval.py](scripts/run_eval.py), [scripts/improve_description.py](scripts/improve_description.py).

### Validation and audits (manual)

Structural: `python3 <path>/scripts/quick_validate.py <skill-dir>` (frontmatter, name/description constraints, token count). Token audit, description spot-check, rationalization coverage, and re-benchmark triggers: [references/quality-and-feedback.md](references/quality-and-feedback.md).

## Packaging

```bash
python3 <path>/scripts/package_skill.py <skill-dir> [output-dir]
```

Creates a distributable `.skill` zip (validates first).

Local deployment: copy the skill directory into `~/.pi/agent/skills/` (user-level) or `<project>/.pi/skills/` (project-level), start a new session, verify it appears in the available skills list. When updating, keep the original name.

## Rationalizations and red flags

Rationalizing skipping testing ("it's small, it obviously works", "manual review is enough", "I'll test after deployment", "it's just a description change")? Stop — [references/testing-rationalizations.md](references/testing-rationalizations.md) has the full table and the red flags that require starting over.

## Reference files

Most references are linked from the sections above. Also in this skill:

- [references/schemas.md](references/schemas.md) — eval/grading/benchmark JSON schemas
- [references/anthropic-best-practices.md](references/anthropic-best-practices.md) — skill-authoring best practices
- [references/persuasion-principles.md](references/persuasion-principles.md) — making instructions stick
- [assets/graphviz-conventions.dot](assets/graphviz-conventions.dot), [assets/render-graphs.js](assets/render-graphs.js) — flowchart conventions and renderer
