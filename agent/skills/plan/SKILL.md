---
name: plan
description: Write implementation plans for project work — single-PR plans with bite-sized TDD tasks, or multi-session/multi-PR construction plans with self-contained context briefs. Use when the user asks for a plan, blueprint, or roadmap, wants work broken into steps, has a spec that needs an implementation plan, or describes work that needs multiple sessions; plans are saved under `./plans/`.
---

# Plan

Use this skill to write implementation-ready plans saved under `./plans/`.

## Pick the Mode

| Mode | Use when | Format reference |
| --- | --- | --- |
| Single-PR | work completable in one PR — from a quick request or from an existing spec | [template](references/template.md), plus [single-pr](references/single-pr.md) discipline for spec-driven or zero-context execution |
| Multi-session | work spanning multiple PRs or sessions, parallel workstreams, or high cost of context loss between sessions | [multi-session](references/multi-session.md) |

Do not plan at all when the task is trivial ("just do it").

## Core Rules

- Do not draft the plan until the user has been grilled — load the `plan-critique` skill and interview relentlessly before writing anything.
- Rewrite plans to match user feedback; do not patch a bad structure incrementally.
- Single-PR: prefer 2–5 top-level numbered steps. Multi-session: 3–12 PR-sized steps with dependency ordering.
- Each step must be small, actionable, and independently verifiable.
- Be concrete about files, changes, and acceptance criteria — placeholders are plan failures.

## Workflow

1. Read `references/workflow.md` and follow it exactly — it routes to the mode reference for structure and format.

## References

Read the reference that matches the current phase:

| Topic | Description | Reference |
| --- | --- | --- |
| workflow | Required planning process — mode choice, grilling, exploration, decision gates | [workflow](references/workflow.md) |
| template | Single-PR plan structure, naming, and validation checklist | [template](references/template.md) |
| single-pr | Bite-sized TDD task format, no-placeholder rules, self-review, execution handoff | [single-pr](references/single-pr.md) |
| multi-session | Construction-plan pipeline: context briefs, dependency graph, review gate, mutation protocol | [multi-session](references/multi-session.md) |
