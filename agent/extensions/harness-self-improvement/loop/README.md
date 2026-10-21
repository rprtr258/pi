# loop/ — the /hloop recursive optimization engine

Architecture reference for the self-improvement loop implemented in
`driver.ts` (`runLoop`) and wired into the session by the `/hloop` command
group in `../index.ts`. The user-facing runbook (commands, config, budget,
revert, report reading) lives in `../PLAN.md` → "Recursive optimization loop
(/hloop)". The task suite is documented separately: [suite/README.md](suite/README.md)
— every task is a `TASK.md` + deterministic `check.sh` with `ref/` (must-pass)
and `broken/` (must-fail) fixtures; **code extensions are editable only when
they carry a real test file** (`*.test.ts` in the extension dir or a `test/`
dir) plus a resolvable `node_modules` — enforced by the gate pipeline below.

## Surface registry (what the loop may edit)

`lib/surface.ts` describes every markdown/config component kind as data —
proposer validation, sandbox staging, apply pathspecs, and revert all iterate
`SURFACE_KINDS` instead of hardcoding paths.

| kind | files | notes |
| --- | --- | --- |
| `agents` | `AGENTS.md` | non-deletable, non-empty, ≤48KB |
| `skills` | `skills/<dir>/SKILL.md`, `skills/<dir>/scripts/*` | lowercase dirs, ≤100KB/file |
| `templates` | `prompts/<name>.md` | `{{PLACEHOLDER}}` balance-checked, no frontmatter required |
| `subagents` | `agents/<name>.md` | frontmatter `name` + `description` REQUIRED; `*.chain.md` excluded |
| `extensions` | `extensions/<name>/...` | ONLY code-bearing kind; two-layer allowlist (static shape regex here, dynamic `code.allow` + test-file + node_modules checks in gates); `package.json`/`bun.lock`/`node_modules/` and the loop's own extension are hard-rejected |
| `mcp` | `mcp.json` | one file, validated against pi's real config shape; deleting it is rejected (empty `mcpServers` is the disable path) |

## Data flow (one iteration)

```
Stage → Propose → Probe → Judge → Compose → Apply
```

1. **Stage** — `lib/stage.ts` snapshots the real agent dir (AGENTS.md, skills,
   prompts, subagents, mcp.json; the extensions kind contributes NO ambient
   files) into a per-run sandbox and replicates settings/npm/git stores as
   resolving symlinks.
2. **Propose** — `lib/proposer.ts` builds the ledger digest (rejected
   proposal fingerprints, so repeats are rejected), calls the Proposer model
   (`roles.proposer` model), and validates every candidate edit against the
   kind rules + the code allowlist (gate 1).
3. **Probe** — `lib/score.ts` runs the baseline (or reuses the fingerprint-keyed
   baseline cache) and one probe per candidate in identical sandboxes
   (`lib/probe.ts`: nested `pi` headless run, JSONL event capture, checker
   execution under a per-probe `TMPDIR`, process-group kill on timeout,
   ONE retry after a 2s backoff for provider-ish failures only).
4. **Judge** — selection (`selectWinner`) applies the paired-delta rules:
   min quality gain, `minWin` wins (code-bearing candidates/mixed compositions
   need `code.minWin`, default 2), usageFactor penalty; calibration + replay
   channel (`lib/replay.ts`, `lib/judge.ts`) stay advisory until
   `/hloop-calibrate` records agreement ≥ `replay.minAgreement`.
5. **Compose** — `lib/merge.ts` merges multiple winners of one iteration into
   a composed candidate (conflicting files dropped → `composed-out` ledger
   entries); the composition is a PROPOSAL only: it is re-probed as a whole
   before any apply, falling back to the best single winner on failure.
6. **Apply** — `lib/apply.ts` `applyCandidate`: dirty-tree preflight →
   explicit pathspec `git add` → write → commit with the
   `harness-loop(run <runId>):` marker → rollback buffer on failure; dry-run
   mode (the default) only diffs. Retention (`pruneRunDirs`) keeps the last
   `retention.maxRunDirs` run dirs after each successful run.

## Gate pipeline (code-bearing candidates)

`lib/gates.ts`, in order — a broken gate never burns rollout spend:

- **Gate 1 (validation time)** — extension name in `code.allow`, real test
  file present, real `node_modules` resolvable (proposer AND apply
  re-validate; the tree can change between them).
- **Gate 2 (startup probe)** — for mcp-bearing candidates: stage the candidate
  `mcp.json` into a sandbox and run the real `pi mcp list` connect check +
  OK-prompt run BEFORE tsc/bun test.
- **Gate 3 (code gates)** — `bunx tsc --noEmit` then `bun test` inside the
  staged extension sandbox (timeout-guarded, process-group killed).
- **Gate 4 (full suite probe)** — the driver's normal scoring, with the
  `HARNESS_LOOP_SAMPLE=1` marker enabling the suite's code-extension tasks.

## Failure semantics

- **Crash windows.** Every scored task result is written to disk as soon as it
  completes; `state.json` is persisted after every mutation. A `kill -9`
  anywhere (probe, gate, apply) leaves resumable state; the only non-resumable
  window — between apply's file writes and its commit — is covered by the
  dirty-tree preflight: the NEXT apply refuses until the residue is resolved
  (rehearsed in `chaos-apply-refusal.ts`).
- **Resume.** `/hloop start --resume <runId>` skips completed iterations and
  reuses on-disk per-task results (`boundTo` re-binds them to the new run);
  resuming a run whose live pid is still running is refused, as is a `--suite`
  that mismatches the recorded glob, and a fingerprint drift between crash
  and resume fails the run loudly.
- **Locks.** Single-flight: a start while another run's `state.json` says
  `running` with a live pid is rejected. Apply/revert take their own
  single-flight locks.
- **Budget.** `budget.maxTotalTokens` meters probe usage (sum of
  `usage.totalTokens`, NOT cost); checked between iterations and before each
  spawn. In-flight probes may overshoot by at most `maxConcurrentProbes − 1`
  probes (documented overshoot bound). Stop reasons: `budget-exceeded`,
  `iterations-reached`, `stop-flag` (the `loop/.stop` flag, consumed when
  seen), `no-valid-candidates`.
- **Retries.** Provider-ish probe failures (spawn error, non-zero exit with
  empty trajectory, no events parsed) are retried exactly ONCE after a 2s
  backoff; timeouts, checker failures, and setup errors are never retried.
  Retried results carry `attemptedRetry` + `firstError`.
- **Retention.** After a successful run, `runs/` is pruned to the
  `retention.maxRunDirs` (default 10) most-recent run dirs; the most recent is
  never deleted.

## Local verification

```
bun run loop/lib/suite.ts validate   # suite gatekeeper
bun test loop/lib/                   # unit tests (fakes only)
bun run loop/driver.ts selftest      # state machine on fakes
bun run loop/apply-test.ts           # apply/revert e2e in temp dirs
bun run loop/baseline.ts --cached    # report from the baseline cache
bash loop/chaos.sh                   # crash-recovery rehearsal (real probes)
bunx tsc --noEmit -p .               # type gate (suite/replay/runs excluded)
```
