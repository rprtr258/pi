# Block Authoring Reference

Complete block authoring material, linked from the skill: Diff → Block Mapping, block reference, and before/after comparison primitives.

## Diff → Block Mapping

Map each kind of change to the block that carries it, derived mechanically from
the actual diff. The names below are the CONCEPTUAL block types, not the JSX
tags — resolve every conceptual name to its exact tag + prop schema with the
`get-plan-blocks` tool (see "Block reference" below) before authoring.

- **Schema / migration change** → `data-model` for the resulting entities,
  fields, and relations. Flag what moved per field/entity with
  `change: "added" | "modified" | "removed" | "renamed"`, and for a changed type
  set `was` to the prior value (e.g. the old column type) — grounded in the real
  migration diff. That diff-aware `data-model` is the headline; reach for a split
  `diff` of the literal SQL only when the exact statement still matters, not by
  default.
- **API / action / route change** → `api-endpoint` with the method, path,
  params, request, and responses as they are after the change. Flag each changed
  param/response with `change` (and `was` on a param whose type/shape changed),
  and set `change` on the endpoint root for a wholly added or removed route. Mark
  removed endpoints with `deprecated: true` and explain in prose.
  Keep multiple API endpoints in the normal single-column document flow unless
  they are an explicit before/after contract comparison.
  Author each request/response example as a SINGLE valid JSON value — one
  top-level object or array, parseable on its own — so it renders in the
  collapsible JSON explorer. Do not put `//` or `/* */` comments, prose,
  trailing commas, or two or more concatenated top-level objects inside one
  example; a non-parseable body falls back to flat text and loses the explorer.
  When an endpoint has several distinct message shapes (for example separate
  websocket frame types, or a success body versus an error body), give each its
  OWN example with its own label rather than cramming them into one body.
- **Compatibility-sensitive change** → short `rich-text` notes beside the
  relevant `data-model` / `api-endpoint` block. Name the changed field,
  endpoint, or behavior and mark whether it is breaking, risky, or non-breaking;
  pair that note with a split `diff` for the literal lines.
- **Any meaningful code hunk** → `diff` with `mode: "split"`, carrying the real
  `before` / `after` text and the `filename` / `language`. Split mode is the
  default for recap code review because before/after legibility is the point;
  use `mode: "unified"` only for a genuinely narrow standalone hunk where
  side-by-side would hide the code. Give every `diff` a one-line `summary`
  saying what the hunk changes and why; it renders as a description above the
  code so the reviewer reads intent first. Never leave a diff unlabeled.
  For the KEY changed files, attach `annotations` to the `diff` so the recap
  calls out what each important hunk does — this is the headline affordance for
  annotating the key files updated. Each annotation anchors to the AFTER-side
  line numbers by default (set `side: "before"` to point at removed lines). Keep
  it to a few high-signal notes per file, not one per line.
  When several key files each need a substantial diff, introduce the group with a
  `rich-text` heading block whose markdown is `## Key changes`, then place the
  `diff` blocks under it in a reusable `tabs` block with horizontal orientation
  (the default — omit `orientation`) so the selected file's split diff gets the
  full document width. Let that heading label the section — do NOT also set a
  `title` on the `tabs` block. Keep each tab label to the file path or a short
  basename plus directory hint.
  If the recap ends with more than one supporting diff, that trailing diff
  appendix should be one horizontal `tabs` block under its own `## Key changes`
  heading, not a stack of separate `diff` blocks.
- **Brand-new file or a substantial added block with no meaningful "before"** →
  `annotated-code` rather than a one-sided split `diff`. Carry the real new code
  with its `filename` / `language` and anchor a few high-signal notes to the lines
  that matter so the reviewer reads what the new code does, not code for code's
  sake. Keep split `diff` for true before/after hunks where the removed lines
  still carry meaning, and group several annotated walkthroughs in a horizontal
  `tabs` block the same way diffs are grouped.
- **Files added / removed / renamed** → `file-tree` with each entry's `change`
  flag (`added`, `removed`, `modified`, `renamed`) and a short `note`; attach a
  `snippet` only when one tells the reviewer something the path does not.
- **Rendered UI / interaction change** → one or more wireframes showing the
  visible UI delta before the reviewer reads code. Use `Before` / `After`
  wireframes when the comparison clarifies the change; otherwise use after-only
  or a short state/flow sequence. Use realistic UI surfaces: for a popover
  change, show a popover with its title row, top-right actions, options/fields,
  tabs, selected/disabled states, people/lists/rows, and any opened prompt/menu
  anchored to the correct trigger. If a route was added, show the route body and
  the unavailable/empty state when the diff implements one. If permissions
  changed, show what managers can do and what viewers/non-managers see instead.
  Keep the body lean: the wireframe carries the UI story, while the file tree
  and `diff` blocks carry implementation evidence.
