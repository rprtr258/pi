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
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runLoop, type LoopState, type RunLoopOptions} from "./driver.ts";
import {DEFAULT_LOOP_CONFIG, type LoopConfig} from "./lib/apply.ts";
import {readLedger} from "./lib/ledger.ts";
import type {RunProbeFn} from "./lib/score.ts";
import type {CallModel} from "./lib/proposer.ts";
import {candidateFingerprint} from "./lib/proposer.ts";
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
    // Step 10: sandbox-composed is the composed candidate's whole re-probe.
    const side = sandboxDir.endsWith("sandbox-composed") ? "composed" : /sandbox-\d+$/.test(sandboxDir) ? "candidate" : "baseline";
    probeCalls.push(`${side}/${task.name}`);
    onProbe?.(task.name, sandboxDir);
    return fakeProbeResult(passMap[`${side}/${task.name}`] ?? false, tokens);
  };
}

interface SelftestEnv {
  root: string;
  opts: RunLoopOptions;
  runsDir: string;
  ledgerPath: string;
  stopFlagPath: string;
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
    snapshotFn: () => ({kinds: {agents: [{relPath: "AGENTS.md", content: "selftest agents md"}], skills: [], templates: [], subagents: [], extensions: [], mcp: []}}),
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
  // Fix: config.code (allow + minWin) snapshotted into state.config at run
  // start so resumed runs keep the same code thresholds.
  check(state.config.code !== undefined && state.config.code.minWin === DEFAULT_LOOP_CONFIG.code.minWin, "config.code.minWin snapshotted into state.config at run start");
  check(Array.isArray(state.config.code?.allow), "config.code.allow snapshotted into state.config at run start");
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
  const materialized = JSON.parse(readFileSync(join(candTasksDir, "smoke-a.json"), "utf8")) as {boundTo?: string; usage: {totalTokens: number}};
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
    snapshotFn: () => ({kinds: {agents: [{relPath: "AGENTS.md", content: "CHANGED after the crash"}], skills: [], templates: [], subagents: [], extensions: [], mcp: []}}),
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

// ---------------------------------------------------------------------------
// Step 9a: code gate pipeline scenarios (extensions kind)

const CODE_CANDIDATE_JSON = JSON.stringify([
  {rationale: "selftest code candidate", edits: [{path: "extensions/sample-ext/index.ts", content: "export default function (pi: unknown) { void pi; }\n// improved\n"}]},
]);

const LOAD_ERROR_STDERR = `Error: Failed to load extension "/fake/sandbox/extensions/sample-ext/index.ts": ParseError: boom`;

/** A gated real extension in the env's temp agentDir (passes gate 1). */
function stageGatedExtension(agentDir: string): void {
  const extDir = join(agentDir, "extensions", "sample-ext");
  mkdirSync(join(extDir, "node_modules"), {recursive: true});
  writeFileSync(join(extDir, "index.ts"), "export default function (pi: unknown) { void pi; }\n");
  writeFileSync(join(extDir, "index.test.ts"), "import {test, expect} from \"bun:test\";\ntest(\"ok\", () => { expect(1).toBe(1); });\n");
}

function codeConfig(codeAllow: string[] = ["sample-ext"], minWin = 2): ReturnType<typeof structuredClone<LoopConfig>> {
  const config = structuredClone(DEFAULT_LOOP_CONFIG);
  config.code = {allow: codeAllow, minWin};
  return config;
}

async function scenarioCodeGateFailure(check: Check): Promise<void> {
  console.log("== scenario: code gate failure (tsc) rejects the candidate before any probe ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => CODE_CANDIDATE_JSON) as CallModel, configOverride: codeConfig()});
  stageGatedExtension(env.opts.agentDir!);
  const gateCalls: string[] = [];
  const res = await runLoop({
    ...env.opts,
    codeGatesFn: async (sandboxDir, extName) => {
      gateCalls.push(`${sandboxDir}:${extName}`);
      return {ok: false, failedGate: "tsc", output: "error TS1005: ';' expected", timedOut: false};
    },
  });
  check(res.status === "stopped" && res.stopReason === "no-valid-candidates", "run stops with no scored candidates");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "gates-failed", "candidate decision gates-failed");
  check(iter.candidates[0]!.reasons[0]!.includes("code gate 'tsc' failed"), "captured tsc output in candidate reasons");
  check(iter.candidates[0]!.scores === null && iter.candidates[0]!.win === null, "candidate was never scored");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 0, "suite probe NOT run after the gate failure");
  check(gateCalls.length === 1, "gate pipeline ran once");
  check(existsSync(join(env.runsDir, res.runId!, "iter-1", "cand-0", "report.md")), "gate-failure report.md written");
  const kinds = readLedger(env.ledgerPath).map((e) => e.kind);
  check(kinds.filter((k) => k === "code-gate-failed").length === 1, "one code-gate-failed ledger entry");
}

