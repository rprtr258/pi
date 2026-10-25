# Agent Harness Improvement — Recurring Process
A user-triggered cycle that improves this pi agent setup: instruction layer (AGENTS.md, skills, prompts), extensions and tools, and the process itself. Every cycle is: **analyze → plan → confirm → implement → verify**. Nothing changes without explicit user confirmation.

## Core principles
Principles every finding and candidate is checked against. Candidates that violate them are rejected or rewritten before confirmation.

### Fix the root issue, not symptoms.
Follow the chain of reasoning that led agent to erroneous conclusions before diagnosing problem to solve.  Post-fixing bad tool calls or results — intercepting calls, blocking re-reads, stripping malformed arguments, patching results — is curing the symptom: it is unreliable and does not scale. Fix the source instead: agent instructions, tool signatures/schemas, agent contracts, or the tool itself, so the wrong call becomes hard to make or fails with a self-explanatory error. When an agent misuses a format, first investigate why it misuses it (unclear description? misleading example? wrong assumption?) and fix that cause.

### Verify fixes right away.
Do not defer verification to "measure next cycle": old-session evidence goes stale and produces fixes for problems that no longer exist. Reproduce the original failure scenario now — replay it in an isolated copy (bench) or probe it with a fresh subagent — and confirm the fix changes the outcome before recording it. If the scenario can't be reproduced, the finding is historical: log it, don't fix it.

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
   Also classify sampled sessions into structured facets — session type, outcome,
   user satisfaction, and a `friction` list — persisted to `harness-facets.json`;
   `./stats.ts` merges that file, and its distributions rank findings.

   **Profit/effectiveness, not just errors.** Errors are only one failure signal.
   Also mine for whether tool/skill usage was profitable: did the invocation earn its
   cost (result achieved at reasonable step/token/time cost), was there a more
   effective way to reach the same result (wrong tool or skill chosen, a skill that
   should have triggered but didn't, manual steps a skill already covers, an agent
   faster than the tool used), and whether current usage can be improved/optimised
   (redundant calls, wasted parameters, over- or under-reliance on a tool/skill).
   Effectiveness findings count the same as error findings — each cites evidence.
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
main agent bloats context. Run `./stats.ts` directly (small output: enriched metrics —
tokens/cost, durations, response times, interruptions, git activity, languages,
concurrent sessions), plus `./stats.ts --sessions` for a compact per-session work
list. Delegate everything beyond that — sampling, grepping, reading session files,
drilling into a tool's error cases — to subagents (one per analysis angle or findings
pass). They return only compact findings: counts, file paths, quotes. The main agent
plans and confirms from those summaries, never from raw session content.

**Facet classification.** Have a pass of subagents classify sampled sessions into
structured facets (session type, outcome, user satisfaction, `friction[]`) and write
them to `harness-facets.json` — schema:
`{sessions:[{sessionId,type,outcome,satisfaction,goal,friction:[{type,detail}]}]}`.
`./stats.ts` auto-merges this file, and `./stats.ts --html` renders its distributions;
use those distributions to rank findings. Session bytes stay in the subagents.

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

Use `<br>` for line breaks inside long-description cells. Run `./stats.ts --html` to
produce a browsable `harness-report.html` (includes the facet distributions) alongside
the findings file. Then open it for the user's notes
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

## Recursive optimization loop (/hloop)

Step 6 of the harness-loop plan turns the manual cycle into a measurable,
closed loop: snapshot the agent components, score them with the task suite
(`loop/suite/`), let the Proposer generate candidates, score the candidates in
identical sandboxes, and auto-apply the winner — with budget, state, and
revert machinery. Implemented in `loop/driver.ts` (`runLoop`), wired to the
session by the `/hloop` command group in `index.ts`. Architecture reference:
[loop/README.md](loop/README.md) (surface registry, data flow, gate pipeline,
failure semantics); the task suite itself: [loop/suite/README.md](loop/suite/README.md).

