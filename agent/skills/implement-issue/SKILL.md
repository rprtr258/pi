---
name: implement-issue
description: Implements one existing issue end-to-end. Use when asked to pick an open issue, implement it, verify it, mark it done, and commit the result.
---

# Implement Issue

Implement exactly one existing issue from the current project.

## When to Use This Skill

- A prompt asks to implement an issue in the current agent.
- A loop prompt asks to implement one issue per iteration.
- The user asks to pick the highest-priority open issue and finish it.

## Core Rules

- Implement ONE issue only. Do not batch.
- Do not create, modify, or split issues. Only implement what exists.
- Do not skip verification.
- Do not mark an issue done until verification passes.
- Commit all completed changes with a clear message after verification passes.

## Workflow

1. Read `AGENTS.md` and the current PRD for full context.
2. Run `git log -n 5 --format="%H%n%ad%n%B---" --date=short` for recently implemented issues.
3. Find open issues.
4. If there are no open issues, output exactly `No open issues` and stop.
5. Pick the highest-priority issue and read it.
6. Implement the issue fully.
7. Run the project's verification checklist.
8. If verification fails, fix the failures and re-run verification.
9. When verification passes, move the issue to done.
10. Commit all changes with a clear message.
11. Output exactly `Implemented <ISSUE-ID>`.