async function scenarioCodeLoadError(check: Check): Promise<void> {
  console.log("== scenario: extension load error captured from the probe output ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => CODE_CANDIDATE_JSON) as CallModel, configOverride: codeConfig()});
  stageGatedExtension(env.opts.agentDir!);
  // Probe reports the empirical nested-pi load-error line on stderr.
  const probe: RunProbeFn = async (task, sandboxDir) => {
    const side = /sandbox-\d+$/.test(sandboxDir) ? "candidate" : "baseline";
    probeCalls.push(`${side}/${task.name}`);
    const result = fakeProbeResult(WIN_PASS_MAP[`${side}/${task.name}`] ?? false, 1000);
    result.stderrExcerpt = side === "candidate" ? LOAD_ERROR_STDERR : null;
    return result;
  };
  const res = await runLoop({...env.opts, runProbeFn: probe, codeGatesFn: async () => ({ok: true, failedGate: null, output: "", timedOut: false})});
  check(res.status === "stopped" && res.stopReason === "no-valid-candidates", "run stops after the load-error rejection");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "gates-failed", "candidate decision gates-failed (load error)");
  check(iter.candidates[0]!.reasons[0]!.includes("failed to load the staged extension"), "load-error reason recorded");
  check(iter.candidates[0]!.reasons[0]!.includes("Failed to load extension"), "captured error shape in reasons");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 2, "suite probe ran first (load errors are captured after the suite)");
  const kinds = readLedger(env.ledgerPath).map((e) => e.kind);
  check(kinds.filter((k) => k === "code-gate-failed").length === 1, "one code-gate-failed ledger entry (gate: load-error)");
}

async function scenarioCodeMinWin(check: Check): Promise<void> {
  console.log("== scenario: code.minWin overrides minWin for code-bearing candidates ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => CODE_CANDIDATE_JSON) as CallModel, configOverride: codeConfig(["sample-ext"], 2)});
  stageGatedExtension(env.opts.agentDir!);
  // Candidate improves +1 pass (below code.minWin 2) → must NOT win despite
  // satisfying the global minWin 1.
  const res = await runLoop({...env.opts, codeGatesFn: async () => ({ok: true, failedGate: null, output: "", timedOut: false})});
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.win === false, "+1 pass does NOT win with code.minWin 2");
  check(iter.candidates[0]!.reasons.some((r) => r.includes("minWin 2")), "selection reasons reference code.minWin 2");
  check(iter.decision === "no-winner", "iteration decision no-winner");

  // A +2 pass improvement meets code.minWin 2 → wins (proves the override
  // also opens the door, not only blocks).
  const probeCalls2: string[] = [];
  const env2 = makeEnv(makeProbe({"baseline/smoke-a": false, "baseline/smoke-b": false, "candidate/smoke-a": true, "candidate/smoke-b": true}, probeCalls2), {callModel: (async () => CODE_CANDIDATE_JSON) as CallModel, configOverride: codeConfig(["sample-ext"], 2)});
  stageGatedExtension(env2.opts.agentDir!);
  const res2 = await runLoop({...env2.opts, codeGatesFn: async () => ({ok: true, failedGate: null, output: "", timedOut: false})});
  check(readState(env2.runsDir, res2.runId!).iterations[0]!.candidates[0]!.win === true, "+2 pass wins with code.minWin 2");
}

// ---------------------------------------------------------------------------
// Step 9b: mcp startup-probe gate scenarios (mcp.json kind)

/** A shape-valid mcp.json candidate whose server cannot connect (broken stdio command). */
const MCP_BROKEN_CANDIDATE_JSON = JSON.stringify([
  {
    rationale: "selftest mcp candidate",
    edits: [{path: "mcp.json", content: `${JSON.stringify({mcpServers: {broken: {command: "/nonexistent/binary"}}})}\n`}],
  },
]);

/** A shape-INVALID mcp.json candidate (non-string command) — rejected at validation time. */
const MCP_SHAPE_INVALID_JSON = JSON.stringify([
  {rationale: "selftest mcp candidate", edits: [{path: "mcp.json", content: '{"mcpServers":{"x":{"command":42}}}'}]},
]);

