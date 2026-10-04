---
name: plan-visual
description: >-
  Turn ordinary text plans into rich interactive visual plans with diagrams,
  file maps, annotated code, open questions, and UI/prototype review when
  useful. Use when a text plan needs to become an interactive visual plan.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is structured visual planning mode for coding agents: the Markdown plan you would normally write, built as a scannable document with editable blocks — inline diagrams, code snippets, open questions — plus an optional top visual review area (wireframe canvas, live prototype, or both in tabs). Architecture/backend plans stay document-only; UI/product plans start with the top canvas/prototype (**Visual Surface Choice**).

`/visual-plan` is the packaged command and main entry point. Pick the review mode from the task: UI-first (screens), prototype-first (live prototype), design-first (branded screens), or visual-intake (only on explicit request). When a Codex, Claude Code, Markdown, or pasted plan exists, use it as the starting point instead of starting over.

## When To Use

Create or adapt a visual plan whenever the plan is better as a reviewable artifact than a chat paragraph: modest work (one UI surface with states, a small workflow, a before/after change, a component/API/data-shape decision needing alignment) and larger multi-file, ambiguous, long-running, risky, or UI-heavy work; when architecture / data flow / UI direction / options / open questions benefit from diagrams or structured blocks; when the user must react before you implement; and when an existing text plan needs a richer review surface.

## Plan Discipline — read [references/plan-discipline.md](references/plan-discipline.md)

The full discipline (gating, research, hard bets, standalone publishing, clarify-vs-assume, self-review) lives in the reference; condensed:

