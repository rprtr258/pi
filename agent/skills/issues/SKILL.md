---
name: issues
description: Breaks a plan, spec, PRD, or parent issue into independently grabbable implementation issues using tracer-bullet vertical slices. Use when converting plans into tickets, creating issue tracker work items, or splitting work into slices that AFK agents can pick up independently. Tracker-agnostic — the specific issue tracker's own skill owns publishing mechanics.
---

# Issues

Break a plan into independently grabbable issues using vertical slices, also called tracer bullets.

This skill defines _what a good slice is_ and _what each slice must capture_. It is tracker-agnostic. How to publish — commands, fields, dependency syntax, parent links — belongs to the specific issue tracker's skill. When you reach the publish step, follow that tracker's skill for the mechanics.

## Core Rules

- Each issue delivers a narrow but complete path through all required layers, not a single technical layer.
- A completed slice must be demoable or verifiable on its own.
- Prefer many thin slices over a few thick ones.
- Separate behavior from implementation. The issue states what/why and acceptance criteria; deep how-to detail is secondary and, on trackers that support it, belongs in a separate spec field rather than the description.
- Express dependencies using the tracker's native dependency feature, not prose alone. A written "blocked by" note is human context; it does not gate a work queue or a "what's next" command. Record the real dependency through the tracker.
- Use the project's domain glossary vocabulary.
- Carry forward relevant assets (screenshots, mockups, diagrams, prototypes, recordings, uploaded files, URLs) into each slice that needs them.
- Do not close or modify the parent issue.

## Vertical Slices vs Horizontal Layers

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

## Workflow

1. Gather context from the conversation or the referenced plan, PRD, spec, parent issue, URL, or file.
2. Identify source assets to carry into slices.
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
