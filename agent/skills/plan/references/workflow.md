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

Prefer 2–5 top-level steps (single-PR) or 3–12 PR-sized steps (multi-session). Use more than 5 single-PR steps only when the work clearly breaks into several independently shippable phases.

Each step should represent a coherent unit of work with a clear, verifiable outcome. Avoid mixing unrelated concerns in a single step.

If the user gives structural feedback, rewrite the step layout cleanly instead of patching the old structure.

## 5. Write the final plan

Save to `./plans/YY-MM-DD-<slug>.md` using the template in `references/template.md` (single-PR) or the format in `references/multi-session.md` (multi-session).

The saved plan is the clean result — not a transcript of your exploration. Keep background short.

## 6. Validate before finishing

- file name matches `YY-MM-DD-<slug>.md`
- required headings are present
- steps are numbered and actionable
- each step includes file paths, changes, and acceptance criteria (or verification commands plus exit criteria in multi-session plans)
- non-goals and risks are explicit
- structure reflects user feedback exactly
