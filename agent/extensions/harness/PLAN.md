# Agent Harness Improvement — Recurring Process

A user-triggered cycle that improves this pi agent setup: instruction layer (AGENTS.md,
skills, prompts), extensions and tools, and the process itself. Every cycle is:
**analyze → plan → confirm → implement → verify**. Nothing changes without explicit
user confirmation.

## Core principles

Principles every finding and candidate is checked against. Candidates that violate
them are rejected or rewritten before confirmation.

1. **Fix the root issue, not symptoms.** Post-fixing bad tool calls or results —
   intercepting calls, blocking re-reads, stripping malformed arguments, patching
   results — is curing the symptom: it is unreliable and does not scale. Fix the
   source instead: agent instructions, tool signatures/schemas, agent contracts, or
   the tool itself, so the wrong call becomes hard to make or fails with a
   self-explanatory error. When an agent misuses a format, first investigate why it
   misuses it (unclear description? misleading example? wrong assumption?) and fix
   that cause.
2. **Verify fixes right away.** Do not defer verification to "measure next cycle":
   old-session evidence goes stale and produces fixes for problems that no longer
   exist. Reproduce the original failure scenario now — replay it in an isolated
   copy (bench) or probe it with a fresh subagent — and confirm the fix changes the
   outcome before recording it. If the scenario can't be reproduced, the finding is
   historical: log it, don't fix it.

## Scope

The cycle may inspect and propose changes to:

1. **Instruction layer** — AGENTS.md, skills (~/.pi/agent/skills), prompt templates
   (~/.pi/agent/prompts)
2. **Extensions & tools** — ~/.pi/agent/extensions/*, pi packages (settings.json),
   MCP servers (mcp.json)
3. **The process itself** — this PLAN.md, the harness extension, its helper scripts
   (self-applicability, see below)

Out of scope: pi core internals, model/provider config, anything outside ~/.pi/agent
unless the user explicitly asks.

## Trigger

Manual only. Pi extension exposes a `/harness` command. Never auto-triggered, never scheduled.

## Evidence sources

1. **Session logs (primary)** — ~/.pi/agent/sessions/**/*.jsonl. Each cycle mines them
   for: tool error/retry rates, most/least used tools and skills, user corrections and
   rejections ("no", "wrong", rephrased requests), abandoned or re-asked tasks,
   redundant multi-step patterns that suggest a missing macro-tool or skill.
   Mining and any session-file reading is delegated to subagents (see Analyze) —
   session bytes must not enter the main agent's context.

   **Session time vs fix dates.** Before concluding that a fix recorded in
   `harness-log.md` is not helping, check session time first: each fix has an
   application date, and sessions may predate it. Only sessions started after
   the fix's date are evidence about that fix — if there are no such sessions,
   the fix is unevaluated, not failing; skip it. Mine pre-fix (old) sessions
   only for issues not yet found or addressed.
2. **User input (optional)** — anything the user proposes or notes during the cycle;
   treated as a first-class finding.
3. **Benchmarks (optional)** — only when testing a candidate improvement after the
   initial analysis: run a small standard task set before/after a change and compare
   completion, retries, cost.

Findings must cite evidence (session file, count, or user quote) — no speculation-only
items.

## The cycle

### 1. Analyze
Mine evidence sources (above) for inefficiencies and gaps. Summarize current state:
strengths, weaknesses, top findings ranked by frequency × impact. Output: a findings
list with evidence pointers.

**Use subagents for session analysis.** Session logs are large; reading them in the
main agent bloats context. Run `stats.ts` directly (small output), but delegate
everything beyond it — sampling, grepping, reading session files, drilling into a
tool's error cases — to subagents (one per analysis angle or findings pass). They
return only compact findings: counts, file paths, quotes. The main agent plans and
confirms from those summaries, never from raw session content.

### 2. Plan
Turn findings into concrete improvement candidates. Each candidate states:
- **What** — the change (extension change, instruction change, or process change)
- **Why** — the evidence behind it
- **How to verify** — check, benchmark, or before/after comparison
- **Risk** — what could regress

Output: ranked candidate list.

### 3. Confirm
Before presenting, write the analysis output to a findings file in this directory:
`harness-findings.md` containing exactly two tables:

1. **Findings** — one row per finding. Columns: `ID` (F1, F2, …), `Short summary`
   (one line), `Long description` (full detail, including the evidence pointers —
   session file, count, or user quote). No speculation-only rows.
2. **Candidates** — one row per improvement candidate. Columns: `ID` (C1, C2, …),
   `Short summary` (one line), `Long description` (What / Why / How to verify / Risk).
   Rows ranked best-first; each candidate's Why references finding IDs.

Use `<br>` for line breaks inside long-description cells. Then open it for the user's notes
and next-step marks by calling the `harness_annotate_findings` tool (this extension) with the
file path: it opens the browser annotation UI, blocks until the user finishes, and returns
their feedback. Returned feedback and notes are part of the approval; the user may also
reply in chat instead. The user picks which (if any) to implement by candidate ID.
**No change is made without explicit approval of that specific change.** The user may
also reject all candidates, ending the cycle.

**The annotation UI runs at most once per cycle, on this initial findings file only.**
Everything after that round — implementation notes, verification results, follow-up
questions, updated findings — is reported in chat. Do not re-open the annotation UI
for the same findings file during implement/verify, unless the user explicitly asks
to see it again.

### 4. Implement
Apply approved changes one at a time, smallest diff first. Respect AGENTS.md rules:
never overwrite files (edit instead), read before writing, don't "improve" anything
beyond the approved change.

### 5. Verify
For each implemented change, run its stated verification. If verification fails,
revert the change and report. Record the cycle in the run log (see below).

## Self-applicability

The cycle may target its own machinery: the harness extension's code, its helper
scripts, or this PLAN.md. Same rules apply — analyze with evidence, plan, get user
confirmation before touching anything. This file is the process definition; changing it
is a normal implement-step candidate, not a special case.

## Run log

Each completed cycle appends one entry to `harness-log.md` (this directory):
date, evidence scanned, findings, approved changes, verification results, reverted
items. PLAN.md itself stays process-only — history lives in the log.
