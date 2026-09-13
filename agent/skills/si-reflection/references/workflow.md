# Workflow

Did this session reveal anything the next person or agent will regret not having written down?

The bar is high. Most sessions produce nothing worth adding. Saying "nothing worth codifying" is valid and often correct. Do not invent findings to justify the skill.

## 1. Gather Context

Run or inspect these where applicable:

- `git diff` — unstaged changes
- `git diff --cached` — staged changes
- `git status` — new, deleted, and renamed files
- `git log --oneline -20` — recent commit style and scope
- Existing instruction/docs files, if present:
  - `AGENTS.md`
  - `docs/*.md`

Also re-read the current session:

- What did the user correct?
- Where did the agent go in a wrong direction before finding the right path?
- What non-obvious project behavior, environment detail, or convention surfaced?
- What reusable instruction would have helped the agent reach the goal faster?

## 2. Apply the Bar

A candidate learning is worth codifying only if it meets at least one of these:

1. **Non-obvious gotcha** — something that cost real time and will likely cost time again.
2. **Convention the code does not self-document** — a pattern, naming rule, or structural choice not obvious from one file.
3. **Reusable user correction** — feedback that applies beyond the immediate task.
4. **External dependency or environment requirement** — something a fresh clone or future session needs to know.
5. **Architectural decision with a reason** — a choice that looks arbitrary without its rationale.
6. **Reusable agent workflow** — behavior that belongs in a skill because it applies across projects.

Reject candidates that are:

- A summary of what the change does.
- Already obvious from the code or commit message.
- Generic best practices not specific to this project or workflow.
- One-off debugging details unlikely to recur.
- Already covered by existing instructions or docs.

## 3. Decide the Target

- **AGENTS.md** — instructions to future agents working in this repo: commands, conventions, gotchas, “do not do X.” 
- *Docs* - documentation, architectural notes and similar.
- **Skill** — reusable agent behavior that applies across projects or recurring task types.

When in doubt:

- Should this auto-load for future agents in this repo? Use `AGENTS.md` or docs.
- Is this a repeated agent workflow independent of this repo? Create or update a skill.

If the ideal target file does not exist, propose creating it only when there is at least one solid entry. Do not create an empty scaffold.

