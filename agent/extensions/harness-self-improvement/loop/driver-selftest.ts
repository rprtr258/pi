/**
 * Selftest for the /hloop driver state machine (loop/driver.ts): full happy
 * path with a winning candidate, stop-flag, budget-exceeded,
 * no-valid-candidates, resume after a simulated crash (state.json + partial
 * per-task results reused), stale-boundTo re-probe, resume of an alive-pid
 * active run refused, --suite mismatch on resume refused, fingerprint drift
 * between crash and resume fails the run, and single-flight refusal.
 *
 * Everything is faked (callModel, runProbe, snapshot, suite tasks, config,
 * dirs) — NO real model calls, NO real probes, NO writes outside temp dirs.
 *
 *   bun run loop/driver.ts selftest
 */
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runLoop, type LoopState, type RunLoopOptions} from "./driver.ts";
import {DEFAULT_LOOP_CONFIG} from "./lib/apply.ts";
import {readLedger} from "./lib/ledger.ts";
import type {RunProbeFn} from "./lib/score.ts";
import type {CallModel} from "./lib/proposer.ts";
import type {LoadedTask} from "./lib/suite.ts";
import type {ProbeResult} from "./lib/probe.ts";

const tmpRoots: string[] = [];

// ---------------------------------------------------------------------------
// Fakes

/** One candidate editing AGENTS.md — always validates. */
const CANDIDATE_JSON = JSON.stringify([
  {rationale: "selftest candidate", edits: [{path: "AGENTS.md", content: "# improved harness instructions\n"}]},
]);

/** baseline: smoke-a FAIL / smoke-b PASS; candidate: both PASS → +1 pass win. */
const WIN_PASS_MAP: Record<string, boolean> = {
  "baseline/smoke-a": false,
  "baseline/smoke-b": true,
  "candidate/smoke-a": true,
  "candidate/smoke-b": true,
};

function fakeProbeResult(pass: boolean, tokens: number): ProbeResult {
  return {
    trajectory: pass ? "did the task" : "",
    usage: {input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
    exit: 0,
    checkerResult: {pass, output: pass ? "" : "checker failed"},
    piBinary: {bin: "fake-pi", version: "selftest"},
    timedOut: false,
    stderrExcerpt: null,
    rawJsonlPath: null,
  };
}

function fakeTask(name: string): LoadedTask {
  const dir = join("/fake", name); // never touched by the fake probe
  return {
    name,
    category: name.split("-")[0] ?? name,
    paths: {dir, taskMd: join(dir, "TASK.md"), checkTs: join(dir, "check.ts"), ref: join(dir, "ref"), broken: join(dir, "broken"), setupSh: null},
    meta: {name, description: "selftest fixture task", timeoutS: 10},
    shapeErrors: [],
  };
}

/**
 * Fake probe: labels each spawn "baseline/<task>" or "candidate/<task>" by
 * the sandbox dir name (runs/<runId>/sandbox = baseline, sandbox-<i> =
 * candidate), records calls, returns passMap outcomes for `tokens` each.
 */
function makeProbe(passMap: Record<string, boolean>, probeCalls: string[], tokens = 1000, onProbe?: (task: string, sandboxDir: string) => void): RunProbeFn {
  return async (task, sandboxDir) => {
    const side = /sandbox-\d+$/.test(sandboxDir) ? "candidate" : "baseline";
    probeCalls.push(`${side}/${task.name}`);
    onProbe?.(task.name, sandboxDir);
    return fakeProbeResult(passMap[`${side}/${task.name}`] ?? false, tokens);
  };
}

type SelftestEnv = {
  root: string,
  opts: RunLoopOptions,
  runsDir: string,
  ledgerPath: string,
  stopFlagPath: string,
}

function makeEnv(probe: RunProbeFn, over: Partial<RunLoopOptions> = {}): SelftestEnv {
  const root = mkdtempSync(join(tmpdir(), "hloop-selftest-"));
  tmpRoots.push(root);
  const runsDir = join(root, "runs");
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, {recursive: true});
  const opts: RunLoopOptions = {
    callModel: (async () => CANDIDATE_JSON) as CallModel,
    runProbeFn: probe,
    snapshotFn: () => ({agentsMd: "selftest agents md", skills: []}),
    captureModelFn: () => "selftest/model",
    resolvePiBinaryFn: () => ({bin: "fake-pi", version: "selftest"}),
    tasksFn: () => [fakeTask("smoke-a"), fakeTask("smoke-b")],
    configOverride: structuredClone(DEFAULT_LOOP_CONFIG),
    runsDir,
    cacheDir: join(root, "cache"),
    ledgerPath: join(root, "run-history.jsonl"),
    stopFlagPath: join(root, "loop.stop"),
    agentDir,
    isPidAliveFn: () => false,
    log: () => {},
    ...over,
  };
  return {root, opts, runsDir, ledgerPath: opts.ledgerPath!, stopFlagPath: opts.stopFlagPath!};
}

