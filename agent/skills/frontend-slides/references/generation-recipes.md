# Generation Recipes

Full Phase 3 recipes for frontend-slides, linked from the skill.

## Bold Template Recipe

If the user selected a bold template from `bold-template-pack`, read that one
template's full `design.md` before generating. Do not read the other bold
templates. Treat `design.md` as the design recipe:

- Preserve its fonts, palette, decorative vocabulary, spacing rhythm, and
  component grammar.
- Generate the final deck as a fixed 1920×1080 stage scaled uniformly to the
  viewport, regardless of whether the source template originally used
  `deck-stage.js` or viewport-fluid CSS.
- Treat viewport-fluid values in `design.md` as design proportions to translate
  into 1920×1080 stage coordinates. Do not keep them as live viewport reflow
  rules in the final deck.
- Keep the output as a single self-contained Frontend Slides HTML file.
- Do not copy demo slide content or mimic the source template too literally.
- Use `template.html` only as a last-resort implementation reference for the
  selected template.
- After generating, verify both content overflow and panel overlap in rendered
  browser screenshots. `scrollHeight` checks alone are not enough because grid
  panels can visually cover each other.

## Custom Wildcard Recipe

If the user selected a self-generated custom wildcard, treat that preview's CSS
and layout as the design recipe:

- Preserve its fonts, palette, decorative vocabulary, spacing rhythm, grid
  logic, and component grammar.
- Expand the same visual system across the full deck. Do not switch to a preset
  or bold template after the user has chosen the custom direction.
- Design any missing slide layouts from that system rather than importing
  patterns from another style.
- Keep the output fixed-stage, single-file, and visually verified like every
  other deck.
