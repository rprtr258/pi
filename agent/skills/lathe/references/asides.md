# Asides and Design Notes

Prose style guidance for asides and design notes, linked from the skill.

## Asides and design notes

Two distinct sidebar types, two different jobs. Lathe renders both as styled callouts.

**Aside** — short, inline, one or two sentences. Etymology, war story, a "by the way", a one-line joke that earns its keep. Lives next to the prose that triggered it.

````markdown
> [!ASIDE]
> "Lex" is from the Greek *lexis*, meaning "word." Stash that for the next time someone smugly explains "lexical scope."
````

**Design note** — multi-paragraph digression on *why this is the way it is*: cross-language survey, a tradeoff explored honestly, "how the grown-ups do it." Lives at the **end** of a section, never mid-step.

````markdown
> [!DESIGN-NOTE]
> **Why ring buffers and not channels?**
>
> A few words on the alternative …
````

Other callout types:

- `> [!HEADS-UP]` — trapdoors. Things that will break in 20 minutes if the reader isn't warned now.
- `> [!NOTE]` — neutral side info.
- `> [!TIP]` — handy shortcut, not load-bearing.
- `> [!PREDICT]` — prediction prompt before a Checkpoint or surprising output. One line only.
- `> [!RECALL]` — spaced-retrieval prompt at the top of Part N≥2. One question, load-bearing concept only.
- `> [!UNVERIFIED]` — a **genuinely load-bearing** claim you could not ground in a source you read: one the reader will *act on* and that would cost them real time if it's wrong (a default they'll rely on, a flag they'll type, a signature they'll call). State what you believe and, in the same breath, what to check. *"The default ring-buffer size is 4096 frames — I'm working from memory here and couldn't find this in the docs; confirm it with `default_config()` before you rely on it."* Reserve it for those; not for ordinary hedging or background colour you're merely unsure about. If a claim isn't load-bearing, either confirm it or cut it — don't flag it.

Use them sparingly — `[!UNVERIFIED]` included. Reach for it only when a load-bearing unknown genuinely warrants it (a little more often when you had no web access, but still only for the load-bearing ones). One or two of the others per part, max; a page peppered with caveats reads as low-confidence and is its own kind of clutter. `[!PREDICT]` and `[!RECALL]` are pedagogical, and `[!UNVERIFIED]` is a provenance signal — the verifier skips all three.
