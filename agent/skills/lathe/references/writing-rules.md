# Writing Rules — Pre-flight, Visuals, Code, Endings

Voice-independent writing rules for lathe tutorials, linked from the skill.
Read before writing; these are constraints on your prose, not user-facing
artifacts.

## Pre-flight (private — do not ask the user)

Settle these in your head before writing.

- **Research and sources.** Cite load-bearing sources inline, list them in
  `## Sources`, `[!UNVERIFIED]`-mark anything unconfirmed. A load-bearing claim
  — a number, a default, a semantic guarantee, a historical fact — is grounded
  or flagged, never asserted from recall.
- **The controlling example.** Pick one concrete artifact and stay with it
  (*"a 4-voice subtractive synth playing a sustained A minor triad"*, *"a
  key-value store called `pebble` that survives `kill -9`"*). Never switch
  examples mid-tutorial.
- **Specific numbers.** Sample rate, buffer size, page size, latency budget —
  whatever the domain offers. Numbers earn the reader's trust. Decide them now
  so they're consistent across parts.
- **One controlling metaphor (optional but powerful).** A mountain, a factory
  line, a kitchen. Deploy it across at least three section transitions, then
  *explicitly retire it* with a wink. Don't mix metaphors silently.
- **The closing send-off.** What should the reader be ready to do *beyond* what
  you taught? Sketch the "go climb your own mountain" beat now so the body
  builds toward it.
- **3–5 exercises**, each specific enough that a motivated reader could start
  it in 30 seconds.

## Visual artifacts

Diagrams earn their keep when they show something prose can't: a
*transformation* (input shape → output shape), a *pipeline* (who hands off to
whom), a *relationship between sets* (Venn/taxonomy). **Don't diagram a
sequence of steps** — that's numbered prose.

Tools, by job: Mermaid `flowchart`/`graph` — pipelines, decision branches,
architecture · `sequenceDiagram` — request/response, message passing ·
`stateDiagram-v2` — protocol states, parser modes, lifecycles · `erDiagram` —
schemas and table relationships · Markdown tables — comparing 2–5 alternatives
across a few axes (tables beat prose for this) · ASCII art in a code block —
memory layouts, byte structures, tree shapes needing column alignment.

Aim for **one diagram per part**, only when a moment genuinely benefits. Place
it next to the prose that explains it; never drop one in cold without a
sentence framing what to look at first. Cap nodes at ~10 — split or convert to
a table if larger.

## Code

- One sentence before every block, telling the reader what to look at first.
- Blocks are 3–15 lines, except for full small files. Larger means split.
- For modifications, name the seam: *"Inside `process_buffer`, just after the
  voices loop:"*. The reader has to find where to splice.
- No unexplained `...` ellipses. If you elide, name what's elided and why.
- Code is complete enough to run as shown — the reader copies, saves, and sees
  something predictable happen.

**Faded scaffolding.** The first code block in each part is fully worked —
reader copies, saves, runs, sees output. The last one or two shift to
fill-the-seam: name the pattern the reader has seen, then ask them to write the
next instance (*"You've seen how `Attack` ramps from 0 to 1. Using the same
pattern, write `Release` — it ramps from 1 back to 0 over `release_time`
samples. Then run the Checkpoint."*). Not an open exercise: the template is in
front of them; exactly one step ahead of where you stopped.

## Endings

Every major section ends with a one-sentence forward pointer naming the
question the next section answers. Every part ends with **four** things:

1. **A send-off (or forward hook).** Final part: one short paragraph inviting
   the reader to leave the path you took. Non-final: a single forward-pointing
   sentence naming the question the next part answers — lean into the
   cliffhanger.
2. **A closing reflection.** One self-explanation prompt, in plain prose (not a
   callout): pick the single most important design decision in this part and
   ask the reader to explain the *why*, not the *what* — *"Before you move on:
   in two sentences, why does the ring buffer beat a channel here?"* Don't
   answer it for them.
3. **`## Exercises`** — numbered, 3–5, each startable in 30 seconds. *"Add FM
   modulation between two oscillators. At minimum, let oscillator 2 modulate
   oscillator 1's frequency."* Not *"explore further."*
4. **`## Sources`** — numbered, one entry per source used inline in *this
   part*: `[Title](url) — one sentence on why this source matters`. Group by
   primary docs / papers / deep-dives if more than ~5 entries.
