# Comment Anchors

How to interpret `#<n>` comment anchors, linked from the skill.

## Interpreting comment anchors

`get-plan-feedback` returns rich anchors — read them before acting on any comment.

- **Coordinate frames.** `targetX`/`targetY` are percentages *within* the
  element named by `targetSelector`/`targetKind`. Bare `x`/`y` are percentages
  of the whole plan document. `canvasX`/`canvasY` are raw board-world pixels on
  the design canvas (board size given when available).
- **Wireframe pins.** Anchors on wireframes include `targetNodeId` and
  `targetNodePath` (e.g. `card > list > listItem "Acme Inc"`) identifying the
  exact kit node. Use `targetNodeId` directly with wireframe node patch ops;
  use `data-design-id` values from design artboards with
  `update-design-element-style`. Prefer the node id/path over raw coordinates;
  fall back to coordinates plus the focused screenshot (red ring marks the exact
  point) only when no node id is present.
- **Text quotes.** Resolve `textQuote` against current prose using
  `contextBefore`/`contextAfter` for disambiguation. If `ambiguous: true`, ask
  the user — do not guess which occurrence is meant.
- **Detached comments.** `get-plan-feedback` flags threads whose quoted text no
  longer exists as `detached` (in `detachedThreads`). Reconcile these against
  rewritten content — never silently drop them.
- **Routing.** `resolutionTarget` is the only routing signal: act on `agent`,
  treat `human` as context only. `@mentions` are people to notify, never a
  routing signal.
- **Two-axis state.** Mark every ingested comment as consumed
  (`consumedCommentIds` on `update-visual-plan`). Set `status=resolved` only on
  agent-targeted comments you actually addressed; leave human-targeted comments
  open.
