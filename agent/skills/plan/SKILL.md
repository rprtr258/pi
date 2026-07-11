---
name: plan
description: Write implementation plans for project work — single-PR plans with objectives, checkbox tasks, verification criteria, and risk assessment, or multi-session/multi-PR construction plans with self-contained context briefs. Use when the user asks for a plan, blueprint, roadmap, or implementation strategy, wants work broken into steps, has a spec that needs an implementation plan, needs structured planning or risk analysis before implementation, or describes work that needs multiple sessions; plans are saved under `./plans/` and single-PR plans are validated with a script.
---

# Plan

Use this skill to write implementation plans saved under `./plans/`. Planning only — do not make code changes; if the user requests implementation, hand off after the plan is approved.

## Pick the Mode

| Mode | Use when | Format reference |
| --- | --- | --- |
| Single-PR | work completable in one PR — from a quick request or from an existing spec | [template](references/template.md), plus [single-pr](references/single-pr.md) discipline for spec-driven or zero-context execution |
| Multi-session | work spanning multiple PRs or sessions, parallel workstreams, or high cost of context loss between sessions | [multi-session](references/multi-session.md) |

Do not plan at all when the task is trivial ("just do it").

## Core Rules

- Do not draft the plan until the user has been grilled — load the `plan-critique` skill and interview relentlessly before writing anything.
- Rewrite plans to match user feedback; do not patch a bad structure incrementally.
- Single-PR: 3–8 checkbox tasks (`- [ ]`) — the validator rejects fewer than 3. Multi-session: 3–12 PR-sized steps with dependency ordering.
- Each task must be small, actionable, and independently verifiable.
- Be concrete about files, changes, and acceptance criteria — reference files as `filepath:line`; placeholders are plan failures.
- Describe strategy in natural language; code snippets are allowed where they make a task unambiguous.

## Workflow

1. Read `references/workflow.md` and follow it exactly — it routes to the mode reference for structure and format.
2. After writing a single-PR plan, validate it (mandatory):

   ```bash
   ~/.pi/agent/skills/plan/validate-plan.sh <plan-file>
   ```

   Fix all errors and re-run until validation passes. Use `~/.pi/agent/skills/plan/validate-all-plans.sh [plans-dir]` to re-validate a whole plans directory.

## References

Read the reference that matches the current phase:

| Topic | Description | Reference |
| --- | --- | --- |
| workflow | Required planning process — mode choice, grilling, exploration, decision gates | [workflow](references/workflow.md) |
| template | Single-PR plan structure (Objective, checkbox Implementation Plan, Verification Criteria, Risks, Alternatives), naming, validation | [template](references/template.md) |
| single-pr | Bite-sized TDD task discipline, no-placeholder rules, self-review, execution handoff | [single-pr](references/single-pr.md) |
| multi-session | Construction-plan pipeline: context briefs, dependency graph, review gate, mutation protocol | [multi-session](references/multi-session.md) |