- **Architecture or data-flow shift** → `diagram` with `data.html` / `data.css`
  as a two-panel before/after, layered, or swimlane layout, or `mermaid` for a
  quick graph. Use two-dimensional layouts; do not reduce a structural change to
  a left-to-right chain. Do not use `diagram` as a stand-in for rendered UI
  controls; UI changes need `wireframe` blocks.
  Author diagram HTML/CSS with the renderer-owned `.diagram-*` primitives
  (`.diagram-panel`, `.diagram-node`, `.diagram-pill`, `[data-rough]`, …) and
  the same `--wf-*` theme tokens `references/wireframe.md` defines — never
  `font-family`, hex, rgb/hsl literals, or one-off dark/light palettes.
- **Outcome-first narrative** → `rich-text` for the "what changed and why" prose:
  the objective the diff served, the key decisions visible in it, and the risks a
  reviewer should weigh. This is the only place the model writes freely.

## Block reference — call `get-plan-blocks`, do not memorize tags

The conceptual block names above (`api-endpoint`, `data-model`, `json-explorer`,
`tabs`, …) are NOT the JSX tags you author with, and the exact tags, required
fields, and prop shapes change as the block library evolves. Do not author from
memorized tags — they drift and silently produce a wrong tag (`ApiEndpoint`
instead of `Endpoint`, `JsonExplorer` instead of `Json`, `Tabs` instead of
`TabsBlock`) that errors on import.

**Before writing any structured plan content, fetch/read the block catalog.** In
hosted or self-hosted mode, call `get-plan-blocks` on the Plan MCP connector
(`plan` or legacy `agent-native-plans`). In local-files mode, or when the skill
was installed as plain text and no MCP tools are registered, run
`npx @agent-native/core@latest plan blocks --out plan-blocks.md` and read that
file first. The CLI command calls the public no-auth `get-plan-blocks` route and
sends no plan/recap content. If network access is unavailable, use the bundled
references and validate with `plan local check` / `plan local serve`.

The catalog returns the authoritative, always-current block vocabulary generated
live from the app's own block registry — the same config the renderer and MDX
round-trip use — so it can never be stale even if this SKILL.md is an old
installed copy:

- `get-plan-blocks` (default `format: "reference"`) → a compact table of every
  block's runtime `type`, exact MDX `<Tag>`, placement, and key data fields.
  This is your map from each conceptual name above to its real tag and props.
- `get-plan-blocks` with `format: "schema"` → the full per-block JSON Schema
  plus a worked example for each block, when you need exact field types,
  enums, or nesting (e.g. `Diff.annotations`, `Endpoint.params[].in`,
  `DataModel.entities[].fields[]`).

Author the recap source against the tags and schemas that call returns. The
complete set of valid block-level tags is whatever `get-plan-blocks` lists;
any other capitalized tag at the block level is rejected on import with an
"Unknown plan block" / "did you mean" error. Lowercase HTML tags inside
`rich-text`/markdown prose (`<div>`, `<span>`, `<code>`, `<br>`, …) are always
fine — only capitalized component-style block tags are validated.

A few recap-specific authoring rules the registry table cannot encode:

- Every block takes a REQUIRED `id` (unique across the whole plan) plus the
  shared optional `summary` / `editable` envelope; give a block a heading by
  placing a `rich-text` block with a Markdown `###` heading directly above it
  (blocks no longer take a `title`).
- Every capitalized block component must be self-closing (`<RichText ... />`) or
  explicitly closed around children (`<RichText ...>...</RichText>`). Never
  leave a bare opening tag like `<RichText ...>` in a paragraph; MDX treats it
  as unclosed JSX and import fails before the recap can render.
- `Endpoint`: prose `description` is the MDX **children** (body between the
  tags), not an attribute; for a WebSocket upgrade use `method="GET"`. Each
  request/response `example` is a JSON **string** (the renderer parses it into
  the JSON explorer), so keep it a single parseable JSON value.
- `TabsBlock`: the whole `tabs` array (including nested child blocks) is ONE
  JSON `tabs={[…]}` prop — there is NO nested `<Tab>` element.
- `WireframeBlock`: its body is a single `<Screen surface ... html=… />` subtree
  (nested MDX, not a flat prop); `html` must be a single-quoted string or static
  template literal, never a dynamic `html={someVar}` expression. See
  `references/wireframe.md` for the HTML rules.
- `Diagram`: the whole payload is one `data={{ html?, css?, nodes?, edges?, … }}`
  attribute and requires either `html` or at least one node; `Mermaid` is its
  own separate block (`source` text), not a `Diagram` prop.
