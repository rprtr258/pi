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

Load and follow the `grill-me` skill. Do not move to step 4 until scope, sequencing, and all structural decisions are resolved.

## 4. Choose the step structure

Prefer 2–5 top-level steps. Use more than 5 only when the work clearly breaks into several independently shippable phases.

Each step should represent a coherent unit of work with a clear, verifiable outcome. Avoid mixing unrelated concerns in a single step.

If the user gives structural feedback, rewrite the step layout cleanly instead of patching the old structure.

## 5. Write the final plan

Save to `./plans/YY-MM-DD-<slug>.md` using the template in `references/template.md`.

The saved plan is the clean result — not a transcript of your exploration. Keep background short.

## 6. Validate before finishing

- file name matches `YY-MM-DD-<slug>.md`
- required headings are present
- steps are numbered and actionable
- each step includes file paths, changes, and acceptance criteria
- non-goals and risks are explicit
- structure reflects user feedback exactly
