# Plan Workflow

Follow this process unless the user explicitly asks to skip a step.

## 1. Confirm the request

Identify:

- what is being planned
- whether the user wants a local `./plans/` file or just an in-chat draft
- any fixed constraints, priorities, or deadlines

If the user already provided this, do not ask again.

## 2. Explore the codebase

Before writing or asking, verify the current state in code. Read the relevant files, search for existing implementations, and check any project notes needed to understand the scope.

## 3. Grill the user

Load and follow the `plan-critique` skill. Do not move to step 4 until scope, sequencing, and all structural decisions are resolved.

## 4. Choose the step structure and mode

Pick the plan mode:

- **Single-PR** (default): work completable in one PR. Follow `template.md` for structure; apply `single-pr.md` discipline when a spec exists or a fresh agent will execute the plan.
- **Multi-session**: work spanning multiple PRs or sessions, parallel workstreams, or high cost of context loss. Follow `multi-session.md` instead of `template.md`.

Prefer 3–8 checkbox tasks (single-PR; the validator requires at least 3) or 3–12 PR-sized steps (multi-session). Use more than 8 single-PR tasks only when the work clearly breaks into several independently shippable phases.

Each step should represent a coherent unit of work with a clear, verifiable outcome. Avoid mixing unrelated concerns in a single step.

If the user gives structural feedback, rewrite the step layout cleanly instead of patching the old structure.

## 5. Write the final plan

Save to `./plans/YYYY-MM-DD-<task-name>-vN.md` (lowercase and hyphens only) using the template in `references/template.md` (single-PR) or the format in `references/multi-session.md` (multi-session).

The saved plan is the clean result — not a transcript of your exploration. Keep background short.

## 6. Validate before finishing

Single-PR plans — run the validator and fix every error:

```bash
~/.pi/agent/skills/plan/validate-plan.sh plans/YYYY-MM-DD-<task-name>-vN.md
```

Multi-session plans — validation is the adversarial review gate in `references/multi-session.md` (the script above does not apply).

Then confirm manually:

- file name matches `YYYY-MM-DD-<task-name>-vN.md`
- each step includes file paths, changes, and acceptance criteria (or verification commands plus exit criteria in multi-session plans)
- non-goals are explicit
- structure reflects user feedback exactly
