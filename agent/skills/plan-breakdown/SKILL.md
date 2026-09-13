---
name: plan-breakdown
description: Turns current conversation context into a PRD when one does not exist, then breaks a plan, spec, PRD, refactor request, or parent issue into independently grabbable implementation issues using tracer-bullet vertical slices. Use when the user wants to create or publish a PRD, convert plans into tickets, create issue tracker work items, plan a refactor or a refactoring RFC, break a refactor into safe incremental steps, or split work into slices that AFK agents can pick up independently. Tracker-agnostic — the issue tracker's own skill owns publishing mechanics.
---

# Breakdown

One pipeline from intent to tracker. Stage 1 captures product intent as a PRD — only when no source document exists or the user asks for one. Stage 2 slices the work into vertical (tracer-bullet) issues.

This skill defines _what a good PRD is_, _what a good slice is_, and _what each must capture_. It is tracker-agnostic: how to publish — commands, fields, dependency syntax, parent links — belongs to the issue tracker's own skill. When you reach the publish step, follow that tracker's skill for the mechanics.

## Core Rules

- Do not interview the user during PRD synthesis; work from what is already known unless a blocking ambiguity prevents progress. Refactor RFCs are the exception — see their slice shape below.
- Use the project's domain glossary vocabulary throughout.
- Respect ADRs in the area being changed.
- Prefer deep modules that encapsulate behavior behind simple, testable interfaces.
- Each issue delivers a narrow but complete path through all required layers, not a single technical layer. A completed slice must be demoable or verifiable on its own. Prefer many thin slices over a few thick ones.
- Separate behavior from implementation. The issue states what/why and acceptance criteria; deep how-to detail is secondary and, on trackers that support it, belongs in a separate spec field rather than the description.
- Do not include specific file paths or code snippets unless a compact prototype snippet captures a decision more precisely than prose.
- Preserve and carry forward assets (screenshots, mockups, diagrams, prototypes, recordings, uploaded files, URLs) — into the PRD and into every slice that needs them.
- Express dependencies using the tracker's native dependency feature, not prose alone. A written "blocked by" note is human context; it does not gate a work queue or a "what's next" command. Record the real dependency through the tracker.
- Do not close or modify the parent issue.

## Stage 1 — Capture (optional PRD)

Synthesize the current conversation and codebase understanding into a PRD when:

- No plan, spec, PRD, or parent issue exists yet, and implementation and testing decisions should be captured before breakdown.
- The user explicitly wants a PRD.

1. Explore the repo if needed to understand current implementation, domain language, and relevant ADRs.
2. Collect assets supplied in the conversation: screenshots, mockups, diagrams, prototypes, recordings, uploaded files, or URLs.
3. Identify the major modules to build or modify, including any deep-module opportunities — a deep module encapsulates a lot of functionality in a simple, testable interface which rarely changes. Determine test coverage from conversation context and codebase patterns. Default to your best judgment; when a module or test-coverage choice is a real judgment call, check with the user first.
4. Write the PRD using the template below, including an **Assets** section when assets exist.
5. Publish it to the documented PRD home — typically the project issue tracker (for example, a GitHub issue). If no such documented home can be found, request guidance from the user.

### PRD Template

```md
## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A long, numbered list of user stories. The list should be extremely extensive and cover all aspects of the feature. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

   Example: As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending

## Implementation Decisions

A list of implementation decisions, such as modules to build or modify, interfaces to change, technical clarifications, architectural decisions, schema changes, API contracts, and specific interactions.

## Testing Decisions

A list of testing decisions, including what makes a good test, which modules will be tested, and prior art for similar tests in the codebase.

## Assets

Links or attachments for design screenshots, mockups, or other source material. Include a short note explaining what each asset shows and which user stories or decisions it informs. Omit this section if there are no assets.

## Out of Scope

Things explicitly outside this PRD.

## Further Notes

Any further notes about the feature.
```

## Stage 2 — Slice

Break the source document into independently grabbable issues using vertical slices, also called tracer bullets.

### Vertical Slices vs Horizontal Layers

