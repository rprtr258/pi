---
name: frontend-slides
description: Create stunning, animation-rich HTML presentations from scratch or by converting PowerPoint files. Use when the user wants to build a presentation, convert a PPT/PPTX to web, or create slides for a talk/pitch. Helps non-designers discover their aesthetic through visual exploration rather than abstract choices.
---

# Frontend Slides

Create zero-dependency, animation-rich HTML presentations that run entirely in the browser.

## Core Principles

1. **Zero Dependencies** — Single HTML files with inline CSS/JS. No npm, no build tools.
2. **Show, Don't Tell** — Generate visual previews, not abstract choices. People discover what they want by seeing it.
3. **Distinctive Design** — No generic "AI slop." Every presentation must feel custom-crafted.
4. **Progressive Disclosure** — Read lightweight style indexes first; load the full `design.md` only after the user picks a bold template.
5. **Fixed 16:9 Stage (NON-NEGOTIABLE)** — Every deck uses a 1920×1080 slide canvas scaled as a whole to the viewport. Slides stay 16:9 on every screen, including phones; never reflow slide content to fit the device.

## Design Aesthetics — read [references/design-aesthetics.md](references/design-aesthetics.md)

Avoid generic "AI slop": make creative, distinctive frontends that surprise and delight. Distinctive typography (never generic fonts), committed color themes via CSS variables (dominant colors with sharp accents), CSS-first motion focused on high-impact moments (one orchestrated page load with staggered reveals), and atmospheric layered backgrounds — never solid-color defaults, clichéd purple-gradients, or cookie-cutter layouts. Vary between light/dark, fonts, and aesthetics across generations. Full guidance: [references/design-aesthetics.md](references/design-aesthetics.md).

## Fixed Stage Rules

These invariants apply to EVERY slide in EVERY presentation:

- A viewport wrapper fills the browser window; each slide is authored inside a fixed 1920×1080 stage that scales uniformly to fit the viewport — it may letterbox/pillarbox but must not re-layout content. No responsive breakpoints to rearrange slide content for phones; fixed internal measurements at the design size.
- Slide switching uses `.active` / `.visible` with `visibility`, `opacity`, and `pointer-events` from `viewport-base.css` — never `display: none`/`block`, which later layout classes (e.g. `.slide-content { display: flex; }`) override and make every slide visible at once.
- `clamp()` only for non-slide UI outside the stage, or small fallback previews. Include `prefers-reduced-motion` support. Never negate CSS functions directly (`-clamp()`, `-min()`, `-max()` are silently ignored) — use `calc(-1 * clamp(...))`.

**When generating, read `viewport-base.css` and include its full contents in every presentation.**

### Content Density Modes

Ask whether this is a reading deck or a speaking deck, then design around the answer. **Low density / speaker-led** (public talks, keynote-style sharing, live explanation): one idea per slide, large type, strong hierarchy, generous negative space, 1-3 bullets max, more slides if needed. **High density / reading-first** (reports, handouts, async review, detailed internal docs): self-contained slides, structured grids/tables/annotations, 4-8 bullets or 4-6 cards when readable, tighter but intentional spacing. Baseline limits always apply: no scrolling, no overflow, no overlapping panels, no text below comfortable reading size — if content exceeds the mode, split into more slides instead of shrinking until cramped.

## Phase 0: Detect Mode

- **Mode A: New Presentation** — create from scratch → Phase 1.
- **Mode B: PPT Conversion** — convert a .pptx → Phase 4.
- **Mode C: Enhancement** — improve an existing HTML presentation: read it, understand it, enhance. Fixed-stage fitting is the biggest risk: before adding content, count existing elements against density limits; fit images inside the 1920×1080 canvas (split into two slides if full); max 4-6 bullets per slide, else split into continuation slides; move images to a new slide or reduce other content first — never add images to a full stage. After ANY modification, verify the stage is still 16:9, no text overflows its card, no panels overlap, and screenshots look correct at 1280×720 plus one phone viewport. If modifications will cause overflow, split content proactively and inform the user without waiting to be asked.

## Phase 1: Content Discovery (New Presentations)

**Ask ALL questions together** so the user fills everything out at once — native structured-question UI when available, else one concise message with numbered choices:

1. **Purpose** — Pitch deck / Teaching-Tutorial / Conference talk / Internal presentation
2. **Length** — Short 5-10 / Medium 10-20 / Long 20+
3. **Content** — All content ready / Rough notes / Topic only
4. **Density** — Low density / speaker-led or High density / reading-first

**Do not ask about inline editing during Phase 1** — it is a post-draft affordance, included by default unless the user explicitly asks for a locked/export-only file. Remember the density choice: it affects slide count, typography scale, text per slide, layout density, and presenter vs. reading slides. If the user has content, ask them to share it.

### Image Evaluation (if images provided)

If no images → Phase 2. With an image directory, evaluate images BEFORE asking about style and outline: scan, inspect each (or use filenames/metadata), judge USABLE / NOT USABLE with reasons, capture dominant colors, then co-design the slide outline around content AND images from the start (3 screenshots → 3 feature slides; 1 logo → title/closing). Confirm the outline and image selection with the user before style selection; embed an identified logo (base64) into each style preview. Full workflow: [references/image-evaluation.md](references/image-evaluation.md).

## Phase 2: Style Discovery