function readState(runsDir: string, runId: string): LoopState {
  return JSON.parse(readFileSync(join(runsDir, runId, "state.json"), "utf8")) as LoopState;
}

// ---------------------------------------------------------------------------

type Check = (cond: boolean, label: string) => void;

async function scenarioHappyPath(check: Check): Promise<void> {
  console.log("== scenario: happy path (1 winning candidate, 2 iterations) ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls));
  const res = await runLoop({...env.opts, iterations: 2});
  check(res.ok && res.status === "completed", "run completes");
  check(res.stopReason === "iterations-reached", "stop reason iterations-reached");
  check(res.iterationsCompleted === 2, "2 iterations completed");
  const runId = res.runId!;
  const state = readState(env.runsDir, runId);
  check(state.status === "completed", "state.json status completed");
  const iter1 = state.iterations[0]!;
  check(iter1.candidates.length === 1, "1 candidate proposed");
  check(iter1.candidates[0]!.win === true, "candidate wins selection");
  check(iter1.candidates[0]!.decision === "winner-dry-run", "dry-run apply recorded on the candidate");
  check(iter1.decision === "dry-run", "iteration decision dry-run");
  check(iter1.baseline!.cached === false, "iter1 baseline probed");
  check(state.iterations[1]!.baseline!.cached === true, "iter2 baseline served from cache (no probes)");
  const cachedBaseline = JSON.parse(readFileSync(join(env.runsDir, runId, "iter-2", "baseline", "tasks", "smoke-a.json"), "utf8")) as {boundTo?: string};
  check(cachedBaseline.boundTo === undefined, "cache-hit baseline materializes WITHOUT boundTo (never resumable as this run's probe)");
  // budget: iter1 baseline 2×1000 + iter1 candidate 2×1000 + iter2 candidate 2×1000
  check(state.budgetSpent === 6000, "budget = 3 scored runs × 2000 tokens (cached baseline free)");
  check(probeCalls.filter((c) => c.startsWith("baseline/")).length === 2, "baseline probed only in iter1");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 4, "candidate scored once per iteration");
  check(existsSync(join(env.runsDir, runId, "iter-1", "report.md")), "iter-1 report.md exists");
  check(existsSync(join(env.runsDir, runId, "iter-2", "report.md")), "iter-2 report.md exists");
  check(existsSync(join(env.runsDir, runId, "iter-1", "cand-0", "report.md")), "candidate comparison report.md exists");
  const kinds = readLedger(env.ledgerPath).map((e) => e.kind);
  check(kinds.filter((k) => k === "baseline").length === 1, "one baseline ledger entry");
  check(kinds.filter((k) => k === "baseline-cached").length === 1, "one baseline-cached ledger entry");
  check(kinds.filter((k) => k === "candidate").length === 2, "one candidate ledger entry per iteration");
  check(kinds.filter((k) => k === "apply-dryrun").length === 2, "one apply-dryrun ledger entry per iteration");
}

