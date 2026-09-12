# Harness improvement cycles — run log

## 2026-09-12 — Cycle 2

**Evidence scanned**
- `bun stats.ts` (394 newest sessions, all post-cycle-1; 1,048 user messages)
- Full-corpus mining in parent (subagent lanes were broken, see C6): toolCall↔toolResult id join over all 392 files; error grouping per tool; read-waste via path-dirty tracking; user-text classification
- Live verification: fd/bin state, pi-subagents preflight source (child-tool-plan.ts), A/B bench of analyze-only trap via 2 fresh miner subagents

**Findings**
- Cycle-1 verification: C1 find FIXED (EACCES tail ended Sep 2, bin dir gone); C5 bash-big halved (7.1MB/392, redirect adoption 29.5%); C3 write-exists flat (52/276) but recovery clean (5 bypasses vs 25); C4 re-read rule FAILED (49.4% same-path, 1,611 pure-waste = 9.2MB = 43% of read bytes); C6 chrome partial (stale-page 2, missing-pageId validation 17)
- New: ctx_execute "fence errors" were misdiagnosed echo artifacts — real causes are ordinary script bugs + documented sandbox-cwd; subagent lanes unlaunchable because preflight compares against host registry where pi-fff shadows read/grep/edit (children get neither fff nor core under --no-extensions); analyze-only violation (2026-04-07: 1 write + 5 edits after "only tell") — but bench-verified as not reproducing today

**Approved & implemented**
- C4 stats.ts correction markers v3 (user-approved list): hits 16→30; genuine new catches ("take all my memory", "ignored instruction", "you did not mark", analyze-only instructions). Known noise: `explain why` also matches pure analysis requests — kept as approved, narrowable to `explain why you` on request
- C6 final form (user steered twice: "fix that agents as well" → "reenable pi-fff enhancements, fix agents instead"):
  1. `~/.pi/agent/extensions/pi-fff.json` deleted — fff read/grep enhancements back on for the parent
  2. user-level overrides `~/.pi/agent/agents/scout.md` + `~/.pi/agent/agents/reviewer.md`: same builtin personas, tools matched to host (find/ls/bash/write/contact_supervisor for scout; find/ls/bash/contact_supervisor for reviewer), inspection via bash sed/cat/grep/rg with capped output
  3. `miner.md` cleaned (dropped dead pi-fff path entry, honest description)
  Verified in-session: scout probe completed (first successful scout launch here); reviewer ran a real review and caught the planted nil-sentinel P0 + TOCTOU P1 + missing tests. delegate/worker/oracle untouched (launch with pruning warning; models fall back to bash)
- C5 analyzed + A/B bench: analyze-only trap replica, 2 fresh miners, 0 mutations both arms (md5-verified) → recommendation: do NOT add the line; April evidence stale; monitor via C4 markers. Pending user confirmation
- Per user: C1 (read-guard) and C3 (chrome SKILL.md pageId) rejected — cycle-1 rule/skill fixes "not yet tested", monitor before adding more

**Verification pending future cycles**: F3 re-read waste (pure-waste share, rule vs tooling decision); F5 chrome pageId errors; F2 write-exists rate; C4 marker precision at scale; miner-agent mining quality vs parent-mining

**Reverted items**: none.

**Deferred / rejected**: read-guard extension (user: rule not yet tested); chrome pageId SKILL.md example (user: C6 not yet tested); ctx_execute fence-strip (root-cause investigation showed nothing to fix); AGENTS.md analyze-only line (bench says unnecessary); restoring read/grep in subagent children (upstream pi-subagents limitation)

## 2026-02-15 — Cycle 1

**Evidence scanned**
- `bun stats.ts` (200 newest sessions: 621 user messages, tool call/error table)
- Full-corpus mining via 5 parallel read-only subagents (376 session files incl. nested run dirs, ~83MB): edit-family errors, small-n tool errors, bash error patterns, user-message classification (1027 text items, 90 corrections), skill adoption + redundant patterns
- Direct verification: fd binary state, stats.ts window replication, pi core tools-manager resolution chain

**Findings (top)**
1. `find` tool 100% broken — `~/.pi/agent/bin/fd` lacked exec bit → `spawn fd EACCES` (8/8 errors)
2. write tool errors 100% "File already exists" (39/39); 25/39 times agent then bypassed the no-overwrite guard via `bash cat > file`
3. Edit failures dominated by stale oldText (not-found 50, not-unique 6, no-op 7 of 75); self-heals on retry 20/22
4. stats.ts correction detector recall ~3% (opener regex caught 3 of 90 real corrections)
5. Duplicate reads: 1,576 same-path re-reads (38.5% of read calls), ~8.9MB
6. Oversized bash output: 636 results >4KB = 6.8MB; ctx suite used 205× vs bash 7,522×
7. Benign: bash 4.65% errors (verify-loop exits), webfetch dead URLs, guardrail errors on ls/ctx
8. chrome_devtools: 15/30 errors = missing/stale pageId; question/questionnaire/subagent arg-shape errors self-corrected (~42 of 66 small-n errors)

**Approved & implemented**
- C1 (find tool): user removed `~/.pi/agent/bin/` entirely; pi core falls back to system `fd` 10.5.0 (linuxbrew). Verified: `find` tool call returns results. No code change.
- C2 stats.ts correction markers: added content-level regex (`didn'?t work`, `you broke`, `i did not (tell|ask|say)`, `why did you`, `still (broken|stuck|resetting)`, etc.) beside the opener regex. Verified: full-corpus run reports 15 hits (was 3), examples are genuine corrections.
- C3 AGENTS.md write guidance: "write is for new files only; verify path doesn't exist; use edit for existing files." Baseline: write-exists 51/257 (19.8%).
- C4 AGENTS.md no-re-read line: "Don't re-read a file you already read this session unless it changed since." Baseline: same-path re-reads 1,576/4,090 (38.5%).
- C5 AGENTS.md large-output line (amended same cycle at user request): redirect full output to a tmp file first, inspect its tail; reuse the file for follow-up searches instead of re-running the command. Baseline: bash output >4KB ≈ 6.8MB/200 sessions.
- C6 chrome-devtools SKILL.md: pageId note (most tools require pageId from list_pages; restarts invalidate ids).
- C7 (log-only, no code) Subagent workflowScript gotchas hit this cycle: it is a statement body — no `export`/meta export (that's the `workflow` tool); don't shadow the sandbox `runs` global; no `parallel()` — use `runs.all([...])`. Cost 4 failed launches before first success.
- C8 Confirm step now: agent writes `harness-findings.md` in this directory (findings + ranked candidates format), then calls the new `harness_annotate_findings` tool (added to this extension) which emits `plannotator:request` action `annotate` with `gate: true`, opens the browser annotation UI, blocks, and returns the user's feedback. Verified: tsc clean, module imports, event API matches plannotator's documented extension contract (README + plannotator-events.ts).

**Verification pending future cycles** (measure with stats.ts / re-mining): C3/C4/C5 baselines above; chrome_devtools pageId errors (15/200 sessions baseline).

**Reverted items**: none.

**Deferred / rejected**: edit-tool fuzzy match hints (pi core internals, out of scope); skill-adoption push (injection already covers); bash-vs-native-tool guidance (mostly deliberate piping); `python`→`python3` (2 hits, noise).