async function scenarioMcpStartupFailure(check: Check): Promise<void> {
  console.log("== scenario: mcp startup-probe failure rejects the candidate before any suite probe ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => MCP_BROKEN_CANDIDATE_JSON) as CallModel});
  const gateCalls: string[] = [];
  const startupCalls: string[] = [];
  const res = await runLoop({
    ...env.opts,
    codeGatesFn: async (sandboxDir, extName) => {
      gateCalls.push(`${sandboxDir}:${extName}`);
      return {ok: true, failedGate: null, output: "", timedOut: false};
    },
    startupProbeFn: async (sandboxDir) => {
      startupCalls.push(sandboxDir);
      // Phase-b usage (review fix): must land in budgetSpent + the ledger.
      return {ok: false, failedPhase: "mcp-list" as const, timedOut: false, error: 'MCP server "broken" failed to connect: spawn /nonexistent/binary ENOENT', usageTokens: 123};
    },
  });
  check(res.status === "stopped" && res.stopReason === "no-valid-candidates", "run stops with no scored candidates");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "gates-failed", "candidate decision gates-failed (mcp startup probe)");
  check(iter.candidates[0]!.reasons[0]!.includes("mcp startup probe failed"), "startup-probe failure reason recorded");
  check(iter.candidates[0]!.reasons[0]!.includes("failed to connect"), "captured connect error in candidate reasons");
  check(iter.candidates[0]!.scores === null && iter.candidates[0]!.win === null, "candidate was never scored");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 0, "suite probe NOT run after the startup-probe failure (zero rollout spend)");
  check(startupCalls.length === 1, "startup probe ran exactly once");
  check(gateCalls.length === 0, "tsc/bun-test gates not run for an mcp-only candidate");
  // Step 9b review fix: the startup probe's phase-b usage is budget-accounted
  // even when the probe fails, and recorded in the code-gate ledger entry.
  // (Baseline probes cost 2 tasks × 1000 tokens; the startup probe adds 123.)
  check(res.budgetSpent === 2123, "startup probe usage (123 tokens) accounted into budgetSpent even on failure (2000 baseline + 123)");
  const gateEntry = readLedger(env.ledgerPath).find((e) => e.kind === "code-gate-failed");
  check(gateEntry?.usage?.totalTokens === 123, "code-gate ledger entry carries the startup probe usage");
  check(existsSync(join(env.runsDir, res.runId!, "iter-1", "cand-0", "report.md")), "startup-probe-failure report.md written");
  const kinds = readLedger(env.ledgerPath).map((e) => e.kind);
  check(kinds.filter((k) => k === "code-gate-failed").length === 1, "one code-gate-failed ledger entry (gate: startup-probe)");
  // The candidate sandbox had the CANDIDATE mcp.json staged (overlay check).
  const staged = readFileSync(join(env.runsDir, res.runId!, "sandbox-0", "mcp.json"), "utf8");
  check(staged.includes("/nonexistent/binary"), "candidate mcp.json staged into the sandbox");
}

async function scenarioMcpShapeFailNoStartupProbe(check: Check): Promise<void> {
  console.log("== scenario: shape-invalid mcp candidate is rejected at validation time, startup probe never runs ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => MCP_SHAPE_INVALID_JSON) as CallModel});
  const startupCalls: string[] = [];
  const res = await runLoop({
    ...env.opts,
    startupProbeFn: async (sandboxDir) => {
      startupCalls.push(sandboxDir);
      return {ok: true, failedPhase: null, timedOut: false, error: "", usageTokens: 0};
    },
  });
  check(res.status === "stopped" && res.stopReason === "no-valid-candidates", "shape-invalid proposal stops the loop");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.verdict === "rejected", "candidate rejected at validation");
  check(iter.candidates[0]!.reasons.some((r) => r.includes('"command" must be a string')), "shape validator reason recorded");
  check(startupCalls.length === 0, "startup probe NOT run for a shape-failed candidate (gate 1 is validation-time)");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 0, "suite probe NOT run");
}

async function scenarioMcpHealthyPathAndMinWin(check: Check): Promise<void> {
  console.log("== scenario: healthy mcp candidate passes the startup probe; code.minWin applies ==");
  // mcp-bearing candidate = code-bearing: +1 pass (below code.minWin 2) must NOT win.
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => MCP_BROKEN_CANDIDATE_JSON) as CallModel});
  const startupCalls: string[] = [];
  const res = await runLoop({
    ...env.opts,
    startupProbeFn: async (sandboxDir) => {
      startupCalls.push(sandboxDir);
      return {ok: true, failedPhase: null, timedOut: false, error: "", usageTokens: 0};
    },
  });
  check(startupCalls.length === 1, "startup probe ran for the mcp-bearing candidate");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "loser", "healthy mcp candidate was scored");
  check(iter.candidates[0]!.win === false, "+1 pass does NOT win with code.minWin 2 (mcp-bearing = code-bearing)");
  check(iter.candidates[0]!.reasons.some((r) => r.includes("minWin 2")), "selection reasons reference code.minWin 2");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 2, "suite probe ran after the startup probe passed");
}

