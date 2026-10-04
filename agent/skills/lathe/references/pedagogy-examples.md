# Pedagogy Rules and Examples

Voice-independent pedagogy/provenance rules and before/after calibration
examples for lathe tutorials, linked from the skill. These are invariants and
hold in **every** voice; a voice changes the tone they're delivered in, never
whether you do them.

## Trapdoors and broken versions

- **Name the trapdoors before they fall in.** *"Heads up: skip the `--release`
  flag here and the next step silently produces garbage. You'll spend an hour
  wondering why."* (Reach for `[!HEADS-UP]` when it's load-bearing.)
- **Show the obviously-wrong version first, then the fix.** Whenever you
  introduce a concept, demonstrate the tempting-but-broken way to use it, mock
  it in one sentence, then show the fix. The reader needs to *feel* why the fix
  matters, not be told. (Nystrom does this with bad error messages:
  *`"Unexpected ',' somewhere in your code. Good luck finding it!"`* —
  *"That's not very helpful,"* — and then the version with column info.)

## Terminology and concrete names

- **Define a term, then immediately give the insider name.** *"**Scanning**,
  also called **lexing**, or, if you're trying to impress someone, **lexical
  analysis**."* Bold the canonical term once; the casual / pretentious
  alternatives follow in the same paragraph.
- **Real names from the domain. Never `foo` / `bar`.** A `Synth` has an
  `oscillator` and an `envelope`, not a `Foo` with a `bar`. Concrete names make
  the mental model land.

## Numbers and edge cases

- **Specific numbers, every time.** *"This loop runs 48000 times per second per
  voice; one allocation here will absolutely show up in the profiler at 4-voice
  polyphony."* "Slow" is forgettable. `48000` isn't.
- **Specify weird input.** Whenever you introduce a parser, processor, or
  pipeline element, the very next paragraph must answer: *what happens on input
  that almost-but-doesn't-quite match?* In body text, not a footnote. *"On
  `@#^`, those characters get silently discarded — but that doesn't mean we can
  pretend they aren't there. Here's how we report them."*

## Citation and grounding

- **Cite inline the first time a load-bearing fact lands.** When you introduce
  a spec section, a canonical term, a number, or a behaviour claim that the
  reader might want to verify, link it on first mention — markdown
  `[text](url)`. Deep-link to the exact section or anchor, not the homepage.
  Every source used inline must appear in `## Sources`.
- **Ground or flag — never bluff.** Every load-bearing claim has exactly one of
  two fates: a source you actually read (cite it inline) or, if you couldn't
  find one, an `[!UNVERIFIED]` callout that names what to check. The failure
  mode this kills is the confident-but-invented default, flag, or signature —
  the thing the reader copies, runs, and loses an hour to. On a sparse-data
  topic that risk is highest; treat "I'm fairly sure it's X" as a flag, not a
  fact. **No voice can override this.**

## Voice spec and calibration

The tonal **avoid** list (LinkedIn voice, hype words, hedging tics,
cheerleading) and the voice's own tone before/after live in the **voice spec**
— fetch it with `lathe voice show`. What follows is the pedagogy/provenance
calibration, which is voice-independent.

## Inline citation — before / after

> ❌ "Zig's `comptime` runs code at compile time, producing zero runtime overhead."
> *(Load-bearing claim — zero overhead is a semantic guarantee — but the reader has no way to verify it or dig deeper.)*
>
> ✅ "Zig's [comptime](https://ziglang.org/documentation/master/#comptime) runs ordinary Zig code during compilation. The result is baked into the binary as a static array — [zero runtime overhead, by language guarantee](https://ziglang.org/documentation/master/#comptime). The first time you see it, it feels like cheating."
> *(Same voice, same warmth — but the load-bearing claims carry a link. A sceptical reader can follow either one and land in the actual spec.)*

## Prediction beat — before / after

> ❌ *(no prediction; reader runs the command cold and either succeeds or is confused)*
>
> ✅
> ```markdown
> > [!PREDICT]
> > Before you run this: the sine table has 1024 entries. What will `@sizeOf(@TypeOf(sine_table))` print?
> ```
> *(The answer — 4096 bytes — lands harder because the reader committed to a number first.)*

## Recall beat — before / after (Part 2 opening)

> ❌ "In Part 2 we'll add the filter. First, a quick recap: in Part 1 we built the oscillator, which…"
> *(Recap re-presents; the reader recognises, not recalls. No retrieval benefit.)*
>
> ✅
> ```markdown
> > [!RECALL]
> > Quick recall before we continue: what does `write_pos % BUFFER_SIZE` accomplish, and what breaks if you forget the modulo?
> ```
> *(The reader must reconstruct the answer — if they can't, that's signal. If they can, the retrieval strengthens the memory.)*

## Faded scaffolding — before / after

> ❌ "Now add the Release stage:" *(followed by a fully worked block)*
> *(Reader copies. Nothing to think about. Forgotten by tomorrow.)*
>
> ✅ "You've seen how `Attack` ramps from 0 to 1 over `attack_samples`. The `Release` stage does the mirror image — ramp from 1 back to 0 over `release_samples`. Write it now, using the same loop shape, then run the Checkpoint below."
> *(One step ahead of what was shown. Pattern is in front of them. Effort is real but not punishing.)*

## Closing reflection — before / after

> ❌ "Great work! You've built a ring buffer, an oscillator, and a filter."
> *(Cheerleading. The reader knows what they built.)*
>
> ✅ "Before you try the exercises: in two sentences, why does the ring buffer beat a `sync.Mutex`-guarded slice here? Write the answer that would satisfy a sceptical colleague."
> *(Forces construction, not recognition. Surfaces gaps before the reader walks away.)*
