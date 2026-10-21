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
import {DEFAULT_LOOP_CONFIG, type LoopConfig} from "./lib/apply.ts";
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
      return {ok: false, failedPhase: "mcp-list" as const, timedOut: false, error: 'MCP server "broken" failed to connect: spawn /nonexistent/binary ENOENT'};
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
      return {ok: true, failedPhase: null, timedOut: false, error: ""};
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
      return {ok: true, failedPhase: null, timedOut: false, error: ""};
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
      return {ok: true, failedPhase: null, timedOut: false, error: ""};
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
