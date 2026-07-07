# Skill Authoring Guide

How to write effective, concise skills.

## About Skills

Skills are modular packages that extend the agent with specialized knowledge, workflows, and tools. They transform a general-purpose agent into a domain specialist equipped with procedural knowledge no model fully possesses.

Skills provide:

- **Specialized workflows** — multi-step procedures for specific domains
- **Tool integrations** — instructions for working with specific formats or APIs
- **Domain expertise** — company-specific knowledge, schemas, business logic
- **Bundled resources** — scripts, references, and assets for complex tasks

## Frontmatter

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: my-skill
description: "What it does and when to use it. Include all triggers here."
---
```

Rules:

- `name`: lowercase letters, digits, and hyphens only. No leading/trailing hyphens, no consecutive hyphens. Max 64 characters.
- `name`: specific and descriptive — not `helper` or `utils`
- `description`: the primary trigger mechanism. Include both what the skill does AND when to use it. All "when to use" info goes here, not in the body.
- `description`: max 1024 characters. No angle brackets.
- `description`: write in imperative form — "Use when…" not "This skill helps with…"
- `description`: be slightly pushy — skills tend to under-trigger. Include synonyms and alternate phrasings for the task.

**Good description:**

```
Create new skills, improve existing skills, and measure skill effectiveness
with evals. Use when users want to create a skill from scratch, edit or optimize
an existing skill, run evals to test a skill, or turn a conversation workflow
into a reusable skill.
```

**Bad description:**

```
A skill for creating skills.
```

## SKILL.md Structure

Use this structure unless there's a clear reason not to:

```markdown
# Skill Name

One short sentence explaining what the skill is for.

## Core Rules

- Short, durable rule
- Short, durable rule

## Workflow

1. Read the relevant reference(s)
2. Execute the task
3. Validate the result
4. Iterate until checks pass

## References

Read the reference that matches the current task:

| Topic   | When to Read     | Reference                      |
| ------- | ---------------- | ------------------------------ |
| <topic> | <selection hint> | [<name>](references/<file>.md) |
```

## Writing Principles

### Be Concise

The context window is a shared resource. Only include domain knowledge, constraints, file locations, workflows, and conventions the agent doesn't already know.

**Good:**

```md
- Run `bin/rails test` after controller changes.
```

**Bad:**

```md
- Rails applications usually have tests, and tests are important because they
  help catch regressions, so after changing controllers you should consider
  running tests.
```

### Explain the Why

Explain reasoning so the agent generalizes to new situations. If you find yourself writing ALWAYS or NEVER in caps, reframe as reasoning.

**Good:**

```md
Use `respond_to` blocks because they support both HTML and Turbo Stream
responses, letting the same action handle full-page and partial updates.
```

**Bad:**

```md
ALWAYS use respond_to blocks. NEVER render turbo_stream inline.
```

### Use Commands, Not Wishes

Instructions without verification commands are suggestions. Include the exact command to run and the expected exit condition.

**Good:**

```md
After changing migrations:

1. Run `bin/rails db:migrate`
2. Run `bin/rails db:rollback` and re-migrate to verify reversibility
3. Check that `db/schema.rb` diff looks correct
```

**Bad:**

```md
Handle migrations carefully and make sure they work.
```

### Keep Skills Single-Purpose — Don't Leak Specifics

A general skill describes a tool-agnostic workflow or concept. A specific skill owns one tool, API, or system. Don't bleed one into the other: keep tool-specific commands, field names, and templates in the tool's skill, and have the general skill describe _what_ to do while deferring _how_ to the specific skill.

Leaks make the general skill wrong the moment the specific tool changes, and they couple skills that should evolve independently. A reader applying the general skill to a different tool inherits irrelevant or misleading instructions.

**Good:**

```md
<!-- issues skill -->

Express dependencies using the tracker's native dependency feature, not prose.
Publishing mechanics belong to the issue tracker's own skill.

<!-- ticgit skill -->

| Blockers | `ti dep <blocker-id> -t <id>` (structural; prose does not gate `ti next`) |
```

**Bad:**

```md
<!-- issues skill, hardcoding one tracker's commands and template -->

## Blocked by

