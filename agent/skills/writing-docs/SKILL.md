---
name: writing-docs
description: Write or revise human-facing documentation — READMEs, API references, guides and tutorials, or docs pages for skills. Use when asked to document a project, feature, API, or tool; to restructure, shorten, or review existing docs; to decide what a page should contain; or to write the docs page for a skill.
---

# Writing documentation

Documentation moves a specific reader from where they are to one piece of understanding or one completed action. Everything below serves that.

## Before writing

1. **Name the reader.** A newcomer deciding whether to adopt, a user mid-task, or a maintainer looking up an exact signature. Different readers want different pages.
2. **Name the page's single job.** If you cannot state it in one sentence, the page is two pages.
3. **Read what already exists.** Improve the existing doc, or link to it. Do not write a second version of something already documented.
4. **Find the source of truth.** Verify examples, signatures, and setup steps against the code or configuration that actually runs, not against another doc.

## Principles

- **Orient before instructing.** State what this is, who it is for, and when to use it before any step or option.
- **One page, one job.** Split pages that answer unrelated questions.
- **Explain why, not only what.** A reader who knows the reason can adapt when the details change.
- **Show the working path.** Include a complete, copy-pasteable example that produces a visible result. State the environment it was verified in.
- **State the constraint.** The one fact that changes how the reader uses the thing: a limit, a guarantee, an invocation mode, a required prior step. Put it in plain prose, not a labelled aside such as "Note:".
- **Branches belong in tables or lists.** When the reader is scanning for the one row that matches their situation, a paragraph makes them read everything.
- **Use the project's vocabulary.** Where the project has a glossary, style guide, or established domain terms, use its words and link the first use on the page. Prefer the project's term over a synonym you invent.
- **Link, do not copy.** Duplicated content drifts. Point at the canonical page, keep only the copy that must exist locally, and keep that copy in sync.
- **Cut what does not change behaviour.** History, hedging, restated links, and detail a reader will never act on.
- **Do not attribute.** Claims stand on their own; do not write "X says" or "X's position". Anonymous user reports are fine: "one user reported …".

## Match the documentation type

| Type | The reader's job | Reference |
| --- | --- | --- |
| Skill docs page | Decide whether and when to reach for a skill, and understand what it is | [skill-docs.md](references/skill-docs.md) |
| README | Decide in about a minute whether the project is for them, then get it running | [readme.md](references/readme.md) |
| API reference | Look up one exact thing and call it as documented | [api-reference.md](references/api-reference.md) |
| Guide or tutorial | Get from a starting state to a working result | [guides.md](references/guides.md) |

## Structure

Most pages fit the same skeleton. Keep the order and delete the sections the page does not need.

1. **What it is** — the one-sentence job, then the constraint.
2. **When to use it** — the trigger, and what to reach for instead when something else fits better.
3. **How to use it** — the shortest path to a working result, then the options that matter.
4. **Behaviour and edge cases** — errors, limits, failure modes.
5. **Where to go next** — the canonical page for the reader's next question.

Use exactly one title heading per page, and let each section heading say what the reader gets from it.

## Done when

- The page's single job is clear from the first screen.
- Reader, prerequisites, and the defining constraint are stated in plain prose.
- Every command and example has been run or checked, and the verification is stated where it is not obvious.
- Branching cases are tables or lists, not paragraphs.
- Terms match the project's glossary, and first uses are linked.
- Content is not duplicated from another page; it links to the source of truth instead.
- Every link resolves.
- Sections are in order, and a reader can tell when they are done.