async function scenarioMcpMixedCandidateGateOrder(check: Check): Promise<void> {
  console.log("== scenario: mixed mcp+extension candidate runs startup probe BEFORE tsc/bun test ==");
  const mixedJson = JSON.stringify([
    {
      rationale: "selftest mixed candidate",
      edits: [
        {path: "mcp.json", content: `${JSON.stringify({mcpServers: {a: {command: "a-server"}}})}\n`},
        {path: "extensions/sample-ext/index.ts", content: "export default function (pi: unknown) { void pi; }\n"},
      ],
    },
  ]);
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(WIN_PASS_MAP, probeCalls), {callModel: (async () => mixedJson) as CallModel, configOverride: codeConfig()});
  stageGatedExtension(env.opts.agentDir!);
  const order: string[] = [];
  const res = await runLoop({
    ...env.opts,
    startupProbeFn: async () => {
      order.push("startup-probe");
      return {ok: true, failedPhase: null, timedOut: false, error: "", usageTokens: 0};
    },
    codeGatesFn: async () => {
      order.push("code-gates");
      return {ok: true, failedGate: null, output: "", timedOut: false};
    },
  });
  check(order.join(",") === "startup-probe,code-gates", "cheapest-first gate order: startup probe → tsc/bun test → suite probe");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "loser", "mixed candidate scored (both gates passed)");
  check(iter.candidates[0]!.win === false, "+1 pass does not meet code.minWin 2 for the mixed candidate");
  const staged = readFileSync(join(env.runsDir, res.runId!, "sandbox-0", "mcp.json"), "utf8");
  check(staged.includes("a-server"), "candidate mcp.json staged for the mixed candidate");
}

// ---------------------------------------------------------------------------
// Step 10: composer merge scenarios

/** Two DISJOINT winners: cand0 edits AGENTS.md, cand1 adds a skill. */
const DISJOINT_CANDIDATES_JSON = JSON.stringify([
  {rationale: "cand zero agents", edits: [{path: "AGENTS.md", content: "# improved by cand zero\n"}]},
  {rationale: "cand one skill", edits: [{path: "skills/extra/SKILL.md", content: "# extra skill from cand one\n"}]},
]);

/** Partially-disjoint winners: BOTH edit AGENTS.md (different lengths, so the applied byte size proves which content won); cand1 also adds a prompt. */
const CONFLICT_CANDIDATES_JSON = JSON.stringify([
  {rationale: "conflict cand zero", edits: [{path: "AGENTS.md", content: "# zero wins the conflict\n"}]},
  {rationale: "conflict cand one", edits: [{path: "AGENTS.md", content: "# one loses\n"}, {path: "prompts/extra.md", content: "say {{hi}}"}]},
]);

/** Baseline 1/2; each candidate 2/2 (+1 → both win); composed 2/2 (+2 → wins). */
const COMPOSES_PASS_MAP: Record<string, boolean> = {...WIN_PASS_MAP, "composed/smoke-a": true, "composed/smoke-b": true};

