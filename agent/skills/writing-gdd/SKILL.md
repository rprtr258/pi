---
name: writing-gdd
description: Write, structure, review, or update game design documents (GDD). Use when the user asks for a GDD, a design doc for a game, to document game systems/mechanics/levels, or to review/improve an existing game design document. Covers doc-type selection (pitch vs GDD vs bible), format tiers (one-pager, lean GDD, per-system docs), section structure, GDD-specific writing rules, and scope control. Not for pitch decks, lore bibles, or technical design docs — clarify the difference instead of producing them.
---

# Writing Game Design Documents (GDD)

A GDD is a working technical document that translates a game concept into a plan a
team can build from: what the player experiences, how systems behave, in what scope.
It is literature for no one; it is a tool updated all development long.

## Step 1 — Place the request (before writing anything)

Determine which artifact the user actually needs:

- **Pitch doc** (publisher/investor meeting): vision, hook, market, monetization, team.
- **One-pager / lean GDD / full GDD** (dev team): core loop, systems, numbers, scope.
- **Narrative bible** (lore/story/dialog), or **technical design doc** (architecture).

If the user says "GDD" but the situation is a publisher pitch, say so and offer a
pitch doc + one-pager; a GDD full of combat formulas loses the room, a pitch deck
builds nothing. When interaction is impossible (one-shot run), state the mismatch in
one opening line and deliver the closest useful artifact, not the literal wrong one.

## Step 2 — Pick the format tier

- Idea/pre-production, or the first page of any GDD → **one-pager**.
- Solo dev or small team → **lean GDD** (5–15 pages): vision, pillars, non-goals,
  core loop, priority-labeled systems, content counts, story synopsis, UX, milestones.
- Team production, complex systems → **per-system documents** (one skeleton per
  system, subsystems when needed), with the lean GDD's sections 1–2 as the index.

Templates for all tiers: read `references/gdd-templates.md`. Sources and rationale:
`references/sources.md`.

## Step 3 — Gather context

Ask (or, in one-shot mode, state as an explicit Assumptions block):
- Stage: idea, pre-production, or in production? Team size and roles?
- Where the doc will live (single file, wiki, tool) and who maintains it.
- The game's one-sentence pitch. If the user gave none, draft one and confirm.
- For updates: what changed and why; do not rewrite a living doc wholesale.

## Step 4 — Write

Follow the template for the chosen tier. Non-negotiables:

1. **Header**: version, date, owner, changelog. No header = no living doc.
2. **Non-goals section**: what the game explicitly is not. Mandatory.
3. **Numbers, not adjectives.** Speeds, durations, costs, probabilities. Where a
   value is unknown, write `TODO:` and list it under Open Questions — never invent
   numbers silently.
4. **Priority labels** on every system (Essential / Optional / Future, or MoSCoW).
   Essential first; section order = build order. A "Won't (this release)" list fences scope.
5. **Why, not just what.** Non-obvious decisions get one clause of rationale tied to
   a design pillar.
6. **Story stays synopsis** (setting + 3–5 sentences, no dialog). Lore and full
   script go to a bible; reference it, don't inline it.
7. **Scannable**: one topic per section, short paragraphs, lists, diagrams/flow maps
   where structure matters, reference images for art direction.
8. **Content counts are commitments**: levels, enemies, items — state numbers.
9. For each system: goal → overview → rules (conditions/state transitions) → UI
   touchpoints → balance knobs → open questions. Use the Tier-3 skeleton for complex ones.

## Step 4b — Update an existing GDD

- Respect its structure; add, don't demolish. Record a changelog entry (what, why, date).
- Check new systems against existing pillars; flag contradictions instead of blending.
  If the doc has no pillars, say so — don't silently re-found its vision.
- New tuning numbers in an update are proposals: label them as such (pending
  playtest/validation), don't present them as shipped truth.
- Update affected counts, milestones, and priorities; mark cascading effects (co-op
  touches UI, progression, content) rather than appending isolated sections.
- Keep priority labels honest: re-label old sections if the new feature reorders them.

## Step 5 — Self-review before delivering

Run through the checklist in `references/gdd-templates.md` (concept sentence, pillars,
non-goals, loop vs systems match, labels, numbers/TODOs, whys, counts, synopsis-only
story, screen flow, observable milestones, version+changelog, pitch content excluded,
explicit open questions). Fix violations, then deliver with the 2–3 open questions the
user must answer next.
