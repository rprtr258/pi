---
name: dev-diff
description: >-
  Turn a PR, branch, commit, or git diff into an interactive visual recap with
  diagrams, file maps, API/schema summaries, annotated diffs, and focused review
  notes. Use when a PR, branch, commit, or git diff needs a visual recap.
metadata:
  visibility: exported
---

# Visual Recap

`/visual-recap` creates a visual plan built **from** a diff, not toward one: instead of describing the change you are about to make, you describe the change that was just made, at a higher altitude than line-by-line review. Schema, API, file, and architecture changes become the same `data-model`, `api-endpoint`, `file-tree`, and `diagram` blocks a forward plan would use — summarizing work that exists, so a reviewer scans the shape of the change before the literal lines.

## Local-Files Privacy Mode Exception

Use local-files privacy mode when the user explicitly asks for no DB writes, no hosted Plan database writes, no Plan MCP publish, fully local files, offline/private recaps, or when `AGENT_NATIVE_PLANS_MODE=local-files` is set — the only exception to the hosted publish rule below. Read [references/local-files-mode.md](references/local-files-mode.md) before working in that mode: what helpers are safe, how to build and check the recap, and how to report the result.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan via `create-visual-recap` on the Plan MCP connector (exposed as `plan`, or legacy `agent-native-plans`) — never inline chat content (no Markdown prose, ASCII sketch, table, fenced "wireframe", or summary): publish and return its absolute URL. If the connector's tools are missing, do NOT improvise an inline fallback or assume auth is the cause — a connector that did not finish connecting this session registers zero tools. Give the user the per-client restore step ([references/connector-setup.md](references/connector-setup.md)); never reinstall from scratch to fix auth.

## When To Use

Build a recap when a pull request or commit is large, multi-file, or touches schema, API contracts, or architecture, and a reviewer benefits from seeing the change mapped to structured blocks before the raw diff (a GitHub Action can generate one automatically from a pull request diff; an agent can generate one on request). Skip it for small, single-file, or obvious diffs — a recap is review overhead.

## Recap The Whole Work Unit — read [references/recap-scope.md](references/recap-scope.md)

When `/visual-recap` is invoked after work has already happened in a chat thread, the default scope is the whole current work unit/thread, not only the most recent user message or fix: original implementation, later bug fixes, UI follow-ups, tests, changesets, skill/instruction updates, generated plan/source artifacts, and local import/linking fixes needed to make the recap open. Use the current diff plus conversation context to separate thread-owned changes from unrelated dirty work; exclude unrelated pre-existing edits. If scope is ambiguous, state the assumption or ask before publishing. After feedback, revise so the recap still covers the whole work unit plus the correction — never narrow it to only the latest feedback unless the user explicitly asks. Full scope rules: [references/recap-scope.md](references/recap-scope.md).

## Keep The Recap Body Lean

No boilerplate intro, disclaimer, provenance, or summary prose blocks — in particular no `rich-text` block just to say the recap is an aid, that the reviewer should still review the diff, how many files changed, or which ref generated it: the title, brief, and `file-tree` (which carries per-file change stats) already carry that context. Add prose blocks only when they tell the reviewer something the structured blocks do not: the objective, a real compatibility risk, an important decision visible in the diff, or a grounded review note.

## Recaps Must Be Substantial

Lean is not thin — a single wireframe plus one sentence under-serves the reviewer as much as boilerplate over-serves them. Alongside the visual/structural headline, a substantial recap carries the implementation evidence: a short surface/state inventory before authoring (changed routes, components, popovers/dialogs, role/access states, empty/error states, shared abstractions visible in the diff — each meaningful item gets a block or an intentional omission); a `file-tree` of changed files with each entry's `change` flag; and the split `diff` of the KEY changed files, grouped under a `## Key changes` heading in a single horizontal `tabs` block (default orientation, one file per tab), each with a one-line `summary` and a few `annotations`. Use horizontal file tabs, not a vertical side rail, so split diffs get enough width. Skip the diff appendix only for a genuinely tiny change (see "When To Use").

## Canonical Shape And Budgets

Skeleton, top to bottom: (1) UI-impact headline — wireframes first, when the diff changed rendered UI; (2) short outcome narrative (`rich-text`), 1-3 paragraphs; (3) `data-model` / `api-endpoint` blocks for schema and contract changes; (4) `file-tree` with `change` flags; (5) `## Key changes` — one horizontal `tabs` block of `diff` / `annotated-code`. Budgets: 3-8 key-change tabs; each excerpt under ~150 lines; title ≤ ~70 characters; brief 1-3 sentences. Calibration: a 25-file auth change gets Before/After wireframes of the login surface, a two-paragraph narrative, a diff-aware `data-model`, an `api-endpoint` for the new route, a `file-tree`, and five focused `## Key changes` tabs. Anti-patterns: one giant unsegmented diff dump with no summaries or annotations; or a sparse three-block recap of a 40-file change that forces the reviewer back into the raw diff anyway.

## UI Impact Needs Wireframes — read [references/ui-coverage.md](references/ui-coverage.md)

