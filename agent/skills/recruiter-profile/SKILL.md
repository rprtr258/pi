---
name: recruiter-profile
description: "Complete, update, or optimize a freelancer or candidate profile on a recruiter, freelancing, or job platform. Use when applying CV/resume data to an online profile, adding projects or skills to a marketplace profile, or syncing a professional profile. Drives a step-by-step flow: access and log in, survey existing fields, gather facts from the canonical profile reference, ask only about gaps, write a reviewable proposal, then apply field by field after approval."
---

# Recruiter Profile

Complete or update a professional profile on any recruiter/freelancing platform, working from
a canonical fact sheet and applying changes only after the user approves a written proposal.

## Core Rules

- **Facts come from the reference, not from imagination.** The single source of truth is
  `~/Documents/Wiki/areas/biz/profile-reference.md`. Read it before touching any platform.
  Never invent or embellish employers, dates, titles, skills, rates, or descriptions. A missing
  fact is a question for the user, not a guess.
- **The user is the gate between phases.** Run the flow as discrete, verifiable steps —
  access → survey → gather → (ask only if gaps remain) → propose → apply — and confirm each
  works before moving on. This is destructive, hard-to-undo work on a live profile, so favor
  explicit numbered steps.
- **Never write to a live profile before the proposal is approved.** Save the proposal as
  markdown so the user can review it and so it stays reusable for the next platform.
- **Map facts onto whatever fields the platform exposes.** Every platform structures profiles
  differently. Read the platform's actual form, then decide which facts fit which field — do
  not assume a fixed schema.

## Workflow

### 1. Access and verify

1. Open the profile/edit URL with the Playwright MCP browser (`playwright_browser_navigate`,
   then `playwright_browser_snapshot`).
2. If redirected to a login, find credentials in Proton Pass: `pass-cli item list <vault>
--output json`, then `pass-cli item view --vault-name <vault> --item-title <site>
--output json`. Fill and submit the login form.
3. Dismiss cookie/consent dialogs so they don't block later interactions.
4. Confirm you are on the editable profile (the user's name appears, edit controls are present)
   before proceeding.

### 2. Survey the profile

Snapshot the profile and inventory it: which fields are already filled, which are empty, and
which are incomplete. Note the platform's field structure (sections, required fields, how
projects/skills/education are modeled). Report the inventory so the user sees the starting
state.

### 3. Gather facts

Read `~/Documents/Wiki/areas/biz/profile-reference.md` for the authoritative data. If the
reference is missing a detail the platform needs (e.g. exact months, a skill level, an industry),
check the underlying sources it cites before asking. Keep a working set of what will go into each
empty or incomplete field.

### 4. Ask about gaps 

Skip this step when the reference already covers everything the platform needs. If gathering left
gaps or judgment calls — missing dates, level mappings (e.g. language proficiency wording),
inclusion decisions (which projects to list, how far back to go) — surface them in one batch with
sensible defaults and let the user confirm or correct. Do not proceed on assumptions.

### 5. Draft the proposal

Write a proposal to `~/Documents/Wiki/areas/biz/<yy-mm-dd>-<platform>-profile-data.md` containing
the exact values to enter per field, organized by the platform's sections. Mark what already
exists vs. what is new, and flag any items that still need confirmation. Run `qmd update` in
`~/Documents/Wiki` after writing. Pause for the user to review.

### 6. Apply

After approval, edit the live profile one field/section at a time. After each save, verify the
value persisted (re-snapshot or read the rendered text) before moving to the next. Start with one
low-risk field to confirm the platform's edit/save mechanics work, then continue. Report progress
at checkpoints rather than applying everything silently.

## When platforms fight back

- **Controlled vocabularies.** Skill/tag/industry fields often accept only predefined values. If
  a specific tool isn't in the list (a common case for niche tech), don't force an unrelated
  substitute — name it in a free-text description field instead, and tell the user.
- **Ongoing engagements.** "Present"/"ongoing" is usually expressed by leaving the end date
  empty, not by picking a future month. If a date picker has no "ongoing" option, clear the field.
- **Rich-text fields.** For bulleted descriptions, use the editor's list control and type one item
  per line; verify the saved markup (e.g. a real `<ul>`) rather than trusting the visual.
- **Stale element references.** Re-snapshot after navigation or saves; the browser tool's element
  refs change when the page re-renders.

## Keeping the reference current

If the user supplies new facts during the flow (a corrected date, a new skill, an updated rate),
update `profile-reference.md` so the next platform inherits the correction. Keep operational steps
out of that file — it holds facts only.
