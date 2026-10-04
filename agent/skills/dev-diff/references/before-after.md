# Before / After Is The Headline

Full comparison-block rules for visual recaps, linked from the skill.

The recap's center of gravity is the before/after comparison. For UI diffs the
wireframes are that comparison — [references/ui-coverage.md](ui-coverage.md)
owns the visual before/after rules; [references/wireframe.md](wireframe.md)
owns the layout (the `columns` renderer keeps narrow surfaces side by side and
auto-stacks wide `desktop`/`browser` frames vertically).

For structured comparisons:

- **`columns`** — the side-by-side container for **structured** comparisons: two
  columns labeled `Before` and `After`, each holding a block (commonly
  `data-model`, `api-endpoint`, or `rich-text`). Right for "the schema went from
  X to Y" or "the endpoint contract changed like this"; do not use it simply to
  compact or group a list of API endpoints.
- **`diff`** — for **code**: literal removed/added lines, for the actual hunks.
  Split mode by default for recap code review; reserve `mode: "unified"` for
  genuinely narrow standalone hunks. Key-file diff groups use horizontal tabs so
  split diffs get full document width.

There is no other multi-column primitive: `columns` plus `diff` are the whole
comparison vocabulary — never hand-build side-by-side layouts in `custom-html`,
and never stack two `data-model` blocks vertically and call it a comparison.
