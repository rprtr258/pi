#!/usr/bin/env bun
/**
 * Probe runner for the harness self-improvement loop: executes one suite task
 * with a nested `pi` coding agent inside a staged sandbox (see stage.ts) and
 * scores the resulting workspace with the task's check.ts.
 *
 * The runner never throws — provider failures, missing events and spawn errors
 * surface as failed results with a short stderr excerpt. Raw JSONL from the
 * nested run is recorded next to the result for debugging.
 *
 * Usage:
 *   bun run loop/lib/probe.ts <task-name> [--sandbox <dir>] [--keep-sandbox]
 */
import {spawn, spawnSync} from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadTask, parseTaskMd, suiteRoot, type LoadedTask} from "./suite.ts";
import {buildSandbox, captureModelFlag, realPiAgentDir, snapshotReal} from "./stage.ts";

const CHECKER_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_S = 120;
/**
 * Capture cap for the nested-pi stderr tail, persisted verbatim (redacted) as
 * ProbeResult.stderrExcerpt. Gate 4's load-error scan (gates.ts
 * scanProbeLoadErrors) reads this field from tasks/<task>.json: the earlier
 * 5-line/2000-char excerpt could truncate the window ABOVE where nested pi
 * prints an extension load error, so the whole 8KB tail is kept and scanned.
 * The raw JSONL file already carries everything; this excerpt cap was the
 * bottleneck for stderr-only failure shapes.
 */
const STDERR_TAIL_CAP = 8 * 1024;

export type ProbeUsage = {
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  totalTokens: number,
  cost: {input: number, output: number, cacheRead: number, cacheWrite: number, total: number},
};

export type CheckerResult = {
  pass: boolean,
  output: string,
};

export type ProbeResult = {
  /** Concatenated assistant message text from the nested pi run. */
  trajectory: string,
  /** Cumulative usage of the LAST assistant usage seen (message_update or message_end); null when absent. */
  usage: ProbeUsage | null,
  /** Nested pi exit code (null when killed by signal or never exited). */
  exit: number | null,
  checkerResult: CheckerResult,
  /** Resolved pi binary and its `pi --version` output (null when the run never got to spawn). */
  piBinary: {bin: string, version: string | null} | null,
  /** True when the probe hit the timeout and the process group was killed. */
  timedOut: boolean,
  /** Redacted stderr tail (up to 8KB — see STDERR_TAIL_CAP); null when the run produced no stderr. */
  stderrExcerpt: string | null,
  /** Where the raw JSONL was recorded, when a location was provided. */
  rawJsonlPath: string | null,
};

export type RunProbeOptions = {
  /** Probe budget in seconds; defaults to the task frontmatter timeout_s. */
  timeoutS?: number,
  /** Optional `--model` override passed to the nested pi. */
  model?: string,
  /** Where to record the raw JSONL, streamed as chunks arrive. Must live
   *  OUTSIDE the checked workspace (e.g. a sibling of wsDir) so checkers
   *  never see it. */
  rawJsonlPath?: string,
  /** Optional workspace staging hook (replay channel): invoked AFTER the
   *  fresh workspace is created and BEFORE the nested pi run spawns, so a
   *  task can start from a materialized starting state instead of an empty
   *  workspace. A throwing callback fails the probe with the error as the
   *  stderr excerpt (never a partially staged silent run). */
  stageWorkspace?: (wsDir: string) => void,
  /**
   * Per-probe temp directory (Step 10 parallel probing): when set, TMPDIR,
   * TMP and TEMP in the nested pi's env AND the checker's env point here, so
   * probes running concurrently against the same sandbox cannot collide in
   * the shared /tmp (a checker that violates the S1 workspace-only contract
   * with a fixed temp path would otherwise race at concurrency ≥ 2). The
   * caller (score.ts) creates a unique dir per probe and cleans it up.
   */
  tmpDir?: string,
};