### Commands

| command | what it does |
| --- | --- |
| `/hloop start [--iterations N] [--suite <glob>] [--max-candidates K] [--resume <runId>]` | Runs the loop to completion, synchronously in the handler — the session BLOCKS for the whole loop (nested pi probes + proposer model calls). Prints a cost warning first. Refuses to start while another run's `state.json` says "running" with a live pid. `--resume` continues an interrupted (crashed) run: completed iterations are skipped, partially scored phases reuse their on-disk per-task results. |
| `/hloop status` | Prints the latest run's `state.json` summary (status, budget, per-iteration decisions) plus the last ≤5 `run-history.jsonl` entries. |
| `/hloop stop` | Creates the stop flag file `loop/.stop`; a running loop stops before its next probe/iteration and deletes the flag. |
| `/hloop revert <runId>` | Reverts the apply commit of a run (`git revert` by the `harness-loop(run <runId>):` marker, checkout fallback on conflict). |
| `/hloop report [runId]` | Lists `runs/<runId>/**/report.md` (default: latest run) and prints the per-iteration baseline aggregates + decisions. |
| `/hloop-calibrate [--sample N]` | Runs the judge (loop/lib/judge.ts) on N (default: all) suite tasks against their known checker verdicts and prints the agreement table. Verdict CALIBRATED when agreement ≥ `replay.minAgreement`, else ADVISORY. Writes `runs/<runId>/calibration.md` + a `judge-calibration` ledger entry. Trajectories are reused from the baseline result cache when the fingerprint matches; fresh probes otherwise. |
| `/hloop-propose --fixture <runId> [--dry-run]` | S4 debug command (superseded by the driver): rebuilds the Proposer prompt from a past run's fixture and (without `--dry-run`) makes one proposer model call — for inspecting the prompt/digest/proposal path without running the loop. |
| `/hloop-replay [--sample N] [--mine M]` | Mines M (default 8) replay-task candidates from real session history into `loop/suite-replay/<id>/`, probes N (default 3) with real nested pi against the reconstructed workspace, judges each, and prints id / provenance / judge score / rationale. Writes `runs/<runId>/replay-report.md` + `replay` ledger entries. **Replay channel: not yet wired into selection (advisory until calibrated)** — `config replay.enabled` is false by default; the gate is `isCalibrated` (agreement ≥ `replay.minAgreement`). |

### Config (loop/config.json, tolerant loader — per-field fallback to defaults)

> Fresh-clone caveat: `extensions/harness-loop-sample/node_modules` is a committed symlink (git mode 120000) into the gitignored `extensions/node_modules` store — dangling on fresh clones; gate 1 then rejects the sample as un-editable (fails safe).

```json
{
  "minWin": 1, "minQualityGain": null, "usageFactor": 1.5,
  "apply": {"dryRun": true},
  "budget": {"maxTotalTokens": 5000000, "maxIterations": 3},
  "candidates": {"maxPerIteration": 3},
  "replay": {"enabled": false, "minAgreement": 0.8}
}
```

`replay.enabled` is FALSE by default: the replay channel (Step 7, second
probe objective mined from real sessions + LLM judge) is advisory only and
not yet wired into selection. It leaves advisory mode only when
`/hloop-calibrate` records agreement ≥ `replay.minAgreement` (0.8) in the
ledger (gate: `isCalibrated` in loop/lib/replay.ts).

`apply.dryRun` is TRUE by default: winners are only diff-previewed (ledger
kind `apply-dryrun`), nothing is written to the live agent config. To enable
real apply, edit `loop/config.json` and set `"apply": {"dryRun": false}` —
applies then commit to `~/.pi/agent` (git, single-flight lock, rollback on
failure) and can be undone with `/hloop revert <runId>`.

### Surface registry (what the loop may propose edits to)

The registry (`loop/lib/surface.ts`, `SURFACE_KINDS`) drives validation,
staging, apply pathspecs, and revert for all components:

| kind | files | caps / rules |
| --- | --- | --- |
| `agents` | `AGENTS.md` | non-deletable, non-empty, ≤48KB |
| `skills` | `skills/<dir>/SKILL.md` + `skills/<dir>/scripts/*` | lowercase dirs, ≤100KB/file |
| `templates` | `prompts/<name>.md` | no frontmatter required; `{{…}}` tokens balance-checked; ≤100KB |
| `subagents` | `agents/<name>.md` | frontmatter `name` + `description` REQUIRED; `*.chain.md` excluded; ≤100KB |
| `extensions` | `extensions/<name>/...` | the ONLY code-bearing kind — see code gates below |
| `mcp` | `mcp.json` | validated against pi's real config shape; deletion rejected (empty `mcpServers` disables); runs the startup-probe gate |

### Code gates (extensions kind)

Editing an extension requires BOTH allowlist layers to pass:

1. **Config allowlist** — `"code": {"allow": ["<extension-name>"], "minWin": N}`
   in `loop/config.json` names the ONLY editable extensions (default allow
   list is empty; the real `loop/config.json` allowlists
   `harness-loop-sample`). `package.json`, `bun.lock`, `node_modules/`, and
   the loop's own extension are hard-rejected regardless of the allowlist.
2. **Real-FS gates** — the extension must carry a test file (`*.test.ts` in
   the extension dir or `test/`) and a resolvable `node_modules`; candidates
   on such extensions then run, in order: the startup probe (mcp-bearing only)
   → `bunx tsc --noEmit` → `bun test` in a staged sandbox → the full suite
   probe with the candidate staged.

Because code changes are riskier, selection uses `code.minWin` (default 2)
instead of the global `minWin`: a code-bearing candidate (or composition
containing one) must win by at least `code.minWin` net task wins.

### Iteration modes + roles

Per-iteration mode resolution (highest precedence first):

1. explicit `--mode` flag on `/hloop start` (the user always wins);
2. `post-targeted-confirmation` — the previous iteration ran `targeted` AND
   applied its winner (decision `applied` or `dry-run`): the next iteration
   is forced to `surface` so the subset-validated candidate is re-measured on
   the FULL suite;
3. `auto-switch` (`mode.auto`, default true) — the previous baseline had ≥1
   failing task → the next iteration targets those tasks (`targeted`);
4. the config default (`mode.default`, `surface`).

Role models (`config roles`, resolved once per run, persisted in state.json
and the report header): `proposer` (the Proposer model call), `judge` (the
LLM judge — calibration is keyed by this model), `probe` (nested-pi probes;
hashed into the baseline fingerprint, so changing it re-keys the cache once).
An unset role = the session model.

### Budget semantics

The budget metric is the SUM of probe `usage.totalTokens` across the run
(baseline + candidate probes) — NOT cost: `cost.total` is always 0 on this
gateway, so tokens are the only meaningful meter. The loop checks the budget
between iterations and before each probe spawn, and stops with reason
`budget-exceeded` when the sum reaches `budget.maxTotalTokens`. Other stop
reasons: `iterations-reached`, `stop-flag` (flag file seen + consumed),
`no-valid-candidates` (an iteration whose proposal had zero validated
candidates stops the whole loop).

**Overshoot bound:** the check runs BEFORE each spawn; probes already in
flight when the threshold is crossed are not killed, so real spend may
overshoot the cap by at most `maxConcurrentProbes − 1` probes (documented,
accepted).

### Budget semantics

The budget metric is the SUM of probe `usage.totalTokens` across the run
(baseline + candidate probes) — NOT cost: `cost.total` is always 0 on this
gateway, so tokens are the only meaningful meter. The loop checks the budget
between iterations and before each probe spawn, and stops with reason
`budget-exceeded` when the sum reaches `budget.maxTotalTokens`. Other stop
reasons: `iterations-reached`, `stop-flag` (flag file seen + consumed),
`no-valid-candidates` (an iteration whose proposal had zero validated
candidates stops the whole loop).