async function scenarioCompositionDisjoint(check: Check): Promise<void> {
  console.log("== scenario: two disjoint winners compose; composed re-probed BEFORE any apply ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(COMPOSES_PASS_MAP, probeCalls), {callModel: (async () => DISJOINT_CANDIDATES_JSON) as CallModel});
  const res = await runLoop({...env.opts, iterations: 1});
  check(res.status === "completed", "run completes with composition");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates.length === 2 && iter.candidates.every((c) => c.win === true), "both candidates won selection independently");
  // HARD RULE: the composed candidate is re-probed AS A WHOLE before any apply.
  check(probeCalls.includes("composed/smoke-a") && probeCalls.includes("composed/smoke-b"), "composed candidate re-probed as a whole (composed sandbox, both tasks)");
  check(iter.candidates.every((c) => c.decision === "winner-dry-run"), "both contributing winners recorded as applied (dry-run) via the composition");
  check(iter.decision === "dry-run", "iteration decision dry-run (composed apply)");
  const entries = readLedger(env.ledgerPath);
  const composedIdx = entries.findIndex((e) => e.kind === "composed");
  const applyIdx = entries.findIndex((e) => e.kind === "apply-dryrun");
  check(composedIdx !== -1 && applyIdx !== -1 && composedIdx < applyIdx, "composed entry ledgered BEFORE the apply entry (scored before apply)");
  const composed = entries[composedIdx] as (typeof entries)[number] & {sources?: number[]; fileAttribution?: Record<string, number>; fingerprint?: string};
  check(composed.decision === "won" && composed.win === true, "composed result INDEPENDENTLY cleared selectWinner vs baseline");
  check(composed.fingerprint === candidateFingerprint([
    {path: "AGENTS.md", content: "# improved by cand zero\n"},
    {path: "skills/extra/SKILL.md", content: "# extra skill from cand one\n"},
  ]), "composed ledger entry carries the composed candidate's fingerprint");
  check(JSON.stringify(composed.sources) === "[0,1]", "composed sources recorded (both candidates)");
  check(JSON.stringify(composed.fileAttribution) === JSON.stringify({"AGENTS.md": 0, "skills/extra/SKILL.md": 1}), "per-file attribution recorded");
  check(entries.filter((e) => e.kind === "composed-out").length === 0, "no composed-out entries for a fully disjoint merge");
  // apply called with the COMPOSED result: the apply entry carries BOTH files.
  const applyEntry = entries[applyIdx] as (typeof entries)[number] & {files?: Array<{path: string}>};
  const applyPaths = (applyEntry.files ?? []).map((f) => f.path).sort();
  check(JSON.stringify(applyPaths) === JSON.stringify(["AGENTS.md", "skills/extra/SKILL.md"]), "apply called with the composed file set (both winners' files)");
  check(existsSync(join(env.runsDir, res.runId!, "iter-1", "composed", "report.md")), "composed report.md written");
  const iterReport = readFileSync(join(env.runsDir, res.runId!, "iter-1", "report.md"), "utf8");
  check(iterReport.includes("## Composition"), "iteration report.md notes the composition");
  check(iterReport.includes("AGENTS.md ← cand-0"), "report.md records per-file attribution");
  check(res.budgetSpent === 8000, "budget = 4 scored sandboxes × 2 tasks × 1000 tokens (baseline + 2 candidates + composed)");
}

async function scenarioCompositionConflict(check: Check): Promise<void> {
  console.log("== scenario: conflicting winners — rank-1 file wins, partial candidate composed-out ==");
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(COMPOSES_PASS_MAP, probeCalls), {callModel: (async () => CONFLICT_CANDIDATES_JSON) as CallModel});
  const res = await runLoop({...env.opts, iterations: 1});
  check(res.status === "completed", "run completes with a conflicting merge");
  const entries = readLedger(env.ledgerPath);
  const composed = entries.find((e) => e.kind === "composed") as (typeof entries)[number] & {fileAttribution?: Record<string, number>};
  check(composed !== undefined && composed.decision === "won", "composed candidate won");
  check(JSON.stringify(composed.fileAttribution) === JSON.stringify({"AGENTS.md": 0, "prompts/extra.md": 1}), "conflicting file attributed to rank-1, other file to cand-1");
  const co = entries.find((e) => e.kind === "composed-out") as (typeof entries)[number] & {candidateIdx?: number; filesDropped?: string[]; filesKept?: string[]};
  check(co !== undefined, "composed-out entry ledgered for the partial candidate");
  check(co.candidateIdx === 1 && JSON.stringify(co.filesDropped) === '["AGENTS.md"]' && JSON.stringify(co.filesKept) === '["prompts/extra.md"]', "composed-out records dropped + kept files");
  // The applied (dry-run) AGENTS.md content is the RANK-1 candidate's content
  // (its content is 25 bytes; cand-1's conflicting content is 12 bytes).
  const applyEntry = entries.find((e) => e.kind === "apply-dryrun") as (typeof entries)[number] & {files?: Array<{path: string; bytesAfter?: number | null}>};
  const agents = (applyEntry.files ?? []).find((f) => f.path === "AGENTS.md");
  check(agents?.bytesAfter === 25, "applied AGENTS.md content came from the higher-ranked candidate (25 bytes, not cand-1's 12)");
  check((applyEntry.files ?? []).some((f) => f.path === "prompts/extra.md"), "the losing candidate's non-conflicting file still merged");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates.every((c) => c.decision === "winner-dry-run"), "both contributing winners applied via the composition");
}