/**
 * Resolve the pi binary nested probes run against.
 *
 * `bun run` prepends <package>/node_modules/.bin to PATH, and installed
 * extensions pin an OLD pi there (e.g. 0.80.3, which predates `--` support) —
 * spawning bare "pi" from this extension would silently run that stale
 * binary. So PATH entries ending in node_modules/.bin are dropped, leaving
 * the globally installed pi the interactive agent uses. PI_BIN overrides the
 * lookup entirely; if it is set but not an existing executable file, this
 * throws (fail fast — never silently fall back).
 */
export function resolvePiBinary(): {bin: string, version: string | null} {
  const override = process.env.PI_BIN;
  if (override !== undefined && override !== "") {
    if (!existsSync(override) || !statSync(override).isFile() || !(statSync(override).mode & 0o111)) {
      throw new Error(`PI_BIN '${override}' is not an existing executable file — fix PI_BIN or unset it`);
    }
    return {bin: override, version: piVersion(override)};
  }
  return {bin: "pi", version: piVersion("pi")};
}

function piVersion(bin: string): string | null {
  try {
    // Same env the probe spawn uses, so the version always describes the
    // binary the nested run will actually execute.
    const proc = spawnSync(bin, ["--version"], {encoding: "utf8", timeout: 10_000, env: nestedPiEnv()});
    const version = proc.status === 0 ? (proc.stdout ?? "").trim() : null;
    return version === "" ? null : version;
  } catch {
    return null;
  }
}

/**
 * Spawn env for nested pi: caller env minus node_modules/.bin PATH entries,
 * plus PI_OFFLINE=1 and HARNESS_LOOP_SAMPLE=1.
 *
 * PI_OFFLINE=1 (S8): write-protection for the shared real npm store that the
 * sandbox reads through the <sandbox>/npm/node_modules symlink (see stage.ts).
 * Without it, pi network-installs packages missing from <sandbox>/npm and
 * update-checks the symlinked ones. PI_OFFLINE only disables background
 * network activity (package installs/update checks) — NOT model calls — so
 * probes still run their normal model traffic. Callers may override it via
 * `extra` (spread last).
 *
 * HARNESS_LOOP_SAMPLE=1 (Step 9a): sandbox probes run with the env-gated
 * sample extension's flag set, so a staged candidate extension that registers
 * tools only under the flag (the harness-loop-sample pattern) is loadable and
 * exercisable in probe sandboxes while staying INERT in every normal session
 * (the flag is never set outside sandbox probes). The variable is inert
 * unless an extension chooses to read it.
 */
export function nestedPiEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = process.env.PI_BIN !== undefined && process.env.PI_BIN !== "" ? {...process.env} : {...process.env, PATH: filteredPath()};
  return {...base, PI_OFFLINE: "1", HARNESS_LOOP_SAMPLE: "1", ...extra};
}

function filteredPath(): string {
  return (process.env.PATH ?? "")
    .split(":")
    .filter((entry) => entry !== "" && !entry.endsWith("node_modules/.bin"))
    .join(":");
}

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, "sk-***"],
  [/Bearer [A-Za-z0-9._-]+/gi, "Bearer ***"],
  [/(api[_-]?key["\s:=]+)[A-Za-z0-9._-]+/gi, "$1***"],
];

/** Redact credential-like patterns (API keys, bearer tokens) from text before
 *  it is stored or printed. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTION_PATTERNS)
    out = out.replace(pattern, replacement);
  return out;
}

/** In-memory raw-JSONL caps: keep the first 2MB and the last 8MB for parsing. */
const RAW_HEAD_LIMIT = 2 * 1024 * 1024;
const RAW_TAIL_LIMIT = 8 * 1024 * 1024;

/** Strip YAML frontmatter from a TASK.md, returning the exact prompt body. */
export function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return lines.slice(i + 1).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  }
  return text;
}

type ParsedJsonl = {
  trajectoryLines: string[],
  usage: ProbeUsage | null,
};

function isProbeUsage(value: unknown): value is ProbeUsage {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.totalTokens === "number" && v.cost !== null && typeof v.cost === "object";
}

