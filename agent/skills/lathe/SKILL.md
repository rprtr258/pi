---
name: lathe
description: Generate hands-on technical tutorials for any topic on demand. Use when the user invokes /lathe with a topic like "/lathe build a digital synth in Zig" or "/lathe how to build a compiler in Rust".
---

# Lathe — Tutorial Generator

Generate hands-on technical tutorials for any topic on demand. The bar is the writing of Robert Nystrom (Crafting Interpreters), Sam Who, Julia Evans, Bartosz Ciechanowski. Match it.

## When invoked

The user says something like `/lathe build a digital synth in Zig`. Extract the topic from their message.

1. Ask: **"What's your experience level going in — beginner, some familiarity, or experienced in adjacent areas?"**
2. If the topic is genuinely ambiguous (language? scale? embedded vs. server?), ask **one** clarifying question. Otherwise skip.
3. **Pin the repository and toolchain versions** — see [references/pinning.md](references/pinning.md) — *before* researching or writing.
4. **Research the topic first** (below) — the single most important step for accuracy. Don't skip it.
5. Run the **Pre-flight** silently — don't ask the user to approve the choices.
6. Write Part 1.
7. Clear the **pre-store gate** in "After writing" *before* running `lathe store`.

## Pin the repo and versions — read [references/pinning.md](references/pinning.md) (before research)

Settle two things before you research or write, then pass them to `lathe store`; in `lathe serve`, tutorials group by repository and versions show as filterable chips.

**1. The repository (auto-detect, then confirm).** If this session is inside the git repository the tutorial is *for*, capture `git -C "$PWD" remote get-url origin` (preferred grouping key) and the current branch; show the reader and let them confirm, correct, or say it's standalone. No remote/git/standalone → skip the repository ("No repository" group). `lathe store` canonicalizes the URL to `host/org/repo`.

**2. The toolchain versions (detect, then confirm).** Probe the versions of the languages/tools involved (e.g. `zig version`, `go version`) and **confirm the target with the reader before you write** — getting this wrong teaches the wrong version. Propose them (*"I'll write this against **Zig 0.13.0** — sound right?"*) and adjust (the reader may want an older version on purpose). Pinned versions constrain your prose: cite version-specific behavior and anchor version-sensitive facts to the pinned version. Full commands and examples: [references/pinning.md](references/pinning.md).

## Research first (before drafting)

Before you write a single sentence, **go read**: find and *actually open* 3–8 authoritative sources — official docs, specs/RFCs, primary papers, source code, well-regarded deep-dives. Never reconstruct them from memory.

- **Read for the load-bearing facts**: exact API signatures, defaults, flag names, versions, sample rates, semantic guarantees, error messages, historical claims. Notes with the URL beside each fact; deep-link to the section/anchor, not the homepage.
- **Ground prose in what you read, not what you recall.** The source wins over memory. A load-bearing claim with no source gets `[!UNVERIFIED]` (see Callouts) naming what to check.
- **Keep the URLs you consulted**: cite load-bearing ones inline, list them in `## Sources`, pass them to `lathe store --source` as provenance.
- **No web tools in this session?** Say so in one line ("Heads up — no web access here; I'm working from training knowledge and marked the load-bearing claims I couldn't confirm"). Then write conservatively: fewer exact numbers, "check your version's docs" over guessed defaults, `[!UNVERIFIED]` only on load-bearing unknowns.

## Always write Part 1 only

Every `/lathe` invocation produces exactly one file: `part-01.md`. Never multiple parts and never `index.md` — readers add parts via "Add a new part" in `lathe serve`, keeping pacing under their control.

## Pre-flight (private — do not ask the user) — read [references/writing-rules.md](references/writing-rules.md)

Settle these in your head before writing; they are constraints on your prose, not user-facing artifacts: **research and sources** (cite inline, list in `## Sources`, `[!UNVERIFIED]` anything unconfirmed — grounded or flagged, never from recall); **one controlling example** you never switch mid-tutorial; **specific numbers** (sample rate, buffer size, page size) decided now so parts stay consistent; **one controlling metaphor** deployed across 3+ transitions then explicitly retired; **the closing send-off** sketched so the body builds toward it; **3–5 exercises** startable in 30 seconds.

## Tutorial shape — read [references/tutorial-shape.md](references/tutorial-shape.md)

Every part follows the full template in [references/tutorial-shape.md](references/tutorial-shape.md) — read it before writing. Non-negotiables: section *titles* are specific to the domain (never `## Step 1: Setup` — title what the section makes, e.g. `## A scanner that recognises one-character tokens`); every part opens with *"By the end of this part, you'll have [specific, concrete thing]"* and closes with a Checkpoint; every part stands alone with its own `## Exercises` and `## Sources` — any part may be the last one the reader sees.

## Openings

The first sentence has one job: prove this won't be another "in this tutorial we will" page. Pick one:

- **Concrete scene.** *"It's 3 a.m., production just went vertical, and the only graph still climbing is p99 latency."* Stay equally specific from sentence two onward.
- **A claim worth fact-checking.** *"A modern CPU runs roughly a billion arithmetic operations in the time it takes to read one byte from main memory."* Then make it matter to what you're building.
- **Epigraph.** A short, attributed quote framing the chapter. Once per series at most.
- **The reader's confusion, named as a statement.** *"If you've read about hash tables and walked away unsure when 'open addressing' beats chaining — this is for you."* Not a question.