async function scenarioCompositionFailedFallback(check: Check): Promise<void> {
  console.log("== scenario: composed candidate fails → fallback to the best single winner ==");
  const probeCalls: string[] = [];
  // The composed whole re-probe FAILS both tasks → composed selection loses.
  const passMap = {...WIN_PASS_MAP, "composed/smoke-a": false, "composed/smoke-b": false};
  const env = makeEnv(makeProbe(passMap, probeCalls), {callModel: (async () => DISJOINT_CANDIDATES_JSON) as CallModel});
  const res = await runLoop({...env.opts, iterations: 1});
  check(res.status === "completed", "run completes via the fallback");
  check(probeCalls.includes("composed/smoke-a"), "composed candidate WAS re-probed before the fallback");
  const entries = readLedger(env.ledgerPath);
  const composed = entries.find((e) => e.kind === "composed");
  check(composed?.decision === "failed" && composed?.win === false, "composed failure ledgered (kind composed, decision failed)");
  const applyEntry = entries.find((e) => e.kind === "apply-dryrun") as (typeof entries)[number] & {files?: Array<{path: string}>};
  check(JSON.stringify((applyEntry.files ?? []).map((f) => f.path)) === JSON.stringify(["AGENTS.md"]), "fallback applied the best SINGLE winner only (cand-0's file)");
  const iter = readState(env.runsDir, res.runId!).iterations[0]!;
  check(iter.candidates[0]!.decision === "winner-dry-run", "best single winner applied (dry-run)");
  check(iter.candidates[1]!.decision === "winner-not-applied", "the other winner was NOT applied after the composed failure");
  check(iter.decision === "dry-run", "iteration decision reflects the single-winner fallback");
}

// ---------------------------------------------------------------------------
// Step 11: role models + recursion modes

/** probe fn that also records the --model option each probe was given. */
function makeRecordingProbe(passMap: Record<string, boolean>, probeCalls: string[], probeModels: string[]): RunProbeFn {
  return async (task, sandboxDir, _wsDir, options) => {
    const side = sandboxDir.endsWith("sandbox-composed") ? "composed" : /sandbox-\d+$/.test(sandboxDir) ? "candidate" : "baseline";
    probeCalls.push(`${side}/${task.name}`);
    probeModels.push(`${side}:${options?.model ?? "<none>"}`);
    return fakeProbeResult(passMap[`${side}/${task.name}`] ?? false, 1000);
  };
}

async function scenarioRoleModels(check: Check): Promise<void> {
  console.log("== scenario: role models — proposer/probe overrides honored, session default for judge ==");
  const probeCalls: string[] = [];
  const probeModels: string[] = [];
  const modelCalls: Array<{system: string; optionsModel: string | undefined}> = [];
  const env = makeEnv(makeRecordingProbe(WIN_PASS_MAP, probeCalls, probeModels), {
    callModel: (async (system: string, _user: string, options?: {model?: string}) => {
      modelCalls.push({system, optionsModel: options?.model});
      return CANDIDATE_JSON;
    }) as CallModel,
  });
  const config = structuredClone(DEFAULT_LOOP_CONFIG);
  config.roles = {proposer: "role/proposer", probe: "role/probe"};
  const res = await runLoop({...env.opts, configOverride: config, iterations: 1});
  check(res.status === "completed", "role-model run completes");
  const state = readState(env.runsDir, res.runId!);
  check(state.roles !== null, "resolved role map persisted in state.json");
  check(state.roles!.proposer === "role/proposer" && state.roles!.probe === "role/probe", "role overrides honored");
  check(state.roles!.judge === "selftest/model", "unset judge role falls back to the session model");
  check(modelCalls.length === 1 && modelCalls[0]!.optionsModel === "role/proposer", "proposer callModel adapter receives the resolved proposer role model");
  check(probeModels.every((m) => m.endsWith(":role/probe")), "every probe (baseline + candidate) runs on the resolved probe role model");
  // Fingerprint consistency: the baseline cache payload is keyed/written under the PROBE model.
  const cacheFiles = readdirSync(join(env.opts.cacheDir!)).filter((f) => f.startsWith("baseline-"));
  check(cacheFiles.length === 1, "one baseline cache payload written");
  const payload = JSON.parse(readFileSync(join(env.opts.cacheDir!, cacheFiles[0]!), "utf8")) as {model: string | null};
  check(payload.model === "role/probe", "fingerprint/baseline cache records the RESOLVED probe model");
  const report = readFileSync(join(env.runsDir, res.runId!, "iter-1", "report.md"), "utf8");
  check(report.includes("proposer: role/proposer, probe: role/probe (other roles: session model)"), "report.md shows the role map when overrides are active");
}