async function scenarioStopFlag(check: Check): Promise<void> {
  console.log("== scenario: stop flag before start ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls));
  writeFileSync(env.stopFlagPath, "stop");
  const res = await runLoop(env.opts);
  check(res.status === "stopped" && res.stopReason === "stop-flag", "stops with reason stop-flag");
  check(res.iterationsCompleted === 0, "no iterations ran");
  check(!existsSync(env.stopFlagPath), "stop flag consumed (deleted)");
  check(probeCalls.length === 0, "no probes spawned");
}

async function scenarioBudgetExceeded(check: Check): Promise<void> {
  console.log("== scenario: budget exceeded before the proposer call ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls));
  const config = structuredClone(DEFAULT_LOOP_CONFIG);
  config.budget.maxTotalTokens = 1500; // baseline needs 2000
  const res = await runLoop({...env.opts, configOverride: config});
  check(res.status === "stopped" && res.stopReason === "budget-exceeded", "stops with reason budget-exceeded");
  check(res.budgetSpent === 2000, "budget accounting stops at the actually spent 2000 tokens");
  const state = readState(env.runsDir, res.runId!);
  check(state.iterations[0]!.phase === "propose", "stopped before the proposer model call");
  check(probeCalls.length === 2, "only the two baseline probes ran");
}

async function scenarioNoValidCandidates(check: Check): Promise<void> {
  console.log("== scenario: no valid candidates ==");
  // (a) proposer returns an empty array
  const envEmpty = makeEnv(makeProbe(WIN_PASS_MAP, []), {callModel: async () => "[]"});
  const resEmpty = await runLoop(envEmpty.opts);
  check(resEmpty.status === "stopped" && resEmpty.stopReason === "no-valid-candidates", "empty proposal stops the loop");
  check(readState(envEmpty.runsDir, resEmpty.runId!).iterations[0]!.decision === "no-valid-candidates", "iteration decision recorded");

  // (b) proposer returns a structurally invalid candidate (path outside the allowlist)
  const invalidJson = JSON.stringify([{rationale: "r", edits: [{path: "../evil.txt", content: "x"}]}]);
  const probeCalls: string[] = [];
  const envInvalid = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: async () => invalidJson});
  const resInvalid = await runLoop(envInvalid.opts);
  check(resInvalid.status === "stopped" && resInvalid.stopReason === "no-valid-candidates", "all-invalid proposal stops the loop");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 0, "invalid candidates are never scored");
}

async function scenarioResume(check: Check): Promise<void> {
  console.log("== scenario: resume after simulated crash ==");
  const probeCalls1: string[] = [];
  let stopFlag = "";
  // Crash probe: completes the first baseline task, then plants the stop
  // flag so the guard before the next probe aborts mid-baseline.
  const crashProbe = makeProbe(WIN_PASS_MAP, probeCalls1, 1000, (task) => {
    if (task === "smoke-a") writeFileSync(stopFlag, "stop");
  });
  const env = makeEnv(crashProbe);
  stopFlag = env.stopFlagPath;

  const res1 = await runLoop(env.opts);
  check(res1.status === "stopped" && res1.stopReason === "stop-flag", "mid-scoring abort stops with reason stop-flag");
  check(!existsSync(env.stopFlagPath), "stop flag consumed on abort");
  const runId = res1.runId!;
  check(probeCalls1.join(",") === "baseline/smoke-a", "exactly one baseline probe ran before the abort");
  check(res1.budgetSpent === 1000, "pre-crash budget = 1000 tokens");
  check(existsSync(join(env.runsDir, runId, "iter-1", "baseline", "tasks", "smoke-a.json")), "partial baseline result persisted to disk");
  check(readState(env.runsDir, runId).iterations[0]!.phase === "baseline", "state.json records the interrupted phase");

  // Simulate the crash residue: a SIGKILLed run never gets to persist its
  // clean stop, so its state.json still says status "running".
  const crashedState = readState(env.runsDir, runId);
  crashedState.status = "running";
  crashedState.stopReason = null;
  writeFileSync(join(env.runsDir, runId, "state.json"), `${JSON.stringify(crashedState, null, 2)}\n`);

  // Resume: the completed smoke-a result must be REUSED (no re-probe), the
  // rest runs normally, and its 1000 tokens are NOT counted twice.
  const probeCalls2: string[] = [];
  const res2 = await runLoop({...env.opts, resumeRunId: runId, runProbeFn: makeProbe(WIN_PASS_MAP, probeCalls2), iterations: 1});
  check(res2.status === "completed", "resumed run completes iteration 1");
  check(!probeCalls2.includes("baseline/smoke-a"), "completed baseline task reused, not re-probed");
  check(probeCalls2.includes("baseline/smoke-b"), "remaining baseline task probed on resume");
  check(res2.budgetSpent === 4000, "budget = 1000 (pre-crash) + 1000 (smoke-b) + 2000 (candidate) — no double count");
  const state = readState(env.runsDir, runId);
  check(state.iterations.length === 1 && state.iterations[0]!.phase === "done", "iteration 1 marked done in the same state.json");
  check(state.iterations[0]!.decision === "dry-run", "resumed iteration applied (dry-run) its winner");
  check(state.iterations[0]!.candidates[0]!.win === true, "candidate still wins after resume");
}

