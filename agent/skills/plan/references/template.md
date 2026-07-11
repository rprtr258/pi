# Plan Template (Single-PR)

Save plans under `./plans/` using `YYYY-MM-DD-task-name-vN.md` — lowercase and hyphens only, no underscores or uppercase.

Example names:

- `plans/2026-03-01-refactor-map-view-v1.md`
- `plans/2026-02-15-allow-password-resets-v2.md`

> This is the single-PR plan structure. For multi-session construction plans, see [multi-session](multi-session.md).

## Required Structure

```markdown
# [Task Name]

## Objective

[Clear statement of goal and expected outcomes — 2-4 sentences max]

## Implementation Plan

- [ ] 1. [First task with detailed description]
  - Details: what needs to be done, affected files as `filepath:line` references, integration points
  - Rationale: why this task is necessary
  - Dependencies: what must be completed before this

- [ ] 2. [Second task with detailed description]
  - Details: ...
  - Rationale: ...
  - Dependencies: ...

## Verification Criteria

- [Criterion 1: specific, measurable outcome]
- [Criterion 2: measurable outcome]

## Potential Risks and Mitigations

1. **[Risk Description]**
   - Impact: potential impact if the risk occurs
   - Mitigation: specific strategy to prevent or minimize it

2. **[Risk Description]**
   - Mitigation: ...

## Alternative Approaches

1. **[Alternative 1]** — description, trade-offs, why it was not chosen
2. **[Alternative 2]** — ...

## Non-Goals (optional)

[Explicitly scope out related work that is deferred or out of scope.]

## Assumptions (when requirements are ambiguous)

- [Assumption]: why it was made
```

Add Assumptions / Dependencies / Notes sections only when they carry real content.

## Writing Rules

- Tasks use checkbox format (`- [ ]`). Numbered lists or plain top-level bullets inside Implementation Plan fail validation.
- 3–8 tasks; the validator errors with fewer than 3.
- Be concrete: file paths as `filepath:line`, rationale for each task, integration points.
- Describe the strategy in natural language; code snippets are allowed where they make a task unambiguous.
- No placeholder tasks ("TODO", "TBD", "implement later").
- Verification criteria must be specific and measurable.
- Every risk needs a mitigation; document alternatives with trade-offs for non-obvious decisions.
- Make assumptions explicit for ambiguous requirements.

## Validation

After saving (mandatory):

```bash
~/.pi/agent/skills/plan/validate-plan.sh plans/YYYY-MM-DD-task-name-vN.md
```

Fix all errors and re-run until the plan passes. Warnings are advisory but worth resolving.