### State, ledger, reports

Every run persists `runs/<runId>/state.json` after every mutation (iteration
number, phase, budget spent, per-candidate decisions, proposed edits). Every
scored run and decision appends to `run-history.jsonl` (kinds: `baseline`,
`baseline-cached`, `candidate`, `apply`/`apply-dryrun`, `proposal-rejected`,
`revert`). Each iteration writes `runs/<runId>/iter-<n>/report.md` (baseline)
and per-candidate comparison reports `iter-<n>/cand-<i>/report.md`. The
baseline result cache (`loop/.cache/baseline-<fingerprint>-<taskset>.json`)
makes repeat baselines free (cache hit = no probes); a changed fingerprint
(AGENTS.md/skills/prompts/subagents/mcp.json/pi version/probe model)
invalidates it.

### Reading a report (`runs/<runId>/**/report.md`)

- **Header lines.** `kind` (`baseline` | `candidate`), `ts`, `model`, and the
  **fingerprint** — the sha256 of the snapshot + pi version + probe model; a
  candidate report's fingerprint differing from its baseline's means the
  ambient components moved mid-run (the driver refuses such comparisons).
  `cached: true` (and `[cached run]`) = results replayed from the baseline
  cache, no probes.
- **`probing:` line (probeStats).** `<tasks> task(s) — X probed, Y reused;
  max concurrent probes N; wall <duration>` — X/Y shows how much of the run
  came from the cache; N is the observed parallelism (bounded by
  `parallel.maxConcurrentProbes`).
- **`mode:` line.** The iteration's resolved mode + reason (`explicit-flag`,
  `post-targeted-confirmation`, `auto-switch`, `config-default`). A `targeted`
  report scores only the failing subset; its `boundTo` results are re-probed
  on the confirming full-suite iteration.
- **`role models:` line.** Only present when a role override differs from the
  session model.
- **Comparison tables** (`base pass` vs `cand pass` per task) drive selection:
  the candidate must net ≥ `minWin` (`code.minWin` for code-bearing) wins.
- **Failure excerpts.** A failed task with checker output shows the excerpt.
  A failed task with **null/zero token usage** is flagged
  **"suspected probe failure (no usage events)"** — the nested run never
  produced model events (provider/spawn breakdown), NOT evidence about the
  task. Retried probes record `attemptedRetry` + the first attempt's error in
  the per-task JSON result.
- **Composition.** When one iteration has multiple winners, the ledger gets
  `composed-out` entries for dropped/overlapping edits and the merged
  candidate is re-probed as a whole before apply (see loop/README.md,
  Compose).

### Revert procedure

1. `/hloop status` (or `git -C ~/.pi/agent log --grep 'harness-loop(run'`) to
   find the runId.
2. `/hloop revert <runId>` — refuses on a dirty tree under AGENTS.md/skills/,
   reverts only the marker commit, records a `revert` ledger entry.
   (In dry-run mode there is nothing to revert — no commit was made.)

### Cost expectations

- Full-suite baseline probe: ≈ 300–550k tokens per run (14 real tasks), once
  per fingerprint; cached afterwards.
- `/hloop start --suite "smoke-*"`: ≈ 2–8 smoke probes + 1–2 proposer calls
  per iteration (tens of k tokens) — the intended first live run.
- `bash loop/chaos.sh`: ≈ 6 min + real smoke-probe spend (~7 smoke baselines
  across the five kill scenarios + the lock check; runs/ + cache redirected
  to temp dirs, applies always dry-run).
- Unit/selftest layers (`bun test loop/lib/`, `driver.ts selftest`,
  `apply-test.ts`, `chaos-apply-refusal.ts`, `chaos-isolation.ts`): no model
  spend (fakes only).
- The FIRST live run should be: `/hloop start --suite "smoke-*" --iterations 2`
  (dry-run apply stays on until you flip `apply.dryRun` yourself).
