---
name: algorithmic-art
description: Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.
---

Algorithmic philosophies are computational aesthetic movements expressed through code. Output: a philosophy (.md), an interactive viewer (.html), and a generative algorithm (.js) — one p5.js sketch, 90% algorithmic generation, 10% essential parameters.

**Two steps:**
1. Create an Algorithmic Philosophy (.md)
2. Express it as p5.js generative art (.html + .js)

## Step 1 — Algorithmic Philosophy Creation

Receive subtle user input and use it as the foundation, never as a constraint on creative freedom. Create an ALGORITHMIC PHILOSOPHY — not static images or templates — expressed through:

- Computational processes, emergent behavior, mathematical beauty
- Seeded randomness, noise fields, organic systems
- Particles, flows, fields, forces
- Parametric variation and controlled chaos

### How to write it

- **Name the movement** (1–2 words): "Organic Turbulence" / "Quantum Harmonics" / "Emergent Stillness".
- **Articulate the philosophy** in 4–6 substantial paragraphs covering: computational processes and mathematical relationships; noise and randomness patterns; particle behaviors and field dynamics; temporal evolution and system states; parametric variation and emergent complexity.
- **Avoid redundancy** — mention each algorithmic aspect once.
- **Emphasize craftsmanship repeatedly**: stress that the final algorithm must appear meticulously crafted, refined through countless iterations, the product of deep computational expertise ("master-level implementation", "painstaking optimization"). This framing is essential.
- **Leave creative space**: be specific about algorithmic direction but concise enough that the implementer makes high-level interpretive choices.
- Guide the next phase to express ideas ALGORITHMICALLY — beauty lives in the process, not the final frame. Output the philosophy as a .md file.

Condensed inspiration: [references/philosophy-examples.md](references/philosophy-examples.md) — write original work, never copy an example.

### Essential principles

- **ALGORITHMIC PHILOSOPHY**: a computational worldview expressed through code
- **PROCESS OVER PRODUCT**: beauty emerges from the algorithm's execution — each run is unique
- **PARAMETRIC EXPRESSION**: ideas communicate through mathematical relationships, forces, behaviors — not static composition
- **PURE GENERATIVE ART**: living algorithms, not static images with randomness
- **EXPERT CRAFTSMANSHIP**: the result must feel meticulously crafted, refined through deep expertise

## Deducing the Conceptual Seed

Before implementing, identify the subtle conceptual thread in the original request: a **subtle, niche reference embedded within the algorithm itself** — never literal, always sophisticated. Someone familiar with the subject should feel it intuitively; others simply experience a masterful composition. Like a jazz musician quoting another song through harmonic substitution — only those who know will catch it.

## Step 2 — p5.js Implementation

### STEP 0: read the template first

1. **Read** [templates/viewer.html](templates/viewer.html) with the Read tool and study its structure, styling, and Anthropic branding.
2. **Use it as the LITERAL STARTING POINT**: keep all FIXED sections exactly as shown; replace only the VARIABLE sections marked in the file's comments (algorithm, parameters, parameter UI controls).
3. Never create HTML from scratch, invent custom styling/themes, or change the sidebar structure.

**FIXED (keep exactly):** page layout (header, sidebar, canvas area); Anthropic branding (Poppins/Lora fonts, light colors, gradient backdrop); Seed section (display, Previous/Next, Random, jump-to-seed input); Actions section (Regenerate, Reset, Download PNG).

**VARIABLE (customize per artwork):** the entire p5.js algorithm (`setup`/`draw`/classes); the parameters object; the Parameters sidebar section (control count, names, min/max/step, control types); optional Colors section (include color pickers only if the art needs an adjustable palette; skip when monochrome or fixed).

Every artwork gets unique parameters and algorithm — fixed parts give consistent UX, everything else expresses the vision.

### Technical requirements

**Seeded randomness** (Art Blocks pattern):

```javascript
let seed = 12345; // or hash from user input
randomSeed(seed);
noiseSeed(seed);
```

**Parameters — follow the philosophy.** Ask "what qualities of this system can be tuned?" — quantities, scales, probabilities, ratios, angles, thresholds. Always include `seed`. Design for tunable properties, not "pattern types".

**Core algorithm — express the philosophy.** Don't pick from a menu; ask "how do I express this philosophy in code?"

- Organic emergence → accumulating/growing elements, constrained random processes, feedback loops
- Mathematical beauty → geometric ratios, trigonometric harmonics, precise calculations yielding unexpected patterns
- Controlled chaos → random variation within strict boundaries, bifurcation, order from disorder

**Canvas**: standard p5.js `setup()`/`draw()`; static art may use `noLoop()`.

### Craftsmanship requirements

Tune every parameter; ensure every pattern emerges with purpose. This is CONTROLLED CHAOS, not random noise.

- **Balance**: complexity without visual noise; order without rigidity
- **Color harmony**: thoughtful palettes, not random RGB
- **Composition**: visual hierarchy and flow even in randomness
- **Performance**: smooth, real-time-optimized if animated
- **Reproducibility**: same seed ALWAYS produces identical output

## Single-Artifact Requirements

One self-contained HTML file: p5.js from CDN (cdnjs p5.js 1.7.0), the algorithm, parameter controls, and UI inline. No external files or imports except the CDN; embed all code (no separate .js files). Works immediately in claude.ai artifacts or any browser — no server needed. Fully shareable by sending the file.

Required features:

1. **Parameter controls** — sliders for numeric parameters, color pickers where needed, real-time updates, reset to defaults:

```html
<div class="control-group">
  <label>Parameter Name</label>
  <input type="range" id="param" min="..." max="..." step="..." value="..." oninput="updateParam('param', this.value)">
  <span class="value-display" id="param-value">...</span>
</div>
```

2. **Seed navigation** — display current seed; Previous/Next buttons; Random button; jump-to-seed input. Generate 100 variations on request (seeds 1–100).
3. **Actions** — Regenerate, Reset, and Download PNG buttons, all working.

## Variations & Exploration

Seed navigation lets users explore variations within the single artifact. For requested highlight variations: add seed preset buttons ("Variation 1: Seed 42") or a Gallery Mode with side-by-side thumbnails. Same algorithm — each seed is a different facet.

## Process Summary

1. Interpret the user's aesthetic intent
2. Write the algorithmic philosophy (4–6 paragraphs, .md)
3. Implement it in code — the algorithm expresses the philosophy
4. Design parameters for what should be tunable
5. Build matching UI controls

Constants: Anthropic branding, seed navigation, self-contained single HTML artifact. Everything else is variable.

## Resources

- [templates/viewer.html](templates/viewer.html) — REQUIRED starting point for all HTML artifacts; extensive comments mark keep vs replace.
- [templates/generator_template.js](templates/generator_template.js) — p5.js best practices: parameter organization, seeded randomness, class structure. Not a pattern menu.
- [references/philosophy-examples.md](references/philosophy-examples.md) — example philosophies for inspiration.
