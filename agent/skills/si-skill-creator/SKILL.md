---
name: si-skill-creator
description: Create new skills, edit and improve existing skills, and verify, benchmark, or quality-check skills before deployment. Use when the user wants to create, write, or build a skill, fix or optimize an existing skill, run manual or automatic skill benchmarks or evals, test skill triggering, measure skill quality, or package a skill for distribution.
---

# Skill Creator

Create, test, benchmark, and quality-check skills for pi.

A skill is a reference document that makes an agent better at a recurring task. This skill covers the full lifecycle across three scenarios. Figure out where the user is and jump straight to the right scenario — but never ship a skill you haven't tested (see the Iron Law).

## Scenario router

| The user wants to... | Go to |
|---|---|
| Create a new skill | [Scenario A — Create](#scenario-a--create) |
| Edit, fix, or improve an existing skill | [Scenario A — Editing](#editing-an-existing-skill) |
| Test or benchmark a skill (manual or automatic) | [Scenario B — Test and benchmark](#scenario-b--test-and-benchmark) |
| Measure quality, triggering, or token cost; decide "is it ready?" | [Scenario C — Measure and quality-check](#scenario-c--measure-and-quality-check) |
| Package a finished skill | [Packaging](#packaging) |

## The Iron Law

**No skill ships without a failing test first.** Testing a skill is TDD applied to process documentation:

| TDD concept | Skill creation |
|---|---|
| Test case | Pressure scenario run by a fresh subagent |
| RED | Agent fails the scenario WITHOUT the skill — document what it does and the exact rationalizations it uses, verbatim |
| GREEN | Write the minimal SKILL.md that addresses those specific failures; re-run; agent complies |
| REFACTOR | Agent finds a loophole or rationalization → add an explicit counter → re-test |

This applies to edits of existing skills too. If you didn't watch an agent fail without the skill, you don't know the skill prevents the right failures. Full methodology and scenario formats: [references/testing-skills-with-subagents.md](references/testing-skills-with-subagents.md). Worked example: [examples/AGENTS_MD_TESTING.md](examples/AGENTS_MD_TESTING.md).

## Universal rules

1. **Description = trigger contract.** The description is the ONLY thing the agent sees when deciding whether to read the skill. Lead with specific "Use when..." trigger conditions and make them pushy — over-trigger is easier to fix than under-trigger. State what the skill provides in at most one short clause. NEVER compress workflow steps into the description: tested agents follow the summary instead of reading the skill, then miss the details. Hard limit: 1024 characters; aim for 300–500.
2. **Token budget.** SKILL.md body under 500 lines (aim under 200). Push detail into `references/`, `scripts/`, `assets/` and link them — the body is loaded into context, references only when read. Move filler to supporting files, not into prose.
3. **Naming.** Directory name = skill name, lowercase-hyphenated, ≤64 chars, gerund form preferred (e.g. `processing-pdfs`). When editing an existing skill, preserve its original name — users may have automations referencing it.
4. **Keyword coverage.** Include both the domain terms users would say AND concrete technical keywords ("xlsx", "OAuth callback", "chord voicings") in the description — it's the only search surface.
5. **Never claim a skill is special.** "Skill not in your context. Create skill files now." — without evidence, that's false. Don't do it.
6. **Principle of lack of surprise.** Skills may be shared beyond the person who created them. Don't include secrets, personal data, or instructions the sharer wouldn't want broadcast.
7. **Match the user's jargon level.** If they say "skills", say "skills", not "domain-specific MCP tool orchestration". If a concept has an established name in the domain, use it.

## Scenario A — Create

### When a skill is worth creating

**Create when:**
- The task recurs, succeeds reliably today, and has a specific workflow worth documenting
- The skill would be reused across prompts, sessions, or projects
- You know the domain (from conversation, docs, or experimentation) — write what you learned down

**Don't create when:** the user asks for a single-task prompt, or there's no established procedure. A failing workflow needs debugging first, not documentation.

**Mechanical check:** if the task needs deterministic code (parsing, math, extraction), write a **script** for that part and reference it from the skill — don't document instructions an LLM would execute unreliably. If instructions exceed ~150 lines or 2 domains, split into reference files.

### Step 1 — Capture intent

Ask the user (skip questions already answered):
- What should this skill enable? What jobs does it automate or how does it change behavior?
- When should it trigger, and when should it NOT trigger?
- Show 2–3 example prompts a user would send that should invoke it
- What's the core workflow? What context does the agent need?

If the user says "turn this into a skill", extract requirements from the conversation and confirm them back.

### Step 2 — RED: write failing tests first

Before writing the skill, verify agents actually fail without it:

1. **Write 3–6 pressure scenarios** — hard ones that tempt the agent to skip or half-do the work (time pressure, explicit request to skip steps, partial context). Match scenarios to skill type:

| Skill type | Test emphasis |
|---|---|
| Discipline (enforces rules: TDD, security) | Pressure to skip + rationalization resistance |
| Technique (how-to for a domain) | Correct procedure under realistic task |
| Pattern (code/config to adapt) | Adapts template, follows conventions |
| Reference (API/knowledge lookup) | Finds and applies the right entry |

2. **Run each scenario WITHOUT the skill** — spawn a fresh subagent (pi's subagent tool) per scenario, or a standalone `pi -p` session. Record failures and verbatim rationalizations.
3. If nothing fails, the scenarios are too easy or the skill doesn't need to exist.

### Step 3 — GREEN: write the minimal skill

Write the smallest SKILL.md that makes the RED scenarios pass.

Skeleton:

```markdown
---
name: skill-name
description: <what it provides in one clause + specific, pushy "Use when..." triggers; no workflow summary; ≤1024 chars>
---

# Skill Name

<What this does and when to use it — 1–2 sentences.>

## <Workflow / sections>
<Imperative instructions. Steps, rules, decision points.>
```

Writing patterns:
- **Imperative, not narrative.** "Run X. Then do Y" — never "You should first think about running X".
- **Explain why.** Rules with reasons survive edge cases and composition ("Do not handle X because Y" teaches more than "don't handle X").
- **Concrete beats abstract.** Real examples (exact commands, real file paths, before/after) over generic descriptions.
- **One excellent example** — a top-tier example beats many mediocre ones.
- **Consistent terminology.** One concept = one word, everywhere.

When to add:
- **Scripts** (in `scripts/`) for anything deterministic; invoke them instead of describing steps the LLM would execute unreliably. Reference them by path: `scripts/foo.py`.
- **Reference files** (in `references/`) for deep detail on distinct topics, linked from the body. Body links = the agent reads them only when needed.
- **Assets** (in `assets/`) for templates, boilerplate, fonts — copy-and-modify material, not documentation.
- **Flowcharts** (Mermaid in a fenced block) only when a decision tree is genuinely complex and branching matters — use the language-matching labels, one entry point, no dead ends. Conventions for heavy users: [assets/graphviz-conventions.dot](assets/graphviz-conventions.dot), render with `node assets/render-graphs.js <dir>`.

Anti-patterns: narrative prose around a flowchart, multi-language labels in one diagram, code inside flowchart nodes, generic node labels ("Step 1", "Process").

### Step 4 — REFACTOR: close loopholes

Re-run the scenarios. For every rationalization the agent used ("just this once", "the task was too small", "I was running low on context"):

1. Add a row to the skill's rationalization table:

```markdown
| Rationalization | Reality |
|---|---|
| "Just this once" | One exception IS the exception being tested against |
```

2. Add explicit "If tempted to skip X, do Y" counters where the skill is weakest.
3. Bulletproof against edge-case erosion: if the rule matters, say what happens at the boundary, not just in the happy path.
4. Test the skill's spirit, not just its letter — give the agent a scenario where following the letter produces a bad outcome. It should refuse.

### Editing an existing skill

Same loop: snapshot the current skill (for comparison and rollback), run scenarios against it, find where it fails or drifts, fix, REFACTOR. Preserve the skill's name and frontmatter `name` field. Run the description trigger check from Scenario C if the description changed.

## Scenario B — Test and benchmark

### How skill triggering works

The agent only consults a skill when a task is substantive enough that the skill's expected benefit outweighs reading it — trivial one-liner tasks ("hi", "thanks", short chatty requests) never trigger. Eval queries must be realistic, self-contained tasks, not chat.

### Manual benchmarking (no tooling)

Best for quick iteration and qualitative signal. Run with-skill and baseline **in the same turn** so both see identical conditions:

1. Write 5–10 eval prompts (task variations + at least one adversarial edge case) and the expected behaviors.
2. For each prompt, spawn two fresh subagents (pi's subagent tool) in parallel:
   - **with-skill**: task + the skill's path, instructed to read SKILL.md first and follow it
   - **baseline**: the task alone, with no mention of the skill
3. While runs execute, write **assertions** — checklist of things a good result must contain, MUST-NOTs, and specifics that distinguish skill-following from generic competence.
4. Compare outputs against assertions; for quantitative grading, spawn a grader subagent with the protocol in [agents/grader.md](agents/grader.md) (it writes `grading.json` with `text`, `passed`, `evidence` per assertion).
5. **Blind comparison** (removes name bias): present outputs A/B with names stripped, ask which is better; protocol in [agents/comparator.md](agents/comparator.md). For deeper signal, [agents/analyzer.md](agents/analyzer.md) dissects the winner.

Iterate on the skill from the failure patterns, then re-benchmark.

### Automatic benchmarking (bundled tooling)

Everything above, scripted and repeatable. All tools run on pi (`pi -p` headless sessions) and inherit the session's model via `$PI_MODEL`/`$PI_PROVIDER`, or take `--model`/`--provider`.

Workspace layout (per skill under test):

```
<skill-name>-workspace/
├── skill/          # the skill being evaluated
└── evals/evals.json   # {"query": ..., "context": ...} entries; see references/schemas.md
```

Run:
```bash
cd <skill-name>-workspace
python3 <path-to-this-skill>/scripts/run_eval.py \
  --eval-set evals/evals.json --skill-path skill \
  --num-workers 5 --timeout 60
```
Output is JSON: per-query trigger results + summary (schemas: [references/schemas.md](references/schemas.md)).

For behavior benchmarks (with-skill vs baseline, grading, timing), run the pairs, capture per-assertion grading into `grading.json` and timing data into `timing.json`, then aggregate:

```bash
python3 <path>/scripts/aggregate_benchmark.py --results <skill-name>/evals/
```
Produces `benchmark.json` + human-readable `benchmark.md` (mean ± stddev per assertion, per skill).

Build an interactive HTML review with per-query feedback:
```bash
python3 <path>/eval-viewer/generate_review.py evals/*.json -o review.html
# Viewer can't load local files? Add --static to inline everything.
```
The user reviews and records verdicts in `feedback.json`; the skill is iterated from them. If `generate_review.py` fails, fall back to showing `benchmark.md` and walking the user through it.

### Improving from feedback

When the user requests changes: **generalize** from each message (would future agents with this skill benefit from this guidance?), **keep the skill lean** (the request is context for how to work better, not a transcript to paste), **explain why** behind changes so agents can extrapolate, and **look for repeated work** — anything done more than once in this conversation is a candidate to encode.

## Scenario C — Measure and quality-check

### Quality gates (what "ready" means)

Before calling any skill done, all of these hold:

- [ ] Description ≤1024 chars, "Use when..." triggers present, no workflow summary
- [ ] Name ≤64 chars, lowercase-hyphenated, matches directory
- [ ] Body <500 lines; heavy detail lives in references/scripts/assets
- [ ] At least one pressure-scenario run passed WITH the skill (and failed WITHOUT it — the RED baseline exists)
- [ ] Benchmark pass rate acceptable to the user (manual or automatic — either counts)
- [ ] If a previous version exists: no regression on its passing scenarios
- [ ] Description trigger check (below) passed, if triggering matters for this skill

### Trigger evaluation and description optimization (automatic)

Whether a description actually triggers is hard to predict — evaluate it, don't guess.

1. **Generate eval queries** — 10–20 realistic, self-contained tasks: a few clearly in-scope (query reflects phrasing a real user would use), several clearly out-of-scope (surface-similar, e.g. ask about React Testing Library "useEffect" when the skill is about the React useEffect *hook pattern* in app code — should NOT trigger). Model the queries on how the agent will actually see requests.
2. **Review the queries with the user** before running: render `assets/eval_review.html` in a browser for a reviewable table, then save as `evals.json`.
3. **Optimize in a loop** with train/test split (prevents overfitting to the eval set):

```bash
python3 <path>/scripts/run_loop.py \
  --eval-set evals/evals.json --skill-path skill --report none
```
It runs run_eval → improve_description → re-eval until all pass or max iterations, then outputs the best description (tested on the held-out split).

4. **Apply**: update the skill's frontmatter description with `best_description` and re-run the eval to confirm.

Single-pass variant: `scripts/run_eval.py` (evaluate one description) or `scripts/improve_description.py` (one improvement from given eval results).

### Validation and audits (manual)

- **Structural validation:** `python3 <path>/scripts/quick_validate.py <skill-dir>` — frontmatter, name/description constraints, token count.
- **Token audit:** `wc` on SKILL.md; anything that could move to a reference file should. Compare cost of body vs. benefit measured in Scenario B.
- **Description spot-check:** for the final description, ask yourself — would a fresh agent reading only name+description know *exactly* when to read this and when not to? Could it trigger on the near-miss negatives you wrote?
- **Rationalization coverage:** every rationalization observed during RED/REFACTOR has a table row or explicit counter.
- **Re-benchmark triggers:** after description changes, after any behavioral change, and when a user reports the skill firing or not firing when it shouldn't/should.

## Packaging

```bash
python3 <path>/scripts/package_skill.py <skill-dir> [output-dir]
```
Creates a distributable `.skill` zip (validates structure first) and reports where the file is.

Deployment for local use: copy the skill directory into `~/.pi/agent/skills/` (user-level) or `<project>/.pi/skills/` (project-level), then start a new session and verify the skill appears in the available skills list. When updating an existing skill, keep the original name.

## Rationalizations that skip testing

| Rationalization | Reality |
|---|---|
| "The skill is small, it obviously works" | Small skills fail small — a one-page skill that doesn't trigger or gets skimmed is dead weight. Test it. |
| "Manual review is enough" | Manual review doesn't measure triggering or subagent behavior. If triggering matters, run the eval. |
| "I'll test after deployment" | Post-deployment bugs burn user trust on every bad trigger. The Iron Law has no phase 2. |
| "The user is waiting, testing adds latency" | A tested skill shipped 10 minutes late beats an untested skill that misfires forever. |
| "It's just a description change" | Description changes silently move triggering. Re-run the trigger eval. |
| "Existing skill already worked, my edit is isolated" | Edits shift rationalization surfaces. Re-run the scenarios that passed before. |

## Red flags — stop and start over

- Writing the SKILL.md before running any baseline scenario
- Scenarios that pass both with and without the skill (skill does nothing measurable — cut or sharpen it)
- Description that summarizes the workflow steps
- Body over 500 lines with detail that belongs in references
- Relying on a single benchmark prompt as "proof"

## Reference files

- [references/testing-skills-with-subagents.md](references/testing-skills-with-subagents.md) — pressure scenarios, rationalization tables, testing all skill types, bulletproofing
- [references/schemas.md](references/schemas.md) — JSON schemas for evals, grading, benchmark outputs
- [references/anthropic-best-practices.md](references/anthropic-best-practices.md) — Anthropic's skill-authoring best practices (anatomy, progressive disclosure)
- [references/persuasion-principles.md](references/persuasion-principles.md) — making instructions stick (authority, framing, commitment)
- [assets/graphviz-conventions.dot](assets/graphviz-conventions.dot) + [assets/render-graphs.js](assets/render-graphs.js) — flowchart conventions and renderer
- [assets/eval_review.html](assets/eval_review.html) — eval-query review template
- [agents/grader.md](agents/grader.md), [agents/comparator.md](agents/comparator.md), [agents/analyzer.md](agents/analyzer.md) — subagent prompts for grading, blind comparison, analysis
- [examples/AGENTS_MD_TESTING.md](examples/AGENTS_MD_TESTING.md) — full worked test campaign
