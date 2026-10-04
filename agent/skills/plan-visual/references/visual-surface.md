# Visual Surface Choice

Full surface-selection rules for Agent-Native Plans, linked from the skill.

## Default Surface Rules

Choose the surface before creating the plan or after reading the source plan;
do not add visual chrome by default.

For UI/product plans the top canvas is the primary review surface: the first
meaningful wireframes go there, not buried in the document body. Use multiple
artboards when states matter (default view, overflow/popover, side panel,
loading, error). Short annotations sit beside frames with `targetId` +
`placement`; implementation details, tradeoffs, file maps, data contracts,
risks, and verification stay in the document body.

Keep product wireframes and meta diagrams separate: pure screens that look like
the app state under discussion — no callout prose or architecture notes inside
the UI; arrows, labels, contracts, and mode explanations go in separate
annotations, canvas diagrams, or the document body. When the plan touches an
existing app, inspect the current shell first: the first artboard matches the
real app's density (sidebars, toolbar placement, overflow menus, framework
chrome stay in place), and secondary surfaces (popover, sheet, panel, loading,
AgentSidebar) are modeled as separate states, not a permanent inspector.

## Which Surface

- **No visual surface** — architecture-only, backend-only, data-migration,
  copy-only, or otherwise non-visual plans; never a top canvas for architecture
  diagrams, dependency maps, file plans, API contracts, or data-flow-only
  reviews. Use a strong document with local inline diagrams only when
  relationships need a visual explanation — one spatial diagram per
  recommendation/decision; prefer grouped regions, layers, quadrants, matrices,
  or before/after panels over single-axis chains unless truly sequential.
- **Canvas only** — one static screen, before/after comparison, component
  state, small popover, or a visual direction that does not require clicking:
  wireframes in `content.canvas`, omit `content.prototype`.
- **Canvas + prototype** — multi-step UI flows, onboarding, wizards,
  review/approval flows, navigation changes, anything the reviewer must
  operate: static wireframes in `content.canvas`, aligned functional prototype
  in `content.prototype`; top visual tabs switch between them.
- **Prototype-first** — when the user asks to operate the UI or interaction is
  the main question: `create-prototype-plan`, preserving static mocks where
  useful.

Mixed canvas + prototype plans reuse the same real labels, app statuses, and
screen ids across both surfaces: the canvas is the inspectable static
reference; the prototype is the interactive version of that same flow, not a
separate design direction.