async function scenarioTargetedExplicit(check: Check): Promise<void> {
  console.log("== scenario: explicit --mode targeted — union probing, FOCUS section, post-targeted-confirmation ==");
  // baseline: f1/f2 FAIL, p1/p2 PASS; candidate fixes everything.
  const passMap: Record<string, boolean> = {
    "baseline/f1": false, "baseline/f2": false, "baseline/p1": true, "baseline/p2": true,
    "candidate/f1": true, "candidate/f2": true, "candidate/p1": true, "candidate/p2": true,
  };
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(passMap, probeCalls));
  const config = structuredClone(DEFAULT_LOOP_CONFIG);
  config.targeted = {sampleSize: 1};
  const systems: string[] = [];
  const res = await runLoop({
    ...env.opts,
    configOverride: config,
    tasksFn: () => [fakeTask("f1"), fakeTask("f2"), fakeTask("p1"), fakeTask("p2")],
    iterations: 2,
    mode: "targeted",
    callModel: (async (system: string) => {
      systems.push(system);
      return CANDIDATE_JSON;
    }) as CallModel,
  });
  check(res.status === "completed", "targeted run completes");
  const state = readState(env.runsDir, res.runId!);
  check(state.iterations[0]!.mode === "targeted" && state.iterations[0]!.modeReason === "explicit-flag", "iter1 runs targeted (explicit flag recorded)");
  // Explicit --mode ALWAYS wins over auto behavior — even over the
  // post-targeted-confirmation forcing (iter1 auto-applied in dry-run).
  check(state.iterations[1]!.mode === "targeted" && state.iterations[1]!.modeReason === "explicit-flag", "explicit --mode targeted wins over post-targeted-confirmation in iter2");
  // Union in iter1 (index 1, sampleSize 1): failing {f1,f2} + passing [p1,p2] offset 1 → sample {p2}.
  // Union in iter2 (index 2): offset 0 → sample {p1}.
  check(probeCalls.filter((c) => c === "candidate/p2").length === 1 && !probeCalls.slice(0, 7).includes("candidate/p1"), "iter1 candidate probed ONLY the failing subset + the deterministic regression sample");
  check(probeCalls.filter((c) => c === "candidate/p1").length === 1, "iter2's rotated sample picked p1 (seeded by iteration index)");
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 6, "each targeted candidate probed exactly its 3-task union");
  check(systems[0]!.includes("## FOCUS") && systems[1]!.includes("## FOCUS"), "targeted proposer input contains the FOCUS section");
  check(systems[0]!.includes("### f1 (FAIL)") && systems[0]!.includes("### f2 (FAIL)"), "FOCUS lists the failing tasks verbatim");
  const iter1Report = readFileSync(join(env.runsDir, res.runId!, "iter-1", "report.md"), "utf8");
  check(iter1Report.includes("**mode:** targeted (explicit-flag)"), "report.md shows the per-iteration mode + reason");
  check(state.iterations[0]!.candidates[0]!.win === true, "candidate cleared selection on the union (passDelta vs the paired baseline cut)");
}

