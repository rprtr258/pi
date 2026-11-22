# GDD Templates & Writing Rules

## Document family (pick the right one)

| Doc | Audience | Contains | NOT contains |
|-----|----------|----------|--------------|
| Pitch doc | Publishers, investors | Vision, market, monetization, hook, team | Combat formulas, UI flows |
| Concept doc | Anyone new to project | Title, genre, platform, high concept, USP | — |
| **GDD** | Dev team | Core loop, systems, rules, numbers, content volume | Lore, script, class diagrams |
| Technical design doc | Programmers | Architecture, classes, data formats | Gameplay rationale |
| Narrative/game bible | Writers, worldbuilders | Lore, story, characters, dialog | Mechanics |

Rule of thumb: if it sells the game → pitch. If it describes what the player experiences and how systems behave → GDD. If it explains how code is built → TDD. If it explains the world → bible.

## Tier 1 — One-pager (idea stage, or the top page of a full GDD)

```
# <Game Title> — One-Page Design
**Version / date:** 0.1 / YYYY-MM-DD   **Author:** …

## Concept
One sentence: <genre> where <player> <core verb> to <goal>, set in <world>.
Audience: <who plays it, platform(s)>
Inspiration: <2–4 games, one clause each on what is borrowed>

## Core loop
<3–5 verbs in order, repeated every session/minute>
Example: explore → scavenge → build/upgrade → survive night → repeat

## Goal
Win: <condition>   Lose: <condition>

## Controls
<player action> → <input>.  (exactly, e.g. "interact with object" → E / tap)

## Scope (MoSCoW)
- Must: <features without which there is no game>
- Should: <clearly wanted, but not day-1>
- Could: <nice to have>
- Won't (this release): <explicit cut list>

## Look & sound
<art direction in 2–3 clauses> + 3–5 reference images/links
<sound direction in 1–2 clauses>

## Done means
- [ ] <observable criterion, e.g. "a full 20-min run from farm to boss is possible">
```

## Tier 2 — Lean GDD (solo dev / small team, pre-production → production)

Target size: as short as possible, aim 5–15 pages. Order = build order.

```
# <Game Title> — Game Design Document
**Version:** <major.minor>   **Date:** YYYY-MM-DD   **Changelog:** below
**Owner:** <who updates it>   **Location:** <link>

## 1. Vision
<One paragraph: what the game is, what experience the player gets, why it's interesting.>
### Design pillars
1. <pillar — every system must serve it> (3±1 pillars)
### Non-goals
- <what this game explicitly is NOT; feature and tone level>

## 2. Core gameplay loop
<Verbs in order, at session scale and at minute scale. One diagram if possible.>

## 3. Systems (priority-labeled)
<One subsection per system. Essential first. Order = build order.>
### 3.x <System name>  [Essential|Optional|Future]
Goal / Overview / Rules & numbers / UI touchpoints / Open questions
(see Tier-3 skeleton for complex systems)

## 4. Content inventory
<Levels/enemies/items/characters: what exists, what's planned, COUNTS.>
Scope creep lives here — counts are commitments.

## 5. Story (only if the game has narrative)
Setting: <1–2 paragraphs>.  Synopsis: <3–5 sentences, no dialog>.
Full script/lore → separate bible, linked from here.

## 6. UX / UI
<Screen flow map, HUD elements, key menus. Wireframes as images.>

## 7. Milestones & done-means
- <Milestone name>: <observable acceptance criterion + date>

## 8. Open questions
- [ ] <question> — <who answers, when>

---
## Changelog
- 0.2 YYYY-MM-DD — <what changed, why>
- 0.1 YYYY-MM-DD — first draft
```

## Tier 3 — System document skeleton (per system, production teams)

One file/section per system. Complex systems are split into subsystems.
Do not merge unrelated systems "to save space" — merge only when they share a design reason.

```
### <System name> [Essential | Optional | Future]
**Version:** <x.y>  **Owner:** <name>  **Status:** draft/in-dev/live

**Objectives** — what this system must achieve for the game, tied to a pillar.
**Overview** — one paragraph, no jargon.
**Screen flow / diagram** — how the player enters and exits this system.
**Behavior & mechanics** — rules as conditions and state transitions:
  "When <trigger>, <system> transitions to <state> and <effect>."
  Numbers required: speeds, durations, costs, probabilities. TODO if unknown.
**Balance** — knobs and their current values; intended feel stated as numbers.
**Art** — what the player sees; direction + references, not final pixel specs.
**Audio** — required sounds/music; when they trigger.
**Analytics** (if any) — what to measure to know the system works.
**Tools / QA** — what debug tooling or test scenarios this system needs.
**References** — games that do it, assets, prior discussion.
**Open questions** — explicit list, each with owner.
**Version history** — one line per change.
```

## Writing rules (bad → good)

| Rule | Bad | Good |
|------|-----|------|
| Numbers, not adjectives | "The player moves fast" | "Run speed: 6 m/s (walk 3). Sprint: 9 m/s, stamina 100, −10/s" |
| Conditions & states | "Hitting opponents is slow" | "Attack: windup 0.3 s, hit 0.1 s, recovery 0.4 s. On hit: −1 enemy HP, knockback 1 m" |
| No subjectivity | "Combat should feel dynamic" | State the knobs that produce the feel: "combo window 0.5 s; 3-hit combo" |
| Justify the why | "Damage is 12" | "Damage 12: kills a 24-HP drone in 2 hits — matches the 'two-punch' pillar" |
| Lore stays out of GDD | 3 pages of backstory inside the movement doc | Link: lore → bible; here only what the player *learns in play* |
| No implementation detail | UML class diagram of combat manager | What the player experiences; architecture → TDD |
| Scannable | Wall-of-text paragraphs | Short sections, lists, one topic per section, TOC |
| Audience check | Formulas for the publisher deck | Pitch gets vision + pillars; GDD gets formulas |

## Review checklist (auditing an existing GDD)

1. One-sentence concept exists and matches actual content.
2. Design pillars present; every Essential system maps to one.
3. Non-goals section exists (else scope has no fence).
4. Core loop is stated as verbs and matches the systems list.
5. Systems are separated, priority-labeled, Essential first.
6. Numbers where behavior is specified; subjective words flagged.
7. Every non-obvious decision has a why.
8. Content section has counts (levels/enemies/items).
9. Story is synopsis-only; full script is elsewhere.
10. UI/UX has at least a screen-flow diagram.
11. Done-means/milestones are observable, not "polish the game".
12. Version + changelog present; doc states its owner and location.
13. No pitch content inside GDD (monetization ≠ system design unless it is a system).
14. Open questions are explicit, not silently missing numbers.
