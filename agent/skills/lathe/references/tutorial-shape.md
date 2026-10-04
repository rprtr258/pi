# Tutorial Shape

Full part template for lathe tutorials, linked from the skill. Section
*titles* must be specific to the domain — never `## Step 1: Setup`. Title the
thing the section makes: `## A scanner that recognises one-character tokens`.

```
# [Title]

[Hook — 2 to 4 paragraphs. See "Openings".]

## What you'll build

One paragraph. The concrete end state, named with the controlling example.

## Prerequisites

Bullets: tools to install, what the reader should already roughly know.

## [Specific section title — name what this section makes]

Why this exists. Then code, in small blocks, each with an insertion point.
Aside or design note where it earns its keep.

## [...]

## Checkpoint

> [!PREDICT]
> Before you run this: what output do you expect to see?

**Run this to verify your work so far:**
\`\`\`bash
<the exact command>
\`\`\`

Expected output:
\`\`\`
<what they should see>
\`\`\`

**Likely errors:**
- If you see `<exact error text>`, you probably <short causal explanation, e.g. "skipped the import in §2">.
- If you see `<exact error text>`, you probably <short causal explanation>.

## What's next

One paragraph naming the unanswered question a future part will answer. Include in every part — it invites the reader to continue.

## Exercises

1. <specific>
2. <specific>
3. <specific>

## Sources

1. [Title](url) — one sentence on why this source matters for the topic.
2. ...
```

(Numbered Sources list. Only sources cited inline. Each entry:
`[Title](url) — one sentence`. Group by primary docs / papers / deep-dives if
more than ~5 entries.)

Every part opens with *"By the end of this part, you'll have [specific,
concrete thing]"* and closes with a Checkpoint. Every part stands alone with
its own `## Exercises` and `## Sources` — since any part may become the last
one the reader sees, each must be independently complete.