When the diff changes rendered UI — layout, density, visual state, interaction affordances, navigation, controls, menus, dialogs, or design tokens — the recap MUST include one or more wireframes; prose and file diffs are not a substitute. Before authoring, make a UI coverage pass from the diff (entry surface, interaction surface, destination/persistent state, access/role variants); for UI-heavy PRs show the changed entry point, the main changed interaction surface, and the resulting state. Choose the smallest visual surface that makes the review clear; ground each wireframe in changed behavior, component names, file paths, and diff-visible labels/states. Full coverage-pass, choosing, and grounding rules: [references/ui-coverage.md](references/ui-coverage.md).

## Wireframe Quality — read [references/wireframe.md](references/wireframe.md)

Before authoring ANY wireframe / `<Screen>` / `WireframeBlock`, READ [references/wireframe.md](references/wireframe.md) — the single source of truth, shared word for word with `/visual-plan`: full-width chrome, pinned bottom bars, real product content, before/after comparability, the right `surface` preset, `--wf-*` tokens instead of hex, no `<html>`/`<style>`/font tags. Never author from memory. Keep `renderMode` unset or `wireframe` unless a design-only editable mockup is explicitly required. With a browser tool available, render the recap in the Plan viewer and inspect it at the current theme before sharing — fix overlapping labels/toolbars in the MDX and re-import; a text-match screenshot is not enough. Without a browser (headless CI), say so in the handoff.
## Open And Report The Recap — read [references/reporting-urls.md](references/reporting-urls.md)

In local-files mode: run `plan local check`, then report the local bridge URL from `plan local serve --dir plans/<slug> --kind recap --open` or `plans/<slug>/.plan-url`; never invent a hosted URL or publish just to get a link. Otherwise: report an **absolute URL on the origin whose database holds the plan** — the create tool's returned link, never a local file, mirror, or relative path; localhost/dev origins only when the recap was created through an MCP bound to that same origin. Full URL resolution order, private-repo sign-in wording, and Codex browser rules: [references/reporting-urls.md](references/reporting-urls.md).

## Before / After Is The Headline — read [references/before-after.md](references/before-after.md)

The recap's center of gravity is the before/after comparison. For UI diffs the wireframes are that comparison; for structured comparisons use the `columns` container (two `Before`/`After` columns holding blocks like `data-model` or `api-endpoint`) and `diff` (literal removed/added lines, split mode by default, key-file groups in horizontal tabs). `columns` plus `diff` are the whole comparison vocabulary — never hand-build side-by-side layouts in `custom-html`. Full rules: [references/before-after.md](references/before-after.md).

## Grounding Rule

Structured blocks are **true by construction** only if derived from the actual changed lines: the `diff`, `data-model`, `api-endpoint`, and `file-tree` blocks MUST be built mechanically from the real diff — real paths, fields, method/path, before/after text — never inferred, rounded, or invented. The model writes only the prose: the "why", the narrative, the risk read. A confidently wrong recap is dangerous in review — a reviewer who trusts the summary may skip the very line the summary got wrong. When the diff does not contain a fact, leave it out rather than guess; mark anything inferred as inferred in prose.

## Security

- **Gate visibility.** Recaps of a private repository are org/login-gated — set the plan's visibility to the owning org or login, never auto-public; a recap can expose unreleased schema, internal endpoints, and architecture. Any PR comment or handoff linking the recap must say private-repository recaps require signing in with access to the owning org if the link does not load.
- **Never transcribe secrets.** A diff can contain API keys, tokens, webhook URLs, signing secrets, `.env` values, or credential-looking literals. Never copy them into any block, caption, or note — redact (`sk-•••`, `<redacted>`), mirroring the repository's hardcoded-secret rule: obviously fake placeholders only, never the real value.

## Authoring With Blocks

Before authoring any recap, read [references/block-authoring.md](references/block-authoring.md): the complete Diff → Block Mapping (which block carries each kind of change), the full block reference (exact tags + prop schemas — call `get-plan-blocks` at authoring time, do not author from memory), and the before/after comparison patterns (`columns`, `before-after`, and friends).

## Bidirectional Loop

A recap is a real, editable plan, so the forward-plan review loop applies: a reviewer annotates any block, and the coding agent reads `get-plan-feedback` to drive fixes back into the code — annotation → agent → diff. After a reviewer annotates, call `get-plan-feedback`, then update the recap with `create-visual-recap` (pass the existing `planId` to replace in place) or apply targeted changes with `update-visual-plan`. Not yet automatic: the GitHub Action creates an initial recap per pull request but does not yet re-run when new GitHub review feedback is posted — that auto-re-run is the remaining fast-follow.

## Related Skills

- **visual-plan** — the canonical command and source of the shared Wireframe & Canvas and Document Quality cores; a recap follows the same block discipline in reverse.
- **comment anchors** — recap comments use the same anchor rules as forward plans; see "Interpreting comment anchors" in the visual-plan skill (coordinate frames, wireframe node ids, text-quote resolution, detached threads, routing via `resolutionTarget`).
- **security** — data scoping, secret handling, and the hardcoded-secret rule the recap's redaction and visibility gating mirror.
- **sharing** — org/login-gated visibility for the plan that holds the recap.