A vertical slice delivers one user-visible behavior end to end. A horizontal slice completes one technical layer but cannot be verified as a complete behavior on its own.

**Good (vertical):**

```md
Title: Let customers reset their password by email
What to build: Customers can request a reset link, receive an email, open the link, set a new password, and sign in with it.
Acceptance criteria:

- [ ] A customer can request a password reset from the sign-in screen
- [ ] The reset link expires after the configured window
- [ ] A customer can sign in with the new password after reset
```

**Bad (horizontal):**

```md
Title: Add password reset database fields
What to build: Add reset token and reset timestamp columns to users.
Acceptance criteria:

- [ ] User model exposes reset fields
```

The bad example may be necessary work, but by itself no user can complete a password reset.

When a feature hinges on a risky integration (a new API, new infrastructure, an unproven library), the first slice can be the thinnest end-to-end path through that risk — verifiable by a test or console run even before any UI exists — and later slices add user surface on top. This is still a tracer bullet: it pierces every layer of the risky path, it just isn't yet wrapped in a screen.

### Refactor RFCs

When the input is a behavior-preserving refactor request, the same pipeline applies with a different slice shape. Interview first: get the problem and any candidate solutions from the user, verify their assertions in the repo, present alternatives they have not considered, and hammer out exact scope — what will and will not change. Check test coverage of the target area; if it is thin, agree on tests that pin current behavior before any behavior-preserving change is safe.

Refactor slices follow Martin Fowler's advice: "make each refactoring step as small as possible, so that you can always see the program working." Each issue is a tiny, working-codebase step, ordered so each builds on the last — refactors are inherently sequential, so parallel slices rarely apply.

Beyond the standard fields, capture per refactor issue (RFC-level fields can live in the parent RFC issue or the first slice):

- **Problem statement** — the pain, from the developer's perspective.
- **Solution** — the approach, from the developer's perspective.
- **Commits** — the ordered tiny-commit plan, each leaving the codebase in a working state.
- **Decision document** — modules built/modified, interfaces changed, technical clarifications, architectural/schema/API decisions. No file paths or code snippets; they go stale.
- **Testing decisions** — what makes a good test (external behavior, not implementation details), which modules will be tested, prior art for those tests in the codebase.
- **Out of scope** — what the refactor deliberately does not touch.

For simplification-flavored refactors, follow mode-simplify.md during execution.

## Workflow

1. Gather context from the conversation or the referenced plan, PRD, spec, parent issue, URL, or file. Identify assets to carry into slices.
2. If no source document exists or the user asked for a PRD, run Stage 1 first and use the published PRD as the source document.
3. Explore the codebase when needed for current state, domain vocabulary, and constraints.
4. Draft vertical slices. For each, capture the fields in **What Each Slice Captures**.
5. Order slices by dependency, blockers first, so later slices can reference earlier ones.
6. Publish using the tracker's skill for mechanics: assemble the captured fields into the tracker's format, route implementation detail to a spec field if one exists, record dependencies structurally, and link each slice back to the source plan/PRD.
7. Verify the published result: the dependency graph resolves so the first unblocked slice is the one you expect to start with, and dependencies are structural rather than prose-only.

## What Each Slice Captures

Capture this information per slice. The tracker's skill defines how to map these onto its fields.

- **Title** — the user-visible behavior delivered by the slice.
- **What to build** — concise end-to-end behavior, not layer-by-layer implementation. Avoid specific file paths and code; they go stale. Exception: a compact prototype snippet that encodes a decision more precisely than prose can — inline only the decision-rich part.
- **Acceptance criteria** — a short checklist of verifiable outcomes.
- **Implementation detail** (optional) — the how. Keep it out of the behavior description; route it to a spec field where the tracker supports one.
- **Blockers** — which slices must land first. Record through the tracker's dependency feature, not just as a sentence.
- **Assets** — links or attachments needed to build this slice, each with a one-line note on what it shows and which behavior it informs. Omit when none apply.
- **Parent** — a reference to the source plan, PRD, or parent issue, if any.