**This is the "show, don't tell" phase** — generate 3 distinct single-slide HTML previews (typography, colors, animation, aesthetic); visual comparison is always the default — never ask whether the user wants options. Use a stated vibe if given, otherwise infer mood; if they explicitly name a preset or bold template, honor it as one option and fill the remaining slots around it.

Read [STYLE_PRESETS.md](STYLE_PRESETS.md) for safe preset candidates and, if present, the compact [bold-template-pack/selection-index.json](bold-template-pack/selection-index.json) index — but no `design.md` files yet.

**Before generating any preview, read [references/style-discovery.md](references/style-discovery.md)** — the mandatory rule blocks (preview mix, custom wildcard design, bold template selection, NON-NEGOTIABLE preview authenticity, saving/opening, and the mood→preset table).

### User Picks

Ask (header: "Style"): Which style preview do you prefer? Options: Style A: [Name] / Style B: [Name] / Style C: [Name] / Mix elements. If "Mix elements", ask for specifics.

## Phase 3: Generate Presentation

Generate the full presentation from the Phase 1 content (text, or text + curated images) and Phase 2 style. The outline already incorporates provided images; if none, CSS-generated visuals (gradients, shapes, patterns) are a first-class path.

### Density

Apply the user's density choice throughout: **Low density / speaker-led** — more slides, fewer ideas per slide, large headings, short phrases, visual metaphors, quote/statement slides, presenter-friendly pacing. **High density / reading-first** — self-contained slides: structured grids, comparison tables, annotated diagrams, captions, concise explanatory copy. For mixed needs choose the closer mode: live audience persuasion defaults low-density; async circulation or detailed review defaults high-density. Never let high density become clutter — split or redesign overflowing slides.

### Recipe

If the user picked a bold template, read that one template's full `design.md` (no other templates) and treat it as the design recipe: preserve its fonts, palette, decorative vocabulary, spacing rhythm, and component grammar; generate as a fixed 1920×1080 stage scaled uniformly to the viewport, translating viewport-fluid values into stage coordinates (not live reflow rules); single self-contained HTML file, no copied demo content, `template.html` only as last-resort reference; verify content overflow AND panel overlap in rendered screenshots — `scrollHeight` checks miss grid panels visually covering each other. If they picked a custom wildcard, treat that preview's CSS and layout as the recipe and expand the same system across the full deck, never switching styles after the choice. Full recipes: [references/generation-recipes.md](references/generation-recipes.md).

### Supporting Files and Requirements

Before generating, read: [html-template.md](html-template.md) (HTML architecture and JS features) · [viewport-base.css](viewport-base.css) (mandatory — include in full) · [animation-patterns.md](animation-patterns.md) (animation reference for the chosen feeling).

Key requirements: single self-contained HTML file, all CSS/JS inline · FULL contents of viewport-base.css in the `<style>` block · fonts from Fontshare or Google Fonts, never system fonts · detailed comments, every section with a `/* === SECTION NAME === */` comment block.

## Phase 4: PPT Conversion

1. **Extract** — `python scripts/extract-pptx.py <input.pptx> <output_dir>` (install python-pptx if needed)
2. **Confirm** — present extracted slide titles, content summaries, image counts
3. **Style selection** — Phase 2
4. **Generate HTML** — chosen style, preserving all text, images (from assets/), slide order, and speaker notes (as HTML comments)

## Phase 5: Delivery

1. **Clean up** — delete `.frontend-slides/slide-previews/` if it exists
2. **Open** — `open [filename].html`
3. **Summarize** — file location, style name, slide count; navigation (arrow keys, Space, swipe/tap if enabled); customization (`:root` CSS variables, font link, `.reveal` class); inline text editing (hover top-left corner or press E, click text to edit, Ctrl+S to save); offer post-draft actions: revisions, direct browser text editing, or export/share.

## Phase 6: Share & Export (Optional)

After delivery, ask: _"Would you like to share this presentation? I can deploy it to a live URL (works on any device including phones) or export it as a PDF."_ Options: Deploy to URL / Export to PDF / Both / No thanks. If declined, stop.

### Deploy or Export — read [references/deploy-export.md](references/deploy-export.md)

Full step-by-step instructions for deploying to a live URL (Vercel) and exporting to PDF live in [references/deploy-export.md](references/deploy-export.md). Read only when the user picks one of these options.

## Supporting Files

| File | Purpose | When to Read |
| --- | --- | --- |
| [STYLE_PRESETS.md](STYLE_PRESETS.md) | 12 curated presets | Phase 2 |
| [bold-template-pack/selection-index.json](bold-template-pack/selection-index.json) | Compact bold template metadata | Phase 2 |
| [bold-template-pack/templates/*/preview.md](bold-template-pack/templates/) | Style cards for shortlisted title previews | Phase 2 after shortlisting |
| [bold-template-pack/templates/*/design.md](bold-template-pack/templates/) | Full design-system docs, selected template only | Phase 3 after selection |
| [viewport-base.css](viewport-base.css) | Mandatory fixed-stage CSS — copy into every presentation | Phase 3 |
| [html-template.md](html-template.md) | HTML structure, JS features, quality standards | Phase 3 |
| [animation-patterns.md](animation-patterns.md) | Animation snippets, effect-to-feeling guide | Phase 3 |
| [scripts/extract-pptx.py](scripts/extract-pptx.py) | PPT content extraction | Phase 4 |
| [scripts/deploy.sh](scripts/deploy.sh) | Deploy to Vercel | Phase 6 |
| [scripts/export-pdf.sh](scripts/export-pdf.sh) | Export to PDF | Phase 6 |