/**
 * Parse the nested pi JSONL event stream. Events are pi session events; the
 * shapes we rely on (verified empirically against a real run):
 *  - {"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":...}, ...],"usage":{...,"totalTokens":...,"cost":{"total":...}}}, ...}
 *  - {"type":"message_end","message":{...same assistant message shape...}}
 * message_update fires repeatedly per message with CUMULATIVE content, so the
 * trajectory takes each assistant message's text exactly once from its
 * message_end; usage = the LAST assistant usage seen regardless of event type
 * (a later message_end overwrites an earlier message_update, and in
 * fallback-only streams the LAST message_end wins).
 */
export function parseJsonlEvents(raw: string): ParsedJsonl {
  const trajectoryLines: string[] = [];
  let usage: ProbeUsage | null = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // tolerate stray non-JSON output on stdout
    }
    if (event === null || typeof event !== "object") continue;
    const ev = event as Record<string, unknown>;
    if (ev.type !== "message_update" && ev.type !== "message_end") continue;
    const message = ev.message;
    if (message === null || typeof message !== "object") continue;
    const msg = message as Record<string, unknown>;
    if (msg.role !== "assistant") continue;
    if (ev.type === "message_end" && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string" && text.trim() !== "")
            trajectoryLines.push(text);
        }
      }
    }
    // Last assistant usage wins, whatever event carried it.
    if (isProbeUsage(msg.usage))
      usage = msg.usage;
  }
  return {trajectoryLines, usage};
}

