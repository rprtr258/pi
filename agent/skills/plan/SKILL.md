---
name: plan
description: Write implementation plans for project work. Use when the user asks for a plan, wants work broken into steps, or needs a scoped implementation roadmap saved under `./plans/`.
---

# Plan

Use this skill to write concise, implementation-ready plans.

## When to Use This Skill

- The user asks to "make a plan"
- The user wants implementation work split into steps
- The user wants a roadmap saved in `./plans/`

## Core Rules

- Do not draft the plan until the user has been grilled — load the `grill-me` skill and interview relentlessly before writing anything.
- Rewrite plans to match user feedback; do not patch a bad structure incrementally.
- Final plans must follow the template exactly.
- Prefer 2–5 top-level numbered steps over long narrative subsections.
- Each step must be small, actionable, and independently verifiable.
- Be concrete about files, changes, and acceptance criteria.

## Workflow

1. Read `references/workflow.md` and follow it exactly.

## References

Read the reference that matches the current phase:

| Topic    | Description                                                           | Reference                          |
| -------- | --------------------------------------------------------------------- | ---------------------------------- |
| workflow | Required planning process — grilling, exploration, and decision gates | [workflow](references/workflow.md) |
| template | Exact plan structure, naming, and validation checklist                | [template](references/template.md) |
