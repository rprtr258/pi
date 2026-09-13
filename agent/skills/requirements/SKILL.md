---
name: requirements
description: You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent and requirements through dialogue, refines the design, and produces an EARS-format specification with Given/When/Then acceptance criteria and an error-handling table. Use when defining new features, gathering requirements, brainstorming designs, writing specifications, user stories, acceptance criteria, capability constraints for multi-service work, or scoping work before implementation planning.
---

# Requirements

## Overview

Turn a vague idea into a specification ready for the `plan` skill.

This skill covers the full requirements journey: understanding intent through
dialogue, refining the design, and writing a spec with EARS-format functional
requirements, Given/When/Then acceptance criteria, and an error-handling table.
The output is a document from which an implementation plan can be written.

Ask questions one at a time - do not overwhelm the user. Resolve all doubts
BEFORE writing the spec.

## The Process

### Understanding the idea

Start by checking existing project documentation (README.md, docs/, CONTEXT.md),
codebase patterns and standards (directory structure, naming, module
organization), and recent commits for context. A well-crafted spec must reflect
project reality.

1. **Ask clarifying questions one at a time** (don't dump a list). Cover: goal,
   scope, edge cases, terminology, UI changes, non-functional constraints
   (performance, security). Interview from two perspectives: PM (user problems,
   priorities, success metrics) and dev (integration points, validation, error
   handling). Load `references/interview-questions.md` for proven question
   frameworks. For features spanning multiple domains, optionally front-load
   technical context via research subagents first - see
   `references/pre-discovery-subagents.md`.
2. **Prefer multiple-choice prompts** where options can be predetermined;
   use open-ended questions only for what cannot be enumerated.
3. **YAGNI direction:** push back on features that are unneeded, overly
   complicated, or better handled another way. Park rejected ideas in
   Out of Scope.
4. **Scope check:** if the feature is too large, suggest decomposition into
   smaller, independently deliverable pieces - each gets its own spec and plan.

### Refining the design

5. **Explore 2-3 approaches** with trade-offs. Lead with your recommended one.
6. **Present the design in small sections** (10-30 lines). Check for problems
   after each section before moving on. Convert each user answer into spec
   language as you go - an appendix of captured requirements is easier to
   polish than a spec written from memory at the end.

### Multi-service work: capability constraints

If the feature crosses services, repos, or teams, extract the capability
contract before writing the spec - these usually live only in
senior-engineer memory, and rediscovering them mid-PR is expensive:

- **Constraints:** business rules, scope boundaries, invariants, trust
  boundaries, data ownership, lifecycle transitions, rollout/migration
  requirements, failure/recovery expectations.
- **Implementation contract:** actors, surfaces, required states and
  transitions, interface/data implications.
- **Non-goals:** what this feature explicitly does not own.

Mark unresolved items as Open Questions - do not invent product truth. If the
repo has a durable product-context file (`PRODUCT.md`, `docs/product/`),
record the constraints there so they survive across sessions.

### Writing the spec

Load the format references, then write the document:

- `references/ears-syntax.md` - EARS grammar for functional requirements
- `references/acceptance-criteria.md` - Given/When/Then scenario format
- `references/specification-template.md` - full document template with the
  error-handling table

Save the spec as `docs/specs/YYYY-MM-DD-{topic}.spec.md` in the project
(user preference for location overrides this default).

### Validation

7. **Spec self-review:** dispatch a reviewer subagent using
   `spec-document-reviewer-prompt.md` to verify completeness, consistency,
   clarity, scope, and YAGNI. Fix flagged issues.
8. **User review:** present the spec; get explicit approval or revise.
9. **Handoff:** after approval, invoke the `plan` skill with the spec path.

## HARD-GATE: If ALL of the following are true, write the spec:
- You asked all clarifying questions
- The user answered them
- No YAGNI issues remain
- The design passed section-by-section review

If any fail, return to that step - even if the user says "just write it".

## Spec Contents (Required)

1. **Overview** (2-3 sentences)
2. **Functional Requirements** in EARS syntax (reference `references/ears-syntax.md`): `WHEN <trigger> [the system] SHALL <response>`
3. **Acceptance Criteria** in Given/When/Then (reference `references/acceptance-criteria.md`)
4. **Non-Functional Requirements** (performance, security, etc.)
5. **Error handling matrix**
6. **Open questions** - anything you could not resolve in conversation. Explicitly mark what is UNRESOLVED rather than guessing.
7. **Out of scope** - explicitly list what you are NOT building and why.
8. **Handoff note** - statement that spec is ready for implementation planning via the plan skill - or, if not, which gate applies first (architecture review or product clarification).

**Save location:** `docs/specs/YYYY-MM-DD-<topic>.spec.md`. Follow project conventions if the user has a preference.

## Appendix: visual companion

If running in a UI supporting subagents, you can offer a live visual companion (or if the user asks for one, you can provide it even without subagent support). It renders each section as a visual card in the browser as the design evolves.
- Full instructions: [visual-companion.md](visual-companion.md)
- **Subagent Process:** Launch a new general-purpose subagent to run the visual companion server. The subagent should read [visual-companion.md](visual-companion.md) for instructions.

## Spec Review Checklist

Before handing off, verify:
- [ ] All clarifying questions asked and answered
- [ ] 2-3 approaches explored, one chosen
- [ ] Design presented section-by-section and approved
- [ ] EARS functional requirements written
- [ ] Given/When/Then acceptance criteria cover every requirement
- [ ] Error-handling table covers failure cases
- [ ] Capability constraints captured for multi-service work (if applicable)
- [ ] Self-review passed (spec-document-reviewer-prompt.md)
- [ ] User explicitly approved the spec
- [ ] Handed off to the plan skill

## Anti-Patterns

- **Spec without interview.** Writing requirements before asking clarifying
  questions. If the idea is fully specified, confirm your understanding, then
  write it down.
- **Kitchen-sink spec.** Accepting every request. Push back, note YAGNI
  candidates in Open Questions or Out of Scope.
- **Skipping acceptance criteria.** "How to verify" is how plan and tests get
  written. Every FR should map to at least one AC.
- **All-at-once feedback.** Presenting the whole spec for one round of
  feedback. Iterate section by section instead.
- **Starting implementation before the spec is approved.** The plan skill
  comes after, not before.