/**
 * Kill a process group started with detached: true. Negative pid signals the
 * whole group, so tool subprocesses (grandchildren) die with the probe.
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGKILL"): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal); // fallback if the group is already gone
      return true;
    } catch {
      return false;
    }
  }
}

function runChecker(checkTs: string, wsDir: string, env?: NodeJS.ProcessEnv): CheckerResult {
  const proc = spawnSync(checkTs, [wsDir], {
    cwd: wsDir,
    env,
    timeout: CHECKER_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${proc.stdout ?? ""}${proc.stderr ?? ""}`.trim();
  // spawnSync signals timeout via the killed child (status null + signal).
  const timedOut = proc.status === null && proc.signal !== null;
  return {pass: !timedOut && proc.status === 0, output};
}

/** Run one task probe. Resolves with a result for every outcome; never throws. */
export async function runProbe(task: LoadedTask, sandboxDir: string, wsDir: string, options: RunProbeOptions = {}): Promise<ProbeResult> {
  const timeoutS = options.timeoutS ?? task.meta?.timeoutS ?? DEFAULT_PROBE_TIMEOUT_S;
  const failed = (partial: Partial<ProbeResult>): ProbeResult => ({
    trajectory: "",
    usage: null,
    exit: null,
    checkerResult: {pass: false, output: ""},
    piBinary: null,
    timedOut: false,
    stderrExcerpt: null,
    rawJsonlPath: null,
    ...partial,
  });
  try {
    if (!existsSync(task.paths.taskMd) || !task.meta) {
      return failed({stderrExcerpt: `task '${task.name}' is not loadable (missing/invalid TASK.md)`});
    }
    // Fresh workspace for every probe — only created after the task validated.
    rmSync(wsDir, {recursive: true, force: true});
    mkdirSync(wsDir, {recursive: true});
    // Optional starting-state staging (replay channel) — before the prompt is
    // read and the pi process spawns; failures fail the probe explicitly.
    if (options.stageWorkspace !== undefined) {
      try {
        options.stageWorkspace(wsDir);
      } catch (err) {
        return failed({stderrExcerpt: `workspace staging failed: ${err instanceof Error ? err.message : String(err)}`});
      }
    }
    const prompt = stripFrontmatter(readFileSync(task.paths.taskMd, "utf8"));
    const args = ["--mode", "json", "--no-session"];
    if (options.model !== undefined) args.push("--model", options.model);
    // `--` ends option parsing so a prompt starting with "-" is not read as a flag.
    args.push("--", prompt);

    // Raw JSONL is stream-written to rawJsonlPath as chunks arrive; the
    // in-memory copy for parsing is capped at first 2MB + last 8MB.
    let rawFd: number | null = null;
    if (options.rawJsonlPath !== undefined) {
      try {
        rmSync(options.rawJsonlPath, {force: true});
        rawFd = openSync(options.rawJsonlPath, "w");
      } catch {
        rawFd = null; // Recording is best-effort; never fail the probe for it.
      }
    }
    let rawHead = "";
    let rawTail = "";
    let truncatedBytes = 0;
    const storeChunk = (chunk: string): void => {
      if (rawFd !== null) {
        try {
          writeSync(rawFd, chunk);
        } catch {
          // Recording is best-effort; never fail the probe for it.
        }
      }
      if (rawHead.length < RAW_HEAD_LIMIT) rawHead += chunk.slice(0, RAW_HEAD_LIMIT - rawHead.length);
      rawTail += chunk;
      const overflow = rawTail.length - RAW_TAIL_LIMIT;
      if (overflow > 0) {
        truncatedBytes += overflow;
        rawTail = rawTail.slice(overflow);
      }
    };

    // Step 10: per-probe TMPDIR isolation (see RunProbeOptions.tmpDir) — the
    // nested pi AND the checker both see the isolated temp dir, so concurrent
    // probes never share temp paths.
    const tmpEnv: Record<string, string> | null = options.tmpDir !== undefined ? {TMPDIR: options.tmpDir, TMP: options.tmpDir, TEMP: options.tmpDir} : null;
    let stderrTail = "";
    let timedOut = false;
    // Resolved after task validation: a bad PI_BIN fails the probe with a
    // clear excerpt (via the catch below), never a spawn mystery.
    const piBinary = resolvePiBinary();
    const child = spawn(piBinary.bin, args, {
      cwd: wsDir,
      env: nestedPiEnv({PI_CODING_AGENT_DIR: sandboxDir, ...(tmpEnv ?? {})}),
      // New process group (setsid) so the timeout kill takes the whole tree.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      storeChunk(chunk);
    });
    child.stderr!.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CAP);
    });

    const exit = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) killProcessGroup(child.pid, "SIGKILL");
      }, timeoutS * 1000);
      child.on("error", (err) => {
        stderrTail = (stderrTail + `\nspawn error: ${err.message}`).trim();
        clearTimeout(timer);
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    if (rawFd !== null) {
      try {
        closeSync(rawFd);
      } catch {
        // best-effort
      }
      rawFd = null;
    }
    const parseInput =
      truncatedBytes > 0
        ? `${rawHead}\n==[raw JSONL truncated: ${truncatedBytes} middle bytes not retained in memory]==\n${rawTail}`
        : rawHead + rawTail;
    const parsed = parseJsonlEvents(parseInput);
    const checkerResult = runChecker(task.paths.checkTs, wsDir, options.tmpDir === undefined ? undefined : {...process.env, TMPDIR: options.tmpDir, TMP: options.tmpDir, TEMP: options.tmpDir});
    return {
      trajectory: parsed.trajectoryLines.join("\n"),
      usage: parsed.usage,
      exit,
      checkerResult,
      piBinary,
      timedOut,
      stderrExcerpt: stderrTail.trim() === "" ? null : redact(stderrTail.trim()),
      rawJsonlPath: options.rawJsonlPath ?? null,
    };
  } catch (err) {
    return failed({stderrExcerpt: redact(err instanceof Error ? err.message : String(err))});
  }
}

// ---------------------------------------------------------------------------
// CLI

