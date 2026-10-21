#!/usr/bin/env bash
# =============================================================================
# loop/chaos.sh — Step 12 crash-recovery rehearsal for the /hloop driver.
#
# Five kill scenarios + two concurrency checks. REAL `kill -9` + `--resume`
# runs for every scenario; where a subprocess phase is too short to time a
# kill against headlessly, the kill window is widened WITHOUT faking the phase
# itself (documented inline):
#
#   (a) mid-SERIAL-iteration  — real: kill -9 while a nested smoke probe runs
#       (concurrency 1), then `--resume`; asserts state.json consistency,
#       resume reuse, and no partial apply.
#   (b) mid-PARALLEL-iteration — real: same, with concurrency 2 and BOTH
#       probes observed in flight before the kill.
#   (c) during APPLY — per the S5 design, a kill between the file writes and
#       the commit is simulated by a pre-dirty managed path (the exact residue
#       such a crash leaves); asserts the next real (dryRun:false) apply
#       REFUSES before any write, and succeeds once the residue is resolved
#       (loop/chaos-apply-refusal.ts, temp git repo — never the live config).
#   (d) during CODE GATES — real gates (tsc + bun test in the sandbox), with
#       HLOOP_CHAOS_GATES_DELAY_S widening the kill window in front of the
#       gate call (a cached `bunx tsc` finishes in seconds — too fast to time
#       a kill reliably headlessly; the gates themselves run for real on
#       resume without the env).
#   (e) during MCP STARTUP PROBE — same pattern with HLOOP_CHAOS_MCP_DELAY_S;
#       the real `pi mcp list` connect check + OK-prompt run executes on
#       resume without the env.
#
# Extra checks:
#   - checker isolation: two concurrent probes of a checker writing a fixed
#     temp path must not interfere thanks to per-probe TMPDIR
#     (loop/chaos-isolation.ts, fake nested pi — no model spend).
#   - concurrent /hloop start lock rejection: two simultaneous starts; the
#     second must be refused by the single-flight guard.
#
# Chaos runs NEVER write to the live agent config (apply is dryRun, candidate
# applies are dry-run previews) and redirect runs/ + the baseline cache to
# temp dirs, so the rehearsal leaves the real runs/ history untouched. The
# only real artifacts are run-history.jsonl ledger entries (committed with
# the step) and real smoke-probe token spend.
#
# Runtime: ~5–9 min (smoke suite only, 1 iteration per run).
# Exit code: 0 only if EVERY scenario passes.
# =============================================================================
set -u

EXT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$EXT_DIR/../.." && pwd)"

RUNS_DIR="$(mktemp -d /tmp/hloop-chaos-runs-XXXXXX)"
LOG_DIR="$(mktemp -d /tmp/hloop-chaos-logs-XXXXXX)"
FAILURES=0
SCENARIOS_RUN=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$1" = "0" ]; then pass "$2"; else fail "$2"; fi; }

cleanup() { rm -rf "$RUNS_DIR" "$LOG_DIR"; }
trap cleanup EXIT

# --- polling helpers --------------------------------------------------------

# Echo the newest run dir name in $RUNS_DIR (run ids sort chronologically).
latest_run() { ls -1t "$RUNS_DIR" 2>/dev/null | head -1; }

# Wait until some run's state.json says "running" with pid == $1. Echoes runId.
wait_for_running_state() { # $1 = launcher pid, $2 = timeout s
  local i
  for i in $(seq 1 "$2"); do
    local run; run="$(latest_run)"
    if [ -n "$run" ] && grep -q '"status": "running"' "$RUNS_DIR/$run/state.json" 2>/dev/null \
       && grep -q "\"pid\": $1" "$RUNS_DIR/$run/state.json" 2>/dev/null; then
      echo "$run"; return 0
    fi
    sleep 1
  done
  return 1
}

