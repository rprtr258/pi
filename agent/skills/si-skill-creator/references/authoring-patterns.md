# Authoring Patterns for SKILL.md

Companion to si-skill-creator Scenario A, Step 3 (GREEN): the minimal-skill skeleton, writing patterns, and what belongs in supporting files.

## Skeleton

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

## Writing patterns

- **Imperative, not narrative.** "Run X. Then do Y" — never "You should first think about running X".
- **Explain why.** Rules with reasons survive edge cases and composition ("Do not handle X because Y").
- **Concrete beats abstract.** Exact commands, real file paths, before/after over generic descriptions.
- **One excellent example** beats many mediocre ones.
- **Consistent terminology.** One concept = one word, everywhere.

## What to add where

- **Scripts** (in `scripts/`) for anything deterministic; invoke them by path (`scripts/foo.py`) instead of describing steps the LLM would execute unreliably.
- **Reference files** (in `references/`) for deep detail on distinct topics, linked from the body — the agent reads them only when needed.
- **Assets** (in `assets/`) for templates, boilerplate, fonts — copy-and-modify material, not documentation.
- **Flowcharts** (Mermaid in a fenced block) only when a decision tree is genuinely complex and branching matters: use language-matching labels, one entry point, no dead ends. Conventions for heavy users: [../assets/graphviz-conventions.dot](../assets/graphviz-conventions.dot), render with `node assets/render-graphs.js <dir>`.

Flowchart anti-patterns: narrative prose around a flowchart, multi-language labels in one diagram, code inside flowchart nodes, generic node labels ("Step 1", "Process").
