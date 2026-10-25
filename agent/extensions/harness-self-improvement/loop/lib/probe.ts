#!/usr/bin/env bun
/**
 * Probe runner for the harness self-improvement loop: executes one suite task
 * with a nested `pi` coding agent inside a staged sandbox (see stage.ts) and
 * scores the resulting workspace with the task's check.sh.
 *
 * The runner never throws — provider failures, missing events and spawn errors
 * surface as failed results with a short stderr excerpt. Raw JSONL from the
 * nested run is recorded next to the result for debugging.
 *
 * Usage:
 *   bun run loop/lib/probe.ts <task-name> [--sandbox <dir>]
 */
import {spawn, spawnSync} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {loadTask, parseTaskMd, suiteRoot, type LoadedTask} from "./suite.ts";
import {buildSandbox, captureModelFlag, realPiAgentDir, snapshotReal} from "./stage.ts";

const CHECKER_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_S = 120;

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
  /** Cumulative usage of the LAST message_update event; null when absent. */
  usage: ProbeUsage | null,
  /** Nested pi exit code (null when killed by signal or never exited). */
  exit: number | null,
  checkerResult: CheckerResult,
  /** True when the probe hit the timeout and the process group was killed. */
  timedOut: boolean,
  /** Short stderr excerpt; null when the run produced no stderr. */
  stderrExcerpt: string | null,
  /** Where the raw JSONL was recorded, when a location was provided. */
  rawJsonlPath: string | null,
};

export type RunProbeOptions = {
  /** Probe budget in seconds; defaults to the task frontmatter timeout_s. */
  timeoutS?: number,
  /** Optional `--model` override passed to the nested pi. */
  model?: string,
  /** Where to record the raw JSONL (e.g. <ws>/raw.jsonl). */
  rawJsonlPath?: string,
};

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
 * message_end; usage = the LAST assistant message_update's `message.usage`
 * (falling back to the final message_end when no update carried usage).
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
    const message = ev.message as Record<string, unknown> | undefined;
    if (message === undefined || message.role !== "assistant") continue;
    if (ev.type === "message_end" && Array.isArray(message.content)) {
      for (const item of message.content) {
        if (item && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string" && text.trim() !== "") trajectoryLines.push(text);
        }
      }
    }
    if (ev.type === "message_update" && isProbeUsage(message.usage)) {
      usage = message.usage;
    } else if (ev.type === "message_end" && usage === null && isProbeUsage(message.usage)) {
      usage = message.usage;
    }
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

function runChecker(checkTs: string, wsDir: string): CheckerResult {
  const proc = spawnSync(checkTs, [wsDir], {
    cwd: wsDir,
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
    timedOut: false,
    stderrExcerpt: null,
    rawJsonlPath: null,
    ...partial,
  });
  try {
    // Fresh workspace for every probe.
    rmSync(wsDir, {recursive: true, force: true});
    mkdirSync(wsDir, {recursive: true});
    if (!existsSync(task.paths.taskMd) || !task.meta) {
      return failed({stderrExcerpt: `task '${task.name}' is not loadable (missing/invalid TASK.md)`});
    }
    const prompt = stripFrontmatter(readFileSync(task.paths.taskMd, "utf8"));
    const args = ["--mode", "json", "--no-session"];
    if (options.model !== undefined) args.push("--model", options.model);
    args.push(prompt);

    let raw = "";
    let stderrTail = "";
    let timedOut = false;
    const child = spawn("pi", args, {
      cwd: wsDir,
      env: {...process.env, PI_CODING_AGENT_DIR: sandboxDir},
      // New process group (setsid) so the timeout kill takes the whole tree.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      raw += chunk;
    });
    child.stderr!.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
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

    if (options.rawJsonlPath !== undefined) {
      try {
        writeFileSync(options.rawJsonlPath, raw);
      } catch {
        // Recording is best-effort; never fail the probe for it.
      }
    }
    const parsed = parseJsonlEvents(raw);
    const checkerResult = runChecker(task.paths.checkTs, wsDir);
    return {
      trajectory: parsed.trajectoryLines.join("\n"),
      usage: parsed.usage,
      exit,
      checkerResult,
      timedOut,
      stderrExcerpt: stderrTail.trim() === "" ? null : stderrTail.trim().split("\n").slice(-5).join("\n"),
      rawJsonlPath: options.rawJsonlPath ?? null,
    };
  } catch (err) {
    return failed({stderrExcerpt: err instanceof Error ? err.message : String(err)});
  }
}

// ---------------------------------------------------------------------------
// CLI

function printReport(result: ProbeResult, taskName: string, sandboxDir: string, wsDir: string): void {
  console.log(`== probe report: ${taskName} ==`);
  console.log(`sandbox:  ${sandboxDir}`);
  console.log(`workspace: ${wsDir}`);
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
  if (name === undefined || name.startsWith("-") || (sandboxIdx !== -1 && sandboxArg === undefined)) {
    console.error("usage: bun run loop/lib/probe.ts <task-name> [--sandbox <dir>]");
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
      // Pointed at a directory that is not a staged sandbox: try to build it,
      // but staging failures must surface as a report, not a crash.
      try {
        buildSandbox(snapshotReal(), sandboxDir!);
        console.log(`(re)built sandbox at ${sandboxDir}`);
      } catch (err) {
        console.error(`== probe report: ${task.name} ==`);
        console.error(`sandbox staging FAILED for ${sandboxDir}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        process.exit(1);
      }
    }
    const model = captureModelFlag();
    const wsRoot = mkdtempSync(join(tmpdir(), "harness-probe-"));
    const wsDir = join(wsRoot, "ws");
    const result = await runProbe(task, sandboxDir!, wsDir, {
      model,
      rawJsonlPath: join(wsDir, "raw.jsonl"),
    });
    printReport(result, task.name, sandboxDir!, wsDir);
    // Failure outcomes: checker fail, timeout, or spawn/abnormal exit.
    const ok = result.checkerResult.pass && !result.timedOut && result.exit === 0;
    process.exitCode = ok ? 0 : 1;
    if (externalSandbox === null) {
      console.log(`\n(temporary sandbox kept for inspection: ${sandboxDir})`);
    }
  }
}
