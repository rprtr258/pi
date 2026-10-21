#!/usr/bin/env bun
/**
 * Append-only run history for the harness self-improvement loop.
 *
 * Every scored run (baseline, later candidate/comparison runs) appends one
 * JSON line to run-history.jsonl at the extension-dir root. The file is the
 * loop's long-term memory: readLedger/lastRun answer "what happened in past
 * runs" without re-probing.
 *
 *   bun run loop/lib/ledger.ts   prints the ledger (last 20 entries)
 */
import {appendFileSync, existsSync, readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

/**
 * One run-history.jsonl line. Extra fields (e.g. model, cached) are allowed.
 * scores/usage are optional since Step 5: decision entries (kind "apply",
 * "apply-dryrun") carry the apply outcome, not run scores, and may omit them
 * (buildLedgerDigest never reads them).
 */
export type LedgerEntry = {
  runId: string,
  /** ISO 8601 timestamp of when the entry was appended. */
  ts: string,
  /** Run kind, e.g. "baseline", "baseline-cached", "apply", "apply-dryrun". */
  kind: string,
  fingerprint?: string,
  scores?: {passCount: number, total: number},
  usage?: {totalTokens: number},
  /** Decision recorded for the run by a later step (optional). */
  decision?: string,
  [extra: string]: unknown,
};

/** Extension-dir root (loop/lib/ → loop/ → extension dir). */
export const extensionRoot = fileURLToPath(new URL("../..", import.meta.url));

export const ledgerPath = join(extensionRoot, "run-history.jsonl");

/** `<YYYYMMDD>-<HHMMSS>-<4 random hex>` in local time. */
export function newRunId(now: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

/** Append one entry as a JSON line, creating the ledger if needed. */
export function appendEntry(entry: LedgerEntry, path: string = ledgerPath): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/** Parse the whole ledger; malformed lines are skipped, not fatal. */
export function readLedger(path: string = ledgerPath): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const entries: LedgerEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed !== null && typeof parsed === "object" && typeof (parsed as LedgerEntry).runId === "string") {
        entries.push(parsed as LedgerEntry);
      }
    } catch {
      // Tolerate a torn/partial trailing line from a crashed writer.
    }
  }
  return entries;
}

/** Most recent entry, optionally filtered by kind; null when none. */
export function lastRun(kind?: string, path: string = ledgerPath): LedgerEntry | null {
  const entries = readLedger(path);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (kind === undefined || entries[i]!.kind === kind)
      return entries[i]!;
  }
  return null;
}

// ---------------------------------------------------------------------------

/** Per-task rows for renderReport. */
export type ReportTask = {
  task: string,
  category: string,
  pass: boolean,
  durationMs: number,
  tokens: number,
  /** Checker output, used for failure excerpts. */
  checkerOutput?: string,
};

export type RunReportData = {
  runId: string,
  ts: string,
  kind: string,
  /** Model passed to the nested runs, or null when pi's default was used. */
  model: string | null,
  fingerprint: string | null,
  /** True when the run replayed cached results instead of probing. */
  cached?: boolean,
  /** Resolved pi binary used by the nested runs (see probe.ts resolvePiBinary).
   *  On a cached run this should be the binary recorded in the cached results. */
  piBinary?: {bin: string, version: string | null} | null,
  /** This run's per-task rows (the candidate side when `base` is present). */
  tasks: ReportTask[],
  /** Optional baseline rows to compare against (comparison table mode). */
  base?: ReportTask[],
  aggregate: {passCount: number, total: number, totalTokens: number},
};

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function failureExcerpt(output: string): string[] {
  const lines = output.split("\n").filter((l) => l.trim() !== "");
  return lines.slice(-10); // checker output tail, last ~10 lines
}

/**
 * Render runs/<runId>/report.md. With `base` rows present the table compares
 * base vs candidate per task; otherwise it lists this run's outcomes only.
 */
export function renderReport(data: RunReportData): string {
  const out: string[] = [];
  out.push(`# Run ${data.runId}`);
  out.push("");
  out.push(`- **kind:** ${data.kind}`);
  out.push(`- **ts:** ${data.ts}`);
  out.push(`- **model:** ${data.model ?? "<pi default>"}`);
  out.push(`- **fingerprint:** ${data.fingerprint ?? "<none>"}`);
  if (data.piBinary) {
    const version = data.piBinary.version === null ? "" : ` (${data.piBinary.version})`;
    out.push(`- **pi:** ${data.piBinary.bin}${version}${data.cached ? " [cached run]" : ""}`);
  }
  if (data.cached !== undefined) out.push(`- **cached:** ${data.cached}`);
  out.push("");
  out.push(`**Aggregate:** ${data.aggregate.passCount}/${data.aggregate.total} pass, ${data.aggregate.totalTokens} tokens`);
  out.push("");
  const compare = data.base !== undefined;
  if (compare) {
    out.push("| task | category | base pass | cand pass | duration | tokens |");
    out.push("| --- | --- | --- | --- | --- | --- |");
    const baseByName = new Map(data.base!.map((t) => [t.task, t]));
    for (const t of data.tasks) {
      const base = baseByName.get(t.task);
      out.push(`| ${t.task} | ${t.category} | ${base?.pass ?? "-"} | ${t.pass} | ${fmtDuration(t.durationMs)} | ${t.tokens} |`);
    }
  } else {
    out.push("| task | category | pass | duration | tokens |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const t of data.tasks) {
      out.push(`| ${t.task} | ${t.category} | ${t.pass} | ${fmtDuration(t.durationMs)} | ${t.tokens} |`);
    }
  }
  const failed = data.tasks.filter((t) => !t.pass && (t.checkerOutput ?? "").trim() !== "");
  if (failed.length > 0) {
    out.push("");
    out.push("## Failure excerpts");
    for (const t of failed) {
      out.push("");
      out.push(`### ${t.task}`);
      out.push("```");
      for (const line of failureExcerpt(t.checkerOutput ?? "")) out.push(line);
      out.push("```");
    }
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------

if (import.meta.main) {
  const entries = readLedger();
  if (entries.length === 0) {
    console.log(`(no entries in ${ledgerPath})`);
  } else {
    for (const e of entries.slice(-20)) console.log(JSON.stringify(e));
    console.log(`\n${entries.length} entries in ${ledgerPath}`);
  }
}