- **Research before you draft.** Read real files, actions, schema, and patterns; name actual files, symbols, and data shapes. Check existing `actions/` before proposing endpoints; prefer named client helpers over raw fetch. Lead with reuse — name what each step reuses before what it adds.
- **Decide hard-to-reverse bets first** — wire format, public ids, data-model shape, auth/ownership boundaries — then scope to the smallest first cut, stating what is in and what is deferred. Keep broad framework ideas at the right altitude; label examples as examples.
- **Publish standalone plans.** Treat a pasted/earlier plan as source material, but publish a clean standalone proposal with no revision language. Lead with one concrete product example before mode tables or architecture.
- **Planning is read-only** until approval; presenting the plan and requesting sign-off is the approval step — no separate "does this look good?" question.
- **Clarify only when ambiguity would change the design** and the code cannot resolve it (host's ask-user-question flow, batched 2-4; never `create-visual-questions` from `/visual-plan`). Otherwise state assumptions; unresolved items go in the single bottom `question-form` Open Questions block.
- **The document is the source of truth, not the chat.** On scope shifts update the plan with `update-visual-plan`; re-read it before major steps.
- **Self-review high-stakes plans** (architecture, backend, data-model, migration, multi-file, risky) concurrently after surfacing — one skeptical reviewer; clear-cut fixes via `contentPatches`, judgment calls to the user. Skip for small, UI-only, or single-decision plans.

## Create A Structured Agent-Native Plan — Never Inline

The deliverable is ALWAYS a structured Agent-Native Plan created via the Plan MCP connector (`plan` server, or legacy `agent-native-plans`). NEVER hand the plan over as inline chat content — no Markdown prose, ASCII sketch, table, or fenced wireframe. The connector is not a reason to reject the pattern: plans are portable source artifacts (`plan.mdx`, optional `canvas.mdx`/`prototype.mdx`, JSON, HTML export), and ownership-sensitive workflows can use local-files mode or a self-hosted/custom Plan app URL without abandoning the review discipline — do not advise skipping `/visual-plan` because the default surface is hosted.

If the connector's tools are missing, do NOT fall back to inline output. The usual cause is a connector that did not finish connecting this session (registers zero tools), not auth. Stop and give the user the exact per-client restore step (see [references/setup.md](references/setup.md)); auth is per client config/session, so one client's reconnect does not load another's tools. Never reinstall from scratch to fix auth. Publish once the tool is reachable; local-files mode is the only inline exception.

## Core Workflow

**Gather and create.**

1. Follow the host's normal planning flow: inspect the repository, delegate wide exploration when useful, ask native clarifying questions first. If a source plan exists, gather its exact text — never invent source text.
2. Call `get-plan-blocks` for the authoritative block catalog — do not author from memorized tags. Then call the mode-matched create tool (see Tool Guidance). With a source plan, pass it as `planText` and produce a standalone plan document, not a revision memo.

**Compose the plan.**

3. For UI/product plans, compose the top canvas first with primary wireframes and annotated states, then write the document with native blocks (see the reference sections). Broad product-architecture plans with a user-facing implication get a concrete "what this looks like in the app" visual before the abstract architecture. Carry forward the right facts from a provided plan without referring to the previous draft. For non-visual plans, skip the top surface and put `diagram`, `data-model`, `api-endpoint`, `diff`, `file-tree`, `code`, and `annotated-code` blocks next to the relevant prose.

**Review and feedback.**

4. Share the returned Plans link — always include the actual URL in chat; in text-only hosts the link is the handoff. When the host has an embedded browser/preview panel that can open arbitrary URLs, open the returned URL automatically as a convenience and smoke test — never the only handoff or access model. If a signed-in embedded browser cannot read a local plan an anonymous/tool check can read, fix app/action ownership or the access path rather than patching one plan. Kick off the self-review pass while the user reads.
5. Call `get-plan-feedback` before editing, after review, after any long pause, and before the final response. Treat `anchorDetails`, resolver intent, review events, and screenshots as the source of truth for what changed and what each comment points at.

**Apply and export.**

6. Apply changes with `update-visual-plan`, preferring targeted `contentPatches`. Treat top-level `content` as a full replacement, not a merge — never send a partial `content` object to add a canvas or one block. If a full replacement is unavoidable, read the complete plan source first, carry forward every block and visual surface, and verify afterward. For source-control friendly edits use `patch-visual-plan-source` on the MDX files.
7. Export with `export-visual-plan` only when the user wants a shareable receipt or repository-check-in artifacts.

## Visual Surface Choice — read [references/visual-surface.md](references/visual-surface.md)

Choose the surface before creating the plan; do not add visual chrome by default. Summary: no visual surface for architecture-only/backend-only/data-migration/copy-only plans (never a top canvas for architecture diagrams, dependency maps, file plans, API contracts, or data-flow-only reviews); canvas only for static screens, before/after comparisons, component states, or popovers; canvas + prototype for multi-step flows the reviewer must operate; prototype-first when interaction is the main question. The reference holds the full rules (top canvas as primary review surface, multiple artboards per state, annotations beside frames, product wireframes vs. meta diagrams, matching an existing app's density, reusing labels across surfaces).

## Reference Sections — read before authoring

- **Wireframe quality** — [references/wireframe.md](references/wireframe.md): full-width chrome, pinned bottom bars, real product content, before/after comparability, the right `surface` preset, `--wf-*` tokens instead of hex, no `<html>`/`<style>`/font tags. READ before authoring any wireframe / `<Screen>` / `WireframeBlock` — never from memory.
- **Canvas** — [references/canvas.md](references/canvas.md): `surface` locks each artboard's footprint, mixed surfaces lay out in lanes, annotations anchor by `targetId`/`placement`, edits are surgical `contentPatches`. READ before authoring or editing any canvas, artboard, or annotation.
- **Document quality** — [references/document-quality.md](references/document-quality.md): outcome-first, prose-first, self-contained, right native blocks, open questions in a single bottom `question-form`, pre-handoff visual check. READ before writing the document.
- **Good vs. bad exemplar** — [references/exemplar.md](references/exemplar.md): a worked example of the bar, plus anti-patterns.
- **Local-files privacy mode** — [references/local-files-mode.md](references/local-files-mode.md): for local/offline/no-DB-write plans, repository-owned artifacts, or when the connector isn't connected.
- **Comment anchors** — [references/comment-anchors.md](references/comment-anchors.md): reading and applying `#<n>` comment anchors when interpreting feedback.
- **Setup & Authentication** — [references/setup.md](references/setup.md): connector setup, hosted vs. local Plans, per-client auth/reconnect steps. Use when the `plan` connector is missing, auth fails, or you are setting up local Plans.

## Tool Guidance

Creating: `create-visual-plan` (one per task/run, or import a text plan via `planText`; `content` may have no visual surface, canvas only, or canvas + prototype) · `create-ui-plan` (work is primarily product UI) · `create-prototype-plan` (functional top review surface) · `create-plan-design` (branded Design tab + optional Prototype tab) · `convert-visual-plan-to-prototype` (HTML wireframe canvas → prototype plan) · `create-visual-questions` (explicit request only, never `/visual-plan` preflight).

Updating/reading/exporting: `update-visual-plan` (targeted `contentPatches`) · `read-visual-plan-source` (normalized `plan.mdx`, optional `canvas.mdx`/`.plan-state.json`, JSON) · `patch-visual-plan-source` (granular MDX AST patches by block/artboard/annotation/component/wireframe-node id) · `import-visual-plan-source` (create/replace from an MDX directory) · `get-visual-plan` (current plan, exported HTML, annotations, MDX directory) · `get-plan-feedback` (call frequently: grouped threads, anchor details, expected resolver, review events) · `get-plan-blocks` (authoritative tags, required fields, prop shapes — always call first) · `export-visual-plan` (HTML, Markdown fallback, JSON, MDX for repository check-in).

When the user critiques a plan's look or structure, fix the renderer or this skill — never hand-edit one stored plan.

## Visibility & Sharing

Use `set-resource-visibility` to change who can see a plan (public, login, org-scoped) and `share-resource` to grant users/roles by email or role. Gate visibility before sharing any plan covering unreleased or private work — default to the narrowest scope that meets the review need.