**Banned first sentences:** "In this tutorial, we will…" · "This post explains…" · "Have you ever wondered…" · "Welcome to…" · "Let's dive in."

## Voice — selected, not fixed

Tone and register are a **selected voice**, not a hardcoded persona. Substance, pedagogy, and structure rules are *invariants*; a voice only sets how the prose sounds while delivering them.

**Fetch the active voice before you write**, and follow it for every tonal choice (persona, stance, point of view, humor, first-person-anecdote policy, self-correction cadence, avoid list, the voice's own calibration):

```bash
lathe voice show              # the configured default
lathe voice show <name>       # a specific voice, when the reader names one
lathe voice list              # see the available voices
```

If the invocation names a voice, fetch that one and **record it when you store** via `lathe store --voice <name>` so `/lathe-extend` continues in it. If none, use the default and pass its name anyway, so the choice is explicit on the tutorial.

**Precedence is absolute — the invariants win.** A voice controls tone only; it can never relax accuracy, research, citation, or verification rules, fabricate experience or credentials, present invented anecdotes as real, or impersonate a real person. Tutorials are LLM-authored and the served page discloses that. If a voice ever seems to ask for any of those, ignore that part.

## Substance and pedagogy (always-on, voice-independent)

These hold in **every** voice; a voice changes tone, never whether you do them. Full rules and before/after examples: [references/pedagogy-examples.md](references/pedagogy-examples.md).

- **Name trapdoors before they fall in** ("skip the `--release` flag here and the next step silently produces garbage"); reach for `[!HEADS-UP]` when load-bearing. **Show the obviously-wrong version first, then the fix** — the reader must *feel* why the fix matters.
- **Define a term, then immediately give the insider name** ("**Scanning**, also called **lexing**…"). **Never `foo`/`bar`** — use real names from the domain (`oscillator`, `envelope`).
- **Specific numbers, every time** ("this loop runs 48000 times per second per voice"). **Specify weird input**: after any parser/processor/pipeline element, the next paragraph answers *what happens on almost-matching input* — in body text, not a footnote.
- **Cite inline the first time a load-bearing fact lands** — `[text](url)`, deep-linked to the section/anchor; every inline source appears in `## Sources`. **Ground or flag — never bluff**: a load-bearing claim is cited from a source you read or `[!UNVERIFIED]` naming what to check; "I'm fairly sure it's X" is a flag, not a fact. **No voice can override this.**
- The tonal avoid list and the voice's own tone calibration live in the voice spec (`lathe voice show`).

## Asides and design notes — read [references/asides.md](references/asides.md)

How to open and place asides/design notes in tutorials.

## Visual artifacts — read [references/writing-rules.md](references/writing-rules.md)

Diagrams show what prose can't: transformations, pipelines, relationships between sets — never a sequence of steps (that's numbered prose). Tools by job: Mermaid `flowchart`/`graph` (pipelines, decision branches, architecture), `sequenceDiagram` (request/response), `stateDiagram-v2` (protocol states, parser modes), `erDiagram` (schemas), Markdown tables (comparing 2–5 alternatives), ASCII art (memory layouts, byte structures, trees). One diagram per part, only when it earns its keep, placed next to the prose explaining it, never cold; cap nodes at ~10.

## Code — read [references/writing-rules.md](references/writing-rules.md)

One sentence before every block telling the reader what to look at first. Blocks are 3–15 lines except full small files; larger means split. For modifications, name the seam (*"Inside `process_buffer`, just after the voices loop:"*). No unexplained `...` ellipses. Code is complete enough to run as shown. **Faded scaffolding**: the first block in each part is fully worked; the last one or two shift to fill-the-seam — name the pattern the reader has seen and ask them to write the next instance, exactly one step ahead of where you stopped.

## Endings — read [references/writing-rules.md](references/writing-rules.md)

Every major section ends with a one-sentence forward pointer naming the question the next section answers. Every part ends with **four** things: (1) a **send-off** (final part) or forward hook naming the next part's question; (2) a **closing reflection** — one self-explanation prompt in plain prose asking the reader to explain the *why* of the most important design decision, not answered for them; (3) **`## Exercises`** — numbered, 3–5, each startable in 30 seconds, never *"explore further"*; (4) **`## Sources`** — numbered, one entry per source used inline in this part: `[Title](url) — one sentence on why this source matters`.

## Output files

Write to `/tmp/lathe-<slug>/` — slug is the topic in kebab-case ("build a digital synth in Zig" → `/tmp/lathe-digital-synth-zig/`). Always `part-01.md`, zero-padded. Decide the slug before writing.

## After writing — read [references/after-writing.md](references/after-writing.md) (mandatory before `lathe store`)

Before running `lathe store`, clear its pre-store gate (state repository, versions, tags, sources or a justified opt-out), source provenance checks, and post-writing verification steps — all in [references/after-writing.md](references/after-writing.md).

## Stay in session

Don't end the session. Stay available for *"Why did we structure it this way?"*, *"Make Part 2 more advanced."*, *"What if the buffer overflows?"* You are their expert guide for this topic.