async function scenarioTargetedAutoSwitch(check: Check): Promise<void> {
  console.log("== scenario: auto-switch on baseline failures + post-targeted-confirmation cycle ==");
  const passMap: Record<string, boolean> = {
    "baseline/f1": false, "baseline/f2": false, "baseline/p1": true, "baseline/p2": true, "baseline/p3": true, "baseline/p4": true,
    "candidate/f1": true, "candidate/f2": true, "candidate/p1": true, "candidate/p2": true, "candidate/p3": true, "candidate/p4": true,
  };
  const probeCalls: string[] = [];
  const env = makeEnv(makeProbe(passMap, probeCalls));
  const res = await runLoop({
    ...env.opts,
    tasksFn: () => [fakeTask("f1"), fakeTask("f2"), fakeTask("p1"), fakeTask("p2"), fakeTask("p3"), fakeTask("p4")],
    iterations: 3,
  }); // defaults: mode.auto true, sampleSize 6
  check(res.status === "completed", "auto-switch run completes");
  const state = readState(env.runsDir, res.runId!);
  check(state.iterations[0]!.mode === "surface" && state.iterations[0]!.modeReason === "config-default", "iter1 defaults to surface (config-default)");
  check(state.iterations[1]!.mode === "targeted" && state.iterations[1]!.modeReason === "auto-switch", "iter2 auto-switches to targeted (iter1 baseline had failures)");
  check(state.iterations[2]!.mode === "surface" && state.iterations[2]!.modeReason === "post-targeted-confirmation", "iter3 forced back to surface after the targeted auto-apply");
  // sampleSize 6 > 4 passing → ALL passing tasks sampled; union = full suite.
  check(probeCalls.filter((c) => c.startsWith("candidate/")).length === 6 + 6 + 6, "sampleSize ≥ passing count → union covers the whole suite (6 probed per candidate)");

  // With a smaller sampleSize the union is a strict subset (sample probed).
  const probeCalls2: string[] = [];
  const env2 = makeEnv(makeProbe(passMap, probeCalls2));
  const config = structuredClone(DEFAULT_LOOP_CONFIG);
  config.targeted = {sampleSize: 2};
  const res2 = await runLoop({
    ...env2.opts,
    configOverride: config,
    tasksFn: () => [fakeTask("f1"), fakeTask("f2"), fakeTask("p1"), fakeTask("p2"), fakeTask("p3"), fakeTask("p4")],
    iterations: 3,
  });
  const state2 = readState(env2.runsDir, res2.runId!);
  check(state2.iterations[1]!.mode === "targeted", "iter2 targeted with sampleSize 2");
  // iter2 (index 2): passing sorted [p1..p4], k=2, offset 2 → picks {p3, p1}.
  check(probeCalls2.filter((c) => c.startsWith("candidate/")).length === 6 + 4 + 6, "iter1 surface 6 + iter2 union 4 + iter3 surface 6 candidate probes");
  // Baseline probes ran only in iter1 (6), so candidate probes for iter2 are
  // exactly the 4 entries after iter1's 12 probes (6 baseline + 6 candidate):
  // the union (failing subset + 2-task sample) is a STRICT SUBSET of the suite.
  const iter2CandidateProbes = probeCalls2.slice(12, 16);
  check(iter2CandidateProbes.length === 4 && new Set(iter2CandidateProbes).size === 4 && !iter2CandidateProbes.includes("candidate/p2"), "iter2 union is a strict subset: 4 distinct tasks, unsampled p2 absent");
  check(probeCalls2.filter((c) => c === "candidate/p2").length === 2, "unsampled p2 probed only in the two surface iterations (iter1 + iter3)");
  check(state2.iterations[2]!.mode === "surface" && state2.iterations[2]!.modeReason === "post-targeted-confirmation", "iter3 forced back to surface (post-targeted-confirmation) with sampleSize 2");
  // iter3's candidate window: everything after iter2's 4 probes — the FULL
  // suite, unlike iter2's strict-subset union (the distinction this pins).
  const iter3CandidateProbes = probeCalls2.slice(16);
  check(iter3CandidateProbes.length === 6 && new Set(iter3CandidateProbes).size === 6 && ["f1", "f2", "p1", "p2", "p3", "p4"].every((t) => iter3CandidateProbes.includes(`candidate/${t}`)), "iter3 (post-targeted-confirmation) probed ALL 6 tasks — full suite, not the targeted union");
  check(state2.iterations[1]!.candidates[0]!.win === true, "targeted candidate wins on the union");

  // mode.auto=false disables the auto-switch entirely.
  const probeCalls3: string[] = [];
  const env3 = makeEnv(makeProbe(passMap, probeCalls3));
  const configOff = structuredClone(DEFAULT_LOOP_CONFIG);
  configOff.mode = {default: "surface", auto: false};
  const res3 = await runLoop({
    ...env3.opts,
    configOverride: configOff,
    tasksFn: () => [fakeTask("f1"), fakeTask("f2"), fakeTask("p1"), fakeTask("p2"), fakeTask("p3"), fakeTask("p4")],
    iterations: 2,
  });
  const state3 = readState(env3.runsDir, res3.runId!);
  check(state3.iterations[1]!.mode === "surface" && state3.iterations[1]!.modeReason === "config-default", "mode.auto=false keeps every iteration surface");
  check(probeCalls3.filter((c) => c.startsWith("candidate/")).length === 12, "both iterations probed the full suite");
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
    await scenarioCodeGateFailure(check);
    await scenarioCodeLoadError(check);
    await scenarioCodeMinWin(check);
    await scenarioMcpStartupFailure(check);
    await scenarioMcpShapeFailNoStartupProbe(check);
    await scenarioMcpHealthyPathAndMinWin(check);
    await scenarioMcpMixedCandidateGateOrder(check);
    await scenarioCompositionDisjoint(check);
    await scenarioCompositionConflict(check);
    await scenarioCompositionFailedFallback(check);
    await scenarioRoleModels(check);
    await scenarioTargetedExplicit(check);
    await scenarioTargetedAutoSwitch(check);
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
