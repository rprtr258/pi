---
name: skill-creator
description: Create new skills, improve existing skills, and measure skill effectiveness with evals. Use when users want to create a skill from scratch, edit or optimize an existing skill, run evals to test a skill, benchmark skill performance, optimize a skill's description for better triggering accuracy, or turn a conversation workflow into a reusable skill.
---

# Skill Creator

Create effective skills through an interview-driven, eval-backed workflow.

## Core Principles

- **Explain the why.** The agent using the skill is smart. Explain reasoning so it generalizes — avoid heavy-handed MUSTs and rigid structures when reasoning works better.
- **Commands over prose.** "Run `pytest -v`" beats "make sure tests pass." Instructions without verification commands are suggestions, not rules.
- **Front-load critical content.** Attention follows a U-curve: strong at the top and bottom, weak in the middle. Put the most important rules first.
- **Scripts over repeated work.** If every test run reinvents the same helper, bundle it as a script.
- **Iterate with evidence.** Draft → test → review → improve. Never ship a skill without exercising it.
- **Keep skills single-purpose — don't leak specifics.** A general skill describes a tool-agnostic workflow; a specific skill owns one tool, API, or system. Keep tool-specific commands, fields, and templates in the tool's skill; have the general skill describe _what_ to do and defer _how_ to the specific skill. See the authoring guide.

## Workflow

Adapt the depth of each step to the skill's complexity. Simple skills may skip evals; complex skills need the full loop.

### 1. Capture Intent

If the conversation already contains a workflow to capture ("turn this into a skill"), extract answers from history first — tools used, step sequence, corrections made, input/output formats observed.

Ask what's missing:

1. What should this skill enable the agent to do?
2. When should it trigger? (phrases, file types, task shapes)
3. What's the expected output format?
4. Are there verification commands or success criteria?
5. Should we set up test cases? (Suggest yes for verifiable outputs, skip for subjective ones like writing style.)

### 2. Research

Check for prior art before writing:

- Existing skills in the project that overlap
- Domain documentation, API references, style guides
- Common patterns the agent already handles well (avoid duplicating built-in knowledge)

### 3. Draft

Read the [authoring guide](references/authoring-guide.md) and write the skill.

Skill structure:

```
skill-name/
├── SKILL.md              # Required: frontmatter + instructions (<500 lines)
├── scripts/              # Optional: executable code for deterministic tasks
├── references/           # Optional: docs loaded on demand (one level deep)
└── assets/               # Optional: templates, images, boilerplate
```

### 4. Validate Structure

Run the validator:

```bash
bash <skill-creator-dir>/scripts/validate_skill.sh <path-to-skill>
```

Fix any issues before proceeding.

### 5. Test

Read the [eval guide](references/eval-guide.md) for the full eval workflow. The short version:

1. Write 2–3 realistic test prompts (save to `evals/evals.json` in a workspace)
2. Run each prompt with the skill loaded (via subagent)
3. Run the same prompts without the skill as a baseline
4. Grade the outputs against assertions
5. Present results to the user for qualitative review

Skip this step only for trivial skills or when the user explicitly opts out.

### 6. Review and Improve

Present test results to the user. Focus improvement on cases with specific complaints — empty feedback means it looked fine.

When improving:

- **Generalize** from specific failures. Don't overfit to test cases.
- **Keep it lean.** Remove instructions that aren't pulling their weight. Read transcripts — if the skill makes the agent waste time on unproductive steps, cut those instructions.
- **Look for repeated work.** If every test run independently wrote the same helper script, bundle it in `scripts/`.
- **Explain reasoning.** If you find yourself writing ALWAYS or NEVER in caps, reframe and explain _why_ instead.

Repeat the test → review → improve loop until results are satisfactory.

### 7. Optimize Description (Optional)

The frontmatter `description` is the primary trigger mechanism — the agent sees it for every query and decides whether to read the skill. A bad description means the skill never fires or fires for the wrong things.

Read the [eval guide](references/eval-guide.md) "Description Optimization" section for the full process:

1. Generate 16–20 trigger eval queries (mix of should-trigger and shouldn't-trigger)
2. Test each query against the skill
3. Improve the description based on failures
4. Retest until trigger accuracy is high

## References

Read the reference that matches the current task:

| Topic     | When to Read                                              | Reference                                        |
| --------- | --------------------------------------------------------- | ------------------------------------------------ |
| authoring | Writing or reviewing a SKILL.md — structure, style, rules | [authoring-guide](references/authoring-guide.md) |
| evals     | Creating test cases, running evals, grading, benchmarking | [eval-guide](references/eval-guide.md)           |
| schemas   | JSON structures for evals.json, grading.json              | [schemas](references/schemas.md)                 |

## Subagents

| Agent  | When to Use                                      | Instructions               |
| ------ | ------------------------------------------------ | -------------------------- |
| grader | Evaluating assertions against skill test outputs | [grader](agents/grader.md) |