async function scenarioSingleFlight(check: Check): Promise<void> {
  console.log("== scenario: single-flight refusal ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls));
  const activeRunId = "20260101-000000-dead";
  const activeDir = join(env.runsDir, activeRunId);
  mkdirSync(activeDir, {recursive: true});
  writeFileSync(join(activeDir, "state.json"), JSON.stringify({runId: activeRunId, status: "running", pid: 424242}));

  const res = await runLoop({...env.opts, isPidAliveFn: () => true});
  check(res.status === "refused" && !res.ok, "refuses to start while another run's state says running with a live pid");
  check(res.runId === null && probeCalls.length === 0, "refused start probes nothing");

  const res2 = await runLoop({...env.opts, isPidAliveFn: () => false, iterations: 1});
  check(res2.status === "completed", "starts normally when the other run's pid is dead (crashed → resumable, not active)");
}

/**
 * Crash a run mid-candidate-scoring: baseline completes, candidate smoke-a
 * probes, then the planted stop flag aborts before candidate smoke-b. The
 * state.json is rewound to status "running" (crash residue) and the runId
 * is returned; the iteration is left in phase "score" with cand-0 pending.
 */
async function crashMidCandidate(env: SelftestEnv): Promise<string> {
  const probeCalls: string[] = [];
  const stopFlag = env.stopFlagPath;
  const crashProbe = makeProbe(WIN_PASS_MAP, probeCalls, 1000, (task, sandboxDir) => {
    if (task === "smoke-a" && /sandbox-\d+$/.test(sandboxDir)) writeFileSync(stopFlag, "stop");
  });
  const res = await runLoop({...env.opts, runProbeFn: crashProbe});
  if (res.status !== "stopped" || res.stopReason !== "stop-flag" || res.runId === null) {
    throw new Error(`crashMidCandidate: expected a stop-flag-stopped run, got ${res.status} (${res.stopReason})`);
  }
  const runId = res.runId;
  const crashedState = readState(env.runsDir, runId);
  crashedState.status = "running";
  crashedState.stopReason = null;
  writeFileSync(join(env.runsDir, runId, "state.json"), `${JSON.stringify(crashedState, null, 2)}\n`);
  return runId;
}

async function scenarioResumeActiveRun(check: Check): Promise<void> {
  console.log("== scenario: resume of an active (alive-pid) run is refused ==");
  const env = makeEnv(makeProbe(WIN_PASS_MAP, []));
  const done = await runLoop(env.opts);
  check(done.status === "completed", "seed run completes");
  const runId = done.runId!;
  // Crash residue: state.json says "running" again.
  const state = readState(env.runsDir, runId);
  state.status = "running";
  state.stopReason = null;
  writeFileSync(join(env.runsDir, runId, "state.json"), `${JSON.stringify(state, null, 2)}\n`);

  const resLive = await runLoop({...env.opts, resumeRunId: runId, isPidAliveFn: () => true});
  check(resLive.status === "refused" && !resLive.ok, "refuses to resume a run whose pid is alive (it is still ACTIVE)");
  check((resLive.stopReason ?? "").includes(`run ${runId} is still active`), "refusal names the still-active run");
  check((resLive.stopReason ?? "").includes("/hloop stop"), "refusal points at /hloop stop, not --resume");

  const resDead = await runLoop({...env.opts, resumeRunId: runId, isPidAliveFn: () => false});
  check(resDead.status === "completed", "resumes (proceeds) when the pid is dead — crashed runs are resumable");
}

async function scenarioStaleBoundToReprobed(check: Check): Promise<void> {
  console.log("== scenario: stale-boundTo candidate result is re-probed, not reused ==");
  const env = makeEnv(makeProbe(WIN_PASS_MAP, []));
  const runId = await crashMidCandidate(env);
  const candTasksDir = join(env.runsDir, runId, "iter-1", "cand-0", "tasks");
  check(existsSync(join(candTasksDir, "smoke-a.json")), "candidate smoke-a result persisted before the crash");
  // Plant a result bound to a DIFFERENT run/candidate over the crashed one.
  const stale = {
    task: "smoke-a",
    category: "smoke",
    pass: true,
    durationMs: 5,
    usage: {input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}},
    exit: 0,
    piBinary: {bin: "fake-pi", version: "selftest"},
    timedOut: false,
    checkerOutput: "",
    stderrExcerpt: null,
    trajectory: "",
    boundTo: "some-other-run/iter-9/cand-9",
  };
  writeFileSync(join(candTasksDir, "smoke-a.json"), `${JSON.stringify(stale, null, 2)}\n`);

  const probeCalls2: string[] = [];
  const res2 = await runLoop({...env.opts, resumeRunId: runId, runProbeFn: makeProbe(WIN_PASS_MAP, probeCalls2), iterations: 1});
  check(res2.status === "completed", "resumed run completes");
  check(probeCalls2.includes("candidate/smoke-a"), "stale-boundTo result was re-probed, not reused");
  const materialized = JSON.parse(readFileSync(join(candTasksDir, "smoke-a.json"), "utf8")) as {boundTo?: string, usage: {totalTokens: number}};
  check(materialized.boundTo === `${runId}/iter-1/cand-0`, "re-probe rewrote the result with THIS run's boundTo");
  check(materialized.usage.totalTokens === 1000, "fresh result (1000 tokens) replaced the stale one");
  check(res2.budgetSpent === 5000, "budget counts the re-probe: 3000 pre-crash + 1000 smoke-a + 1000 smoke-b");
}