function printReport(result: ProbeResult, taskName: string, sandboxDir: string, wsDir: string): void {
  console.log(`== probe report: ${taskName} ==`);
  console.log(`sandbox:  ${sandboxDir}`);
  console.log(`workspace: ${wsDir}`);
  console.log(`pi:       ${result.piBinary === null ? "<never spawned>" : `${result.piBinary.bin}${result.piBinary.version === null ? "" : ` (${result.piBinary.version})`}`}`);
  console.log(`exit code: ${result.exit}${result.timedOut ? " (TIMED OUT, process group killed)" : ""}`);
  console.log(`checker:  ${result.checkerResult.pass ? "PASS" : "FAIL"}`);
  if (result.checkerResult.output) {
    for (const line of result.checkerResult.output.split("\n").slice(-15)) console.log(`  | ${line}`);
  }
  console.log(`usage:    ${result.usage === null ? "none" : JSON.stringify(result.usage)}`);
  if (result.stderrExcerpt) {
    console.log(`stderr (last lines):`);
    for (const line of result.stderrExcerpt.split("\n")) console.log(`  ! ${line}`);
  }
  console.log(`raw JSONL: ${result.rawJsonlPath ?? "<not recorded>"}`);
  console.log(`--- trajectory tail (last 30 assistant lines) ---`);
  const lines = result.trajectory.split("\n").filter((l) => l.trim() !== "");
  for (const line of lines.slice(-30)) console.log(`  > ${line}`);
  if (lines.length === 0) console.log("  <no assistant output>");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const name = argv[0];
  const sandboxIdx = argv.indexOf("--sandbox");
  const sandboxArg = sandboxIdx !== -1 ? argv[sandboxIdx + 1] : undefined;
  const keepSandbox = argv.includes("--keep-sandbox");
  if (name === undefined || name.startsWith("-") || (sandboxIdx !== -1 && sandboxArg === undefined)) {
    console.error("usage: bun run loop/lib/probe.ts <task-name> [--sandbox <dir>] [--keep-sandbox]");
    process.exitCode = 2;
  } else {
    const task = loadTask(suiteRoot(), name!);
    // Sandbox resolution order: --sandbox, then an externally staged
    // PI_CODING_AGENT_DIR (used as-is, no rebuild), else a fresh temp sandbox.
    const externalSandbox = sandboxArg ?? process.env.PI_CODING_AGENT_DIR ?? null;
    const sandboxDir = externalSandbox ?? mkdtempSync(join(tmpdir(), "harness-sandbox-"));
    if (externalSandbox === null) {
      const snapshot = snapshotReal();
      buildSandbox(snapshot, sandboxDir);
    } else if (!existsSync(join(sandboxDir!, "settings.json"))) {
      // Externally staged sandboxes are used AS-IS: buildSandbox wipes its
      // target, so it may only ever run against a directory this tool created
      // itself — never a caller-supplied path. A missing settings.json is a
      // staging failure: report it and leave the external directory untouched.
      console.error(`== probe report: ${task.name} ==`);
      console.error(`sandbox staging FAILED for ${sandboxDir}: settings.json missing — external sandboxes are used as-is and are never rebuilt`);
      process.exit(1);
    }
    const model = captureModelFlag();
    const wsRoot = mkdtempSync(join(tmpdir(), "harness-probe-"));
    const wsDir = join(wsRoot, "ws");
    const result = await runProbe(task, sandboxDir!, wsDir, {
      model,
      // Sibling of the workspace, not inside it: checkers must never see raw.jsonl.
      rawJsonlPath: join(wsRoot, "raw.jsonl"),
    });
    printReport(result, task.name, sandboxDir!, wsDir);
    // Failure outcomes: checker fail, timeout, or spawn/abnormal exit.
    const ok = result.checkerResult.pass && !result.timedOut && result.exit === 0;
    process.exitCode = ok ? 0 : 1;
    if (externalSandbox === null) {
      if (keepSandbox) {
        console.log(`\n(temporary sandbox kept for inspection: ${sandboxDir})`);
      } else {
        rmSync(sandboxDir!, {recursive: true, force: true});
        console.log(`\n(temporary sandbox deleted: ${sandboxDir}; pass --keep-sandbox to keep it)`);
      }
    }
  }
}
