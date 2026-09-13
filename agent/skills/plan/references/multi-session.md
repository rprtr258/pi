# Multi-Session Plan Format — Construction Plan

Turn a one-line objective into a step-by-step construction plan that any coding agent can execute cold. This is the plan skill's mode for work that spans multiple PRs or sessions.

## When to Use

- Breaking a large feature into multiple PRs with clear dependency order
- Planning a refactor or migration that spans multiple sessions
- Coordinating parallel workstreams across sub-agents
- Any task where context loss between sessions would cause rework

**Do not use** for tasks completable in a single PR, fewer than 3 tool calls, or when the user says "just do it" — use the single-PR mode (or no plan) instead.

## Pipeline

Run a 5-phase pipeline:

1. **Research** - Read project structure, existing plans, and memory/docs files to gather context.
2. **Design** - Break the objective into one-PR-sized steps (3-12 typical). Assign dependency edges, parallel/serial ordering, model tier (strongest vs default), and rollback strategy per step.
3. **Draft** - Write a self-contained Markdown plan file to `./plans/YY-MM-DD-<slug>.md`. Every step includes a context brief, task list, verification commands, and exit criteria - so a fresh agent can execute any step without reading prior steps.
4. **Review** - Delegate adversarial review to a strongest-available-model sub-agent against a checklist and anti-pattern catalog. Fix all critical findings before finalizing.
5. **Register** - Save the plan and present the step count and parallelism summary to the user.

Detect git/gh availability automatically. With git + GitHub CLI, generate full branch/PR/CI workflow plans. Without them, switch to direct mode (edit-in-place, no branches).

## Example

Request: "migrate database to PostgreSQL"

Produces `plans/YY-MM-DD-migrate-database-to-postgresql.md` with steps like:
- Step 1: Add PostgreSQL driver and connection config
- Step 2: Create migration scripts for each table
- Step 3: Update repository layer to use new driver
- Step 4: Add integration tests against PostgreSQL
- Step 5: Remove old database code and config

For an extraction-type request (e.g. "extract LLM providers into a plugin system"), produce parallel steps where possible ("implement Anthropic plugin" and "implement OpenAI plugin" run in parallel after the plugin interface step is done), model tier assignments (strongest for the interface design step, default for implementation), and invariants verified after every step (e.g., "all existing tests pass", "no provider imports in core").

## Step Anatomy

Every step is self-contained (cold-start execution):

- **Context brief** - everything a fresh agent needs: relevant files, conventions, prior-step outputs it depends on
- **Task list** - ordered, actionable tasks for the step
- **Verification commands** - how to prove the step works
- **Exit criteria** - the definition of done, including any invariants to re-check

## Key Features

- **Cold-start execution** - Every step includes a self-contained context brief. No prior context needed.
- **Adversarial review gate** - Review the plan (or dispatch a strongest-available-model sub-agent) against a checklist covering completeness, dependency correctness, and anti-pattern detection. Fix critical findings before finalizing.
- **Branch/PR/CI workflow** - Built into every step. Degrades gracefully to direct mode when git/gh is absent.
- **Parallel step detection** - The dependency graph identifies steps with no shared files or output dependencies; those can run concurrently.
- **Plan mutation protocol** - Steps can be split, inserted, skipped, reordered, or abandoned with formal protocols and an audit trail in the plan file.
