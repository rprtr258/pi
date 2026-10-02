# Skill documentation pages

A skill's `SKILL.md` is instructions for the agent. A docs page is the reader's front door to the same skill: what it is, when to reach for it, and where it sits among the other skills. It is not a copy of `SKILL.md`.

## Why these pages exist

Skills are not all model-invoked. Where the user has to remember that a skill exists and invoke it themselves, the documentation set is the index of what is available. Each page orients one reader around one skill, so the reader can hold it in mind and know when to reach for it. The set works as a router; each page is one node.

## When to write or update one

| Situation | Action |
| --- | --- |
| A documented skill is added | Create its page |
| A skill is renamed or moved | Move the page with it, and update links to the old path |
| A skill's behaviour changes | Re-sync the page |
| A documented skill is removed | Keep the page, mark it archived, name the version and any replacement, and leave the rest of the body intact |

Document only the skills the project exposes. Internal, in-progress, and deprecated skills get no page, and a skill gains or loses its page when its status changes.

## Page sections

Keep this order. Sections marked *always* appear on every page; the rest appear only when they carry something.

- *always* — **What it does.** One or two paragraphs. Lead with the skill's one-sentence job, then the **defining constraint**: the one fact that makes this skill behave differently from the obvious default. Write it as a plain sentence, never as a labelled aside such as "The defining constraint:" — the label reads as filler.
- *always* — **When to reach for it.** Two things: the invocation mode (does the user type a command, does the agent fire it automatically, or both) and the trigger boundary ("reach for this when …"). Where the skill is confusable with a sibling, add the other half: "for X, use the sibling skill's page instead," linked.
- **Prerequisites.** Only when the skill needs something in place: a workspace it writes into, prior setup, or project-specific tooling. Omit the heading entirely when there is none.
- **Free-form middle.** One to three short sections in the skill's own vocabulary — the loop it runs, the artifact it produces, the choice it makes. There is no fixed heading; skills are too different for one. Surface at least the skill's **leading word**: the term the reader will later think with when they reach for it.
- **Common questions.** Questions readers actually ask, each in bold with the answer below it, ordered by how often it comes up. Prefer observed questions over invented ones: search the project's issues, changelog, discussions, and support channels before writing any. Size the section to the evidence — a well-discussed skill earns six questions, an obscure one earns one or none. Omit the heading when there is nothing worth answering, and say the unflattering thing where it is true.
- **It's working if.** A few bullets naming what the reader sees when the skill is doing its job. Each must be checkable without opening `SKILL.md` — a signal in the reader's own work. "The document gets shorter as it gets better" qualifies; a check on the skill's internal files does not.
- *always* — **Where it fits.** One or two sentences placing the skill in the system: its role (a step in a chain, run-once setup, periodic maintenance, or standalone), the one or two neighbouring skills that matter, each with a reason, and a link to whatever page routes over the whole set.

## Conventions

- Explain why, not the runbook. Do not reproduce `SKILL.md` steps or templates; a reader choosing a tool does not need them.
- Carry no install, setup, or update commands unless the page is their canonical home. Point at the one place they live.
- Use the skill's own leading words, so the page and the skill speak one language.
- Use the project's glossary terms and link the first use; leave later occurrences unlinked. Do not link inside a heading, a code span, or an existing link.
- Never attribute a claim to a named person. State the substance as a plain claim about the skill. A quoted *user* report is fine and stays anonymous.
- Keep the page low-load: no spare headings, no restated links.

## Done when

- The page exists at the documented path, and no stale page survives a rename or a status change.
- The page carries no duplicated install or setup commands.
- "What it does" states the defining constraint as plain prose.
- The page names no author and quotes no author.
- "When to reach for it" states the invocation mode and the trigger boundary.
- "Where it fits" names the role and links to the router page.
- Prerequisites are stated where they exist, and the section is absent where they do not.
- The middle surfaces the leading word.
- Glossary terms match the project's spelling, and only their first use is linked.
- Every multi-way branch is a table or a list.
- The search for real questions ran, and "Common questions" is sized to what it found.
- Every "It's working if" bullet is checkable without opening `SKILL.md`.
- Sections appear in the order above.
- Every link resolves.