- Run `ti dep <blocker-id> -t <id>` to block this issue.
```

The bad version only works for one tracker and silently misleads for any other. When extracting a skill from a conversation, watch for the specific tool you happened to use leaking into a general skill: if a rule names a command, file, or field of one tool, it probably belongs in that tool's skill.

### Set the Right Degree of Freedom

- **High freedom** — style guidance, heuristics, multiple valid approaches
- **Medium freedom** — preferred patterns with some adaptation
- **Low freedom** — fragile, order-dependent, or destructive operations (use explicit numbered steps)

### Front-Load Critical Content

Attention follows a U-curve: strong at the top and bottom, weak in the middle. Put the most important rules and commands early. Style preferences go last.

### Organize by Task, Not Category

Organize sections by what the user is doing ("When writing tests…", "When deploying…") rather than by abstract category ("Style", "Testing", "Deployment"). The "When…" prefix maps to how agents reason about task context.

### Use Consistent Terminology

Pick one term per concept and reuse it. Don't alternate between "test", "spec", and "check" for the same thing.

### Use Durable Language

Avoid time-sensitive instructions unless explicitly historical. Prefer stable conventions over commentary about trends.

## Pattern / Anti-Pattern Format

When documenting conventions, prefer paired examples:

````md
## Turbo Stream Responses

**Good:**

```ruby
def create
  @record = Record.create!(record_params)
  respond_to do |format|
    format.html { redirect_to records_path }
    format.turbo_stream
  end
end
```

**Bad:**

```ruby
def create
  @record = Record.create!(record_params)
  render turbo_stream: turbo_stream.append("records", partial: "records/record", locals: { record: @record })
end
```
````

Add a short "why" only when it helps the agent choose correctly.

## Progressive Disclosure

Skills use a three-level loading system:

1. **Metadata** (name + description) — always in context (~100 words)
2. **SKILL.md body** — loaded when skill triggers (<500 lines)
3. **Bundled resources** — loaded as needed (unlimited)

Keep SKILL.md under 500 lines. When approaching this limit, split content into reference files and link them clearly from SKILL.md.

Rules for references:

- One level deep from SKILL.md — no chains like `SKILL.md → guide.md → more-guide.md`
- Information lives in either SKILL.md or a reference, not both
- For large reference files (>300 lines), add a table of contents at the top
- Use descriptive file names

## Reference Tables

Always present references as tables with a lead-in sentence:

```md
## References

Read the reference that matches the current task:

| Topic   | When to Read     | Reference                      |
| ------- | ---------------- | ------------------------------ |
| <topic> | <selection hint> | [<name>](references/<file>.md) |
```

The second column helps the agent decide which reference to read. Name it based on what's most useful:

- **When to Read** — general purpose
- **Path** — for framework skills where file paths signal which reference applies
- **Usage** — when the agent chooses based on commands or capabilities

## Scripts and Assets

### Scripts (`scripts/`)

Executable code for deterministic or repeatedly-needed tasks.

- Include when the same code gets rewritten across invocations
- Token-efficient — may be executed without loading into context
- Handle errors inside the script, don't punt to the agent
- Document dependencies
- Run scripts before shipping to verify they work

### References (`references/`)

Documentation loaded into context on demand.

- Database schemas, API docs, domain knowledge, workflow guides
- If files are large (>10k words), include grep search patterns in SKILL.md

### Assets (`assets/`)

Files used in output, not loaded into context.

- Templates, images, icons, boilerplate code, fonts

## Anti-Patterns

Avoid:

- Vague names like `helper` or `utils`
- First-person descriptions like `I can help…`
- Bloated SKILL.md files that should be split into references
- Nested references several files deep
- Offering many equivalent options without guidance
- Prose paragraphs without actionable commands
- Ambiguous directives ("be careful", "where possible")
- Contradictory rules without explicit priority ordering
- Style guides without enforcement commands (linter, formatter)
- Tool-specific commands, fields, or templates leaking into a general, tool-agnostic skill
- Undocumented magic values or unexplained scripts
- Extraneous files (README.md, CHANGELOG.md, INSTALLATION_GUIDE.md)

## Checklist

Before finishing a skill, verify:

- [ ] Frontmatter has valid `name` and `description`
- [ ] `description` says what the skill does AND when to use it
- [ ] `description` is under 1024 characters
- [ ] SKILL.md is under 500 lines
- [ ] Long details moved into reference files (one level deep)
- [ ] References use a lead-in sentence plus a 3-column table
- [ ] Critical rules appear early in the file (front-loaded)
- [ ] Key conventions include good/bad examples where useful
- [ ] Workflow includes verification commands with expected outcomes
- [ ] Terminology is consistent throughout
- [ ] Scripts run successfully before shipping
- [ ] The skill has been exercised on real tasks