async function scenarioResumeSuiteMismatch(check: Check): Promise<void> {
  console.log("== scenario: --suite mismatch on resume is refused ==");
  const env = makeEnv(makeProbe(WIN_PASS_MAP, []));
  const done = await runLoop({...env.opts, suiteGlob: "smoke-*"});
  check(done.status === "completed", "seed run with --suite completes");
  const runId = done.runId!;
  check(readState(env.runsDir, runId).suiteGlob === "smoke-*", "state.json records the suite glob");
  const state = readState(env.runsDir, runId);
  state.status = "running";
  state.stopReason = null;
  writeFileSync(join(env.runsDir, runId, "state.json"), `${JSON.stringify(state, null, 2)}\n`);

  const resMismatch = await runLoop({...env.opts, resumeRunId: runId, suiteGlob: "other-*"});
  check(resMismatch.status === "refused" && !resMismatch.ok, "refuses resume when --suite differs from the recorded suite");
  check((resMismatch.stopReason ?? "").includes("does not match the run's recorded suite"), "refusal explains the suite mismatch");

  const resMatch = await runLoop({...env.opts, resumeRunId: runId, suiteGlob: "smoke-*"});
  check(resMatch.status === "completed", "resumes when --suite matches the recorded suite");
}

async function scenarioFingerprintDrift(check: Check): Promise<void> {
  console.log("== scenario: snapshot drift between crash and resume fails the run ==");
  const env = makeEnv(makeProbe(WIN_PASS_MAP, []));
  const runId = await crashMidCandidate(env);
  const probeCalls: string[] = [];
  const res = await runLoop({
    ...env.opts,
    resumeRunId: runId,
    runProbeFn: makeProbe(WIN_PASS_MAP, probeCalls),
    // The agent config changed while the run was down: the recorded iteration
    // fingerprint no longer matches the current snapshot.
    snapshotFn: () => ({agentsMd: "CHANGED after the crash", skills: []}),
  });
  check(res.status === "failed", "run FAILS on fingerprint drift (no mismatched pairing)");
  check((res.stopReason ?? "").includes("snapshot changed between crash and resume"), "failure reason names the snapshot change");
  check(probeCalls.length === 0, "no probes ran against the drifted snapshot");
  const state = readState(env.runsDir, runId);
  check(state.status === "failed" && (state.stopReason ?? "").includes("snapshot changed"), "state.json records the drift failure");
}

async function scenarioResumeMissingState(check: Check): Promise<void> {
  console.log("== scenario: resume with missing state ==");
  const env = makeEnv(makeProbe(WIN_PASS_MAP, []));
  const res = await runLoop({...env.opts, resumeRunId: "no-such-run"});
  check(res.status === "refused", "refuses to resume a run without state.json");
}

export async function runSelftest(): Promise<number> {
  const failures: string[] = [];
  let passed = 0;
  const check: Check = (cond, label) => {
    if (cond) {
      passed++;
      console.log(`  ok: ${label}`);
    } else {
      failures.push(label);
      console.log(`  FAIL: ${label}`);
    }
  };
  try {
    await scenarioHappyPath(check);
    await scenarioStopFlag(check);
    await scenarioBudgetExceeded(check);
    await scenarioNoValidCandidates(check);
    await scenarioResume(check);
    await scenarioResumeActiveRun(check);
    await scenarioStaleBoundToReprobed(check);
    await scenarioResumeSuiteMismatch(check);
    await scenarioFingerprintDrift(check);
    await scenarioSingleFlight(check);
    await scenarioResumeMissingState(check);
  } catch (err) {
    failures.push(`unhandled selftest error: ${err instanceof Error ? err.stack : String(err)}`);
    console.error(err);
  } finally {
    for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
  }
  console.log(`\nselftest: ${passed} check(s) passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    return 1;
  }
  return 0;
}
