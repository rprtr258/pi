---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

Use when you have an implementation plan with mostly independent tasks and you are staying in this session. No plan yet, or tightly coupled tasks → manual execution or brainstorm first. Prefer a parallel session → `superpowers:executing-plans`.

**vs. Executing Plans (parallel session):**
- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Two-stage review after each task: spec compliance first, then code quality
- Faster iteration (no human-in-loop between tasks)

## The Process

1. Read the plan once; extract all tasks with their full text and context; create a TodoWrite.
2. Per task: dispatch an implementer subagent (`./implementer-prompt.md`). If it asks questions, answer and provide context, then re-dispatch. It implements, tests, commits, and self-reviews.
3. Dispatch a spec compliance reviewer subagent (`./spec-reviewer-prompt.md`). If it finds gaps, the implementer fixes them, then re-review. Repeat until ✅.
4. Dispatch a code quality reviewer subagent (`./code-quality-reviewer-prompt.md`). If it finds issues, the implementer fixes them, then re-review. Repeat until approved.
5. Mark the task complete in TodoWrite; repeat from step 2 while tasks remain.
6. After all tasks: dispatch a final code reviewer subagent for the entire implementation, then use `superpowers:finishing-a-development-branch`.

## Model Selection

Use the least powerful model that can handle each role to conserve cost and increase speed:

- Touches 1–2 files with a complete, well-specified spec (most implementation tasks) → fast, cheap model.
- Touches multiple files with integration concerns, pattern matching, or debugging → standard model.
- Requires design judgment, broad repository understanding, architecture, or review → most capable model.

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle each as follows:

**DONE:** Proceed to spec compliance review.

**DONE_WITH_CONCERNS:** Read the concerns first. Address correctness/scope concerns before review; note observations (e.g., "this file is getting large") and proceed to review.

**NEEDS_CONTEXT:** The implementer needs information that wasn't provided. Provide the missing context and re-dispatch.

**BLOCKED:** The implementer cannot complete the task. Assess the blocker:
1. If it's a context problem, provide more context and re-dispatch with the same model
2. If the task requires more reasoning, re-dispatch with a more capable model
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the human

**Never** ignore an escalation or force the same model to retry without changes — if the implementer is stuck, something needs to change.

## Prompt Templates

- `./implementer-prompt.md` - Dispatch implementer subagent
- `./spec-reviewer-prompt.md` - Dispatch spec compliance reviewer subagent
- `./code-quality-reviewer-prompt.md` - Dispatch code quality reviewer subagent

## Example Workflow

```
You: I'm using Subagent-Driven Development to execute this plan.
[Read plan file once: docs/superpowers/plans/feature-plan.md]
[Extract all 5 tasks with full text and context; create TodoWrite]

Task 1: Hook installation script
[Dispatch implementer with full task text + context]
Implementer: "Should the hook be installed at user or system level?"
You: "User level (~/.config/superpowers/hooks/)"
Implementer: Implemented install-hook command; tests 5/5 passing;
  self-review found missed --force flag, added it; committed.
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra
Code reviewer: Good test coverage, clean. Approved. → Task 1 complete

Task 2: Recovery modes
[Dispatch implementer] → no questions; 8/8 tests passing; committed.
Spec reviewer: ❌ Missing: progress reporting (spec: "report every 100 items");
  Extra: --json flag (not requested)
Implementer: Removed --json flag, added progress reporting
Spec reviewer: ✅ Spec compliant now
Code reviewer: Issue (Important): magic number (100)
Implementer: Extracted PROGRESS_INTERVAL constant
Code reviewer: ✅ Approved → Task 2 complete

... [tasks 3-5 same loop] ...

[After all tasks]
Final code reviewer: All requirements met, ready to merge
Done!
```

## Advantages

**vs. Manual execution:** subagents follow TDD naturally; fresh context per task (no confusion); parallel-safe (subagents don't interfere); subagents can ask questions before and during work.

**vs. Executing Plans:** same session (no handoff); continuous progress (no waiting); review checkpoints automatic.

**Efficiency gains:** no file-reading overhead (controller provides full text); controller curates exactly the context needed; complete information upfront; questions surfaced before work begins, not after.

**Quality gates:** self-review catches issues before handoff; two-stage review (spec compliance, then code quality); review loops ensure fixes work; spec compliance prevents over/under-building; code quality ensures well-built implementation.

**Cost:** more subagent invocations (implementer + 2 reviewers per task), more controller prep, and review-loop iterations — but issues are caught early, cheaper than debugging later.

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (spec OR quality), proceed with unfixed issues, accept "close enough", or start quality review before spec compliance is ✅ (wrong order)
- Skip review loops: reviewer found issues → implementer (same subagent) fixes → reviewer reviews again, until approved. Don't fix manually (context pollution)
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text) or skip scene-setting context
- Ignore subagent questions (answer before letting them proceed)
- Let implementer self-review replace actual review (both are needed)
- Move to next task while either review has open issues

**If a subagent fails the task:** dispatch a fix subagent with specific instructions.

## Integration

**Required workflow skills:**
- **superpowers:using-git-worktrees** - REQUIRED: set up isolated workspace before starting
- **plan** - creates the plan this skill executes
- **superpowers:requesting-code-review** - code review template for reviewer subagents
- **superpowers:finishing-a-development-branch** - complete development after all tasks

**Subagents should use:** **superpowers:test-driven-development** for each task.

**Alternative workflow:** **superpowers:executing-plans** - for parallel-session execution instead of same-session.