wait_state_phase() { # $1 = runId, $2 = phase, $3 = timeout s
  local i
  for i in $(seq 1 "$3"); do
    grep -q "\"phase\": \"$2\"" "$RUNS_DIR/$1/state.json" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

wait_log_line() { # $1 = log file, $2 = grep pattern, $3 = timeout s
  local i
  for i in $(seq 1 "$3"); do
    grep -q "$2" "$1" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

wait_nested_pis() { # $1 = min count, $2 = timeout s
  local i n
  for i in $(seq 1 "$2"); do
    n="$(pgrep -fc -- '--mode json --no-session' 2>/dev/null || true)"
    [ "${n:-0}" -ge "$1" ] && return 0
    sleep 1
  done
  return 1
}

# --- assertions -------------------------------------------------------------

assert_process_dead() { # $1 = pid
  sleep 1
  if kill -0 "$1" 2>/dev/null; then
    fail "pid $1 survived kill -9"
  else
    pass "launcher pid $1 confirmed dead after kill -9"
  fi
}

assert_state_consistency() { # $1 = runId
  HLOOP_STATE_PATH="$RUNS_DIR/$1/state.json" bun -e '
    const {readFileSync} = require("node:fs");
    const s = JSON.parse(readFileSync(process.env.HLOOP_STATE_PATH, "utf8"));
    const problems = [];
    if (s.status !== "completed") problems.push("status=" + s.status);
    if (s.stopReason !== "iterations-reached") problems.push("stopReason=" + s.stopReason);
    if (!Array.isArray(s.iterations) || s.iterations.length !== 1) problems.push("iterations=" + JSON.stringify((s.iterations || []).length));
    for (const it of s.iterations ?? []) {
      if (it.phase !== "done") problems.push("iter " + it.index + " phase=" + it.phase);
      const iterDecisions = ["applied", "dry-run", "no-winner", "apply-rejected", "apply-failed", "no-valid-candidates"];
      if (!iterDecisions.includes(it.decision)) problems.push("iter " + it.index + " decision=" + it.decision);
      for (const c of it.candidates ?? []) {
        const terminal = ["pending", "not-scored"];
        if (terminal.includes(c.decision)) problems.push("iter " + it.index + " cand " + c.index + " non-terminal decision=" + c.decision);
      }
      if (!it.baseline || typeof it.baseline.totalTokens !== "number") problems.push("iter " + it.index + " baseline missing");
    }
    if (typeof s.budgetSpent !== "number" || s.budgetSpent < 0) problems.push("budgetSpent=" + s.budgetSpent);
    console.log(problems.length === 0 ? "CONSISTENT" : "INCONSISTENT: " + problems.join("; "));
  '
}

# No partial apply: the live repo must be clean under the loop's managed paths
# (surface registry gitPaths), excluding the loop's own self-subtree.
assert_clean_tree() {
  local dirty
  dirty="$(git -C "$AGENT_DIR" status --porcelain -- AGENTS.md skills prompts agents extensions mcp.json ':(exclude)extensions/harness-self-improvement' 2>/dev/null)"
  if [ -z "$dirty" ]; then
    pass "no partial apply — managed paths clean in the live agent repo"
  else
    fail "managed paths DIRTY after chaos run:"
    echo "$dirty" | sed 's/^/        /'
  fi
}

# --- shared scenario driver -------------------------------------------------

SCENARIO_ARGS=() # set per scenario

# run_kill_scenario <label> <concurrency> <candidate mode> <widener VAR=VAL or
# ""> <log marker> <settle s> <timeout s>
#
# Generic (a)/(b)/(d)/(e) flow: launch (fresh per-scenario runs + cache dir so
# the baseline always PROBES — a cache hit would leave nothing to kill mid-
# phase) → wait for the phase marker → kill -9 → resume (SAME cache dir: the
# killed run's partial per-task results are reused via boundTo, the baseline
# cache is only written once the baseline completes) → assert.
run_kill_scenario() {
  local label="$1" concurrency="$2" mode="$3" widener="$4" marker="$5" settle="$6" tmo="$7"
  SCENARIOS_RUN=$((SCENARIOS_RUN + 1))
  echo ""
  echo "== scenario $label =="
  local first_log="$LOG_DIR/$label-first.log"
  local resume_log="$LOG_DIR/$label-resume.log"
  local cache_dir; cache_dir="$(mktemp -d /tmp/hloop-chaos-cache-XXXXXX)"

  local pid
  pid="$(setsid env HLOOP_CHAOS_RUNS_DIR="$RUNS_DIR" \
    HLOOP_CHAOS_CACHE_DIR="$cache_dir" \
    $widener \
    bun run "$EXT_DIR/chaos-run.ts" --suite "smoke-*" --concurrency "$concurrency" --candidate "$mode" >"$first_log" 2>&1 & echo $!)"

  local run_id
  if ! run_id="$(wait_for_running_state "$pid" "$tmo")"; then
    fail "$label: no running state.json appeared (pid $pid)"; kill -9 -"$pid" 2>/dev/null; return 1
  fi
  local killed_pid
  killed_pid="$(grep -o '"pid": [0-9]*' "$RUNS_DIR/$run_id/state.json" | head -1 | grep -o '[0-9]*')"
  echo "  run $run_id (pid $killed_pid) started; waiting for phase marker '$marker'..."

  if ! wait_log_line "$first_log" "$marker" "$tmo"; then
    fail "$label: phase marker '$marker' never appeared in $first_log (tail below)"
    tail -5 "$first_log" | sed 's/^/        /'
    kill -9 -"$pid" 2>/dev/null; return 1
  fi
  sleep "$settle" # land INSIDE the phase, not on its boundary

  kill -9 -"$pid" 2>/dev/null
  assert_process_dead "$killed_pid"

  echo "  resuming with --resume $run_id ..."
  if ! timeout "$tmo" env HLOOP_CHAOS_RUNS_DIR="$RUNS_DIR" \
      HLOOP_CHAOS_CACHE_DIR="$cache_dir" \
      bun run "$EXT_DIR/chaos-run.ts" --resume "$run_id" --concurrency "$concurrency" --candidate "$mode" >"$resume_log" 2>&1; then
    fail "$label: resume did not complete cleanly (log tail below)"
    tail -10 "$resume_log" | sed 's/^/        /'
    assert_clean_tree
    return 1
  fi

  # Resume evidence: the driver logged the resume and took a NEW pid.
  grep -q "\[hloop\] resuming run $run_id" "$resume_log" && pass "resume logged: on-disk state reused (iterations/results/budget)"
  local new_pid
  new_pid="$(grep -o '"pid": [0-9]*' "$RUNS_DIR/$run_id/state.json" | head -1 | grep -o '[0-9]*')"
  [ -n "$new_pid" ] && [ "$new_pid" != "$killed_pid" ] && pass "state.json taken over by a new pid ($killed_pid → $new_pid)"

  local consistency
  consistency="$(assert_state_consistency "$run_id")"
  [ "$consistency" = "CONSISTENT" ] && pass "state.json consistent (status completed, iteration done, decisions terminal)" \
    || fail "state.json: $consistency"

  assert_clean_tree
}

# =============================================================================
# (a) mid-serial-iteration — real kill during a nested smoke probe.
# =============================================================================
echo "== scenario (a): kill -9 mid-SERIAL-iteration, then --resume =="
run_kill_scenario "a-serial" 1 "agents-md" "" "baseline probing" 3 180 || true

# =============================================================================
# (b) mid-parallel-iteration — real kill with BOTH probes in flight.
# =============================================================================
echo "== scenario (b): kill -9 mid-PARALLEL-iteration (concurrency 2) =="
run_kill_scenario "b-parallel" 2 "agents-md" "" "baseline probing" 3 180 || true

# =============================================================================
# (c) during apply — kill between write and commit, per the S5 design:
#     pre-dirty tree + the next apply must refuse (synthetic — the exact state
#     a mid-apply crash leaves; never touched against the live repo).
# =============================================================================
SCENARIOS_RUN=$((SCENARIOS_RUN + 1))
echo ""
echo "== scenario (c): crash between apply write and commit → next apply refuses =="
if bun run "$EXT_DIR/chaos-apply-refusal.ts" >"$LOG_DIR/c-apply.log" 2>&1; then
  pass "apply-refusal scenario: dirty tree refuses the next apply; resolution unblocks it"
else
  fail "apply-refusal scenario failed:"
  cat "$LOG_DIR/c-apply.log" | sed 's/^/        /'
fi
assert_clean_tree

# =============================================================================
# (d) during code gates — kill inside the gate phase (window widened by a
#     pre-gate delay; the gates run FOR REAL on resume, without the delay).
# =============================================================================
echo ""
echo "== scenario (d): kill -9 during CODE GATES, then --resume =="
run_kill_scenario "d-gates" 1 "gates" "HLOOP_CHAOS_GATES_DELAY_S=25" "running code gates" 3 300 || true

# =============================================================================
# (e) during MCP startup probe — kill inside the startup-probe phase (window
#     widened the same way; the real `pi mcp list` + OK-prompt run on resume).
# =============================================================================
echo ""
echo "== scenario (e): kill -9 during MCP STARTUP PROBE, then --resume =="
run_kill_scenario "e-mcp" 1 "mcp" "HLOOP_CHAOS_MCP_DELAY_S=25" "running mcp startup probe" 3 300 || true

# =============================================================================
# Extra: checker isolation under concurrent probes (per-probe TMPDIR).
# =============================================================================
echo ""
echo "== extra: checker isolation — two concurrent probes, fixed temp path =="
if bun run "$EXT_DIR/chaos-isolation.ts" >"$LOG_DIR/iso.log" 2>&1; then
  pass "concurrent checkers with a fixed temp path did not interfere (per-probe TMPDIR)"
else
  fail "checker isolation check failed:"
  cat "$LOG_DIR/iso.log" | sed 's/^/        /'
fi

# =============================================================================
# Extra: concurrent /hloop start — the single-flight lock must reject the
# second start while the first is live.
# =============================================================================
echo ""
echo "== extra: concurrent /hloop start → lock rejection =="
a_log="$LOG_DIR/lock-a.log"; b_log="$LOG_DIR/lock-b.log"
a_pid="$(setsid env HLOOP_CHAOS_RUNS_DIR="$RUNS_DIR" \
  HLOOP_CHAOS_CACHE_DIR="$(mktemp -d /tmp/hloop-chaos-cache-XXXXXX)" \
  bun run "$EXT_DIR/chaos-run.ts" --suite "smoke-*" --concurrency 1 >"$a_log" 2>&1 & echo $!)"
sleep 4 # A persists its running state well within this window
b_pid="$(setsid env HLOOP_CHAOS_RUNS_DIR="$RUNS_DIR" \
  HLOOP_CHAOS_CACHE_DIR="$(mktemp -d /tmp/hloop-chaos-cache-XXXXXX)" \
  bun run "$EXT_DIR/chaos-run.ts" --suite "smoke-*" --concurrency 1 >"$b_log" 2>&1 & echo $!)"

b_exit=0
# B is not a child of this shell (launched inside a command substitution), so
# poll for its death instead of wait(1).
for i in $(seq 1 60); do kill -0 "$b_pid" 2>/dev/null || break; sleep 1; done
b_out="$(cat "$b_log")"
if echo "$b_out" | grep -q "another loop run appears active"; then
  pass "second concurrent start refused by the single-flight lock"
else
  fail "second concurrent start was NOT refused (output below)"
  echo "$b_out" | tail -5 | sed 's/^/        /'
fi
echo "  (waiting for the first run to finish so its result can be asserted)"
if timeout 300 tail --pid="$a_pid" -f /dev/null >/dev/null 2>&1; then
  a_out="$(cat "$a_log")"
  if echo "$a_out" | grep -q '"status":"completed"'; then
    pass "first concurrent run completed normally"
  else
    fail "first concurrent run did not complete"
    echo "$a_out" | tail -5 | sed 's/^/        /'
  fi
else
  fail "first concurrent run timed out"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "== chaos.sh summary: $SCENARIOS_RUN scenario(s), $FAILURES failure(s) =="
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL SCENARIOS PASSED"
  exit 0
else
  echo "FAILURES PRESENT — logs kept in $LOG_DIR"
  trap - EXIT
  exit 1
fi
