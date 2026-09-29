#!/usr/bin/env bun
/**
 * Harness cycle stats from pi session logs.
 * Reports: tool call/error counts + categories, token/cost totals, durations,
 * response times, interruptions, git activity, files/lines changed, languages,
 * time-of-day, concurrent-session events, slash-command and skill usage,
 * correction-signal user messages. Used by the /harness analyze phase.
 *
 * Usage:
 *   bun stats.ts                 text summary (default)
 *   bun stats.ts --sessions      one compact line per session (facet work list)
 *   bun stats.ts --json          machine-readable aggregate
 *   bun stats.ts --html [path]   write an HTML report (default harness-report.html)
 *   bun stats.ts --facets f.json merge LLM session facets (default harness-facets.json)
 *   bun stats.ts --limit N       sessions to scan (default 500)
 *   bun stats.ts --selftest      run built-in asserts
 * Layout mirrors Claude Code's insights.ts (metrics + facets + HTML report).
 */
import {readdirSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {join, basename} from "node:path";

const ARGS = process.argv.slice(2);
const hasFlag = (name: string) => ARGS.includes(name);
const flagValue = (name: string): string | undefined => {
  const i = ARGS.indexOf(name);
  const v = i >= 0 ? ARGS[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
};

const home = process.env.HOME ?? "";
const dir = join(home, ".pi/agent/sessions");
const limit = Number(flagValue("--limit") ?? 500) || 500;

// ---- session model ----
type SessionStats = {
  file: string; id: string; cwd: string; start: number; end: number;
  models: Set<string>; userMessages: number; assistantMessages: number;
  toolCalls: number; toolErrors: number;
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number;
  interruptions: number; responseTimes: number[];
  gitCommits: number; gitPushes: number;
  files: Set<string>; linesAdded: number; linesRemoved: number;
  languages: Record<string, number>; messageHours: number[]; userTimestamps: number[];
  corrections: number; firstPrompt: string; lastAssistant: number;
};

const sessionStats: SessionStats[] = [];
const errorCategories = new Map<string, number>();

const newSession = (file: string): SessionStats => ({
  file, id: basename(file, ".jsonl").split("_").pop() ?? "", cwd: "", start: 0, end: 0,
  models: new Set(), userMessages: 0, assistantMessages: 0, toolCalls: 0, toolErrors: 0,
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0,
  interruptions: 0, responseTimes: [], gitCommits: 0, gitPushes: 0,
  files: new Set(), linesAdded: 0, linesRemoved: 0, languages: {}, messageHours: [],
  userTimestamps: [], corrections: 0, firstPrompt: "", lastAssistant: 0,
});

const lineCount = (s: unknown): number => (typeof s === "string" && s ? s.split("\n").length : 0);

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
  py: "Python", rs: "Rust", go: "Go", java: "Java", c: "C", h: "C",
  cpp: "C++", cc: "C++", hpp: "C++", rb: "Ruby", sh: "Shell", bash: "Shell",
  md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", html: "HTML",
  css: "CSS", sql: "SQL", toml: "TOML", kt: "Kotlin", swift: "Swift", php: "PHP",
};
const langFor = (path: string): string | null => {
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? (EXT_TO_LANGUAGE[m[1]!.toLowerCase()] ?? null) : null;
};

// Adapted from insights.ts categorizeToolError; patterns match pi tool error text.
const ERROR_CATEGORIES: Array<[RegExp, string]> = [
  [/move on to other tasks|doesn'?t want to|user (rejected|declined)/i, "User Rejected"],
  [/oldText[^]*?(not found|did not match)|string to replace not found|no changes|file has not been read/i, "Edit Failed"],
  [/not unique|multiple (occurrences|matches)/i, "Edit Ambiguous"],
  [/modified since|has changed since (the|last) read/i, "File Changed"],
  [/too large|exceeds (the )?maximum|size limit/i, "File Too Large"],
  [/file not found|does not exist|no such file|ENOENT/i, "File Not Found"],
  [/EACCES|permission denied|operation not permitted/i, "Permission Denied"],
  [/timed? ?out|timeout/i, "Timeout"],
  [/validation|invalid|schema/i, "Validation Error"],
  [/exit code|command failed|non-zero/i, "Command Failed"],
];
const categorizeError = (text: string): string => {
  for (const [re, cat] of ERROR_CATEGORIES) if (re.test(text)) return cat;
  return "Other";
};

const userText = (m: any): string =>
  (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");

// insights.ts multi-session ("multi-clauding") detector: two or more sessions
// with user messages interleaved inside a sliding 30-minute window.
// ponytail: events = distinct interleaved session pairs, not distinct overlap episodes;
// enough to flag concurrent-session work. Upgrade if episode counts ever matter.
function detectConcurrency(all: SessionStats[], windowMs = 30 * 60 * 1000): {events: number; sessionsInvolved: number; messagesDuring: number} {
  const stamps = all.flatMap((s) => s.userTimestamps.map((t) => ({t, id: s.id}))).sort((a, b) => a.t - b.t);
  const pairs = new Set<string>();
  const involved = new Set<string>();
  let messagesDuring = 0;
  let lo = 0;
  for (let hi = 0; hi < stamps.length; hi++) {
    while (stamps[hi]!.t - stamps[lo]!.t > windowMs) lo++;
    const ids = new Set<string>();
    for (let k = lo; k <= hi; k++) ids.add(stamps[k]!.id);
    if (ids.size < 2) continue;
    messagesDuring++;
    const arr = [...ids].sort();
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) { pairs.add(`${arr[i]}+${arr[j]}`); involved.add(arr[i]!); involved.add(arr[j]!); }
  }
  return {events: pairs.size, sessionsInvolved: involved.size, messagesDuring};
}

// ---- facets (LLM classification, produced by analyze subagents) ----
type Facet = {sessionId?: string; type?: string; outcome?: string; satisfaction?: string; goal?: string; friction?: Array<{type?: string; detail?: string}>};
function loadFacets(path: string): Facet[] {
  try {
    const j: any = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(j) ? j : Array.isArray(j?.sessions) ? j.sessions : [];
  } catch {
    return [];
  }
}
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const countBy = <T>(items: T[], pick: (item: T) => string | undefined): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const it of items) { const k = pick(it); if (k) m[k] = (m[k] ?? 0) + 1; }
  return m;
};
function aggregateFacets(facets: Facet[]) {
  const friction: Record<string, number> = {};
  for (const f of facets) for (const fr of f.friction ?? []) if (fr?.type) friction[fr.type] = (friction[fr.type] ?? 0) + 1;
  return {
    total: facets.length,
    type: countBy(facets, (f) => f.type),
    outcome: countBy(facets, (f) => f.outcome),
    satisfaction: countBy(facets, (f) => f.satisfaction),
    friction,
  };
}

// ---- formatting ----
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + "%" : "0.0%");
const fmtCost = (c: number) => "$" + (c > 0 && c < 0.01 ? c.toFixed(4) : c.toFixed(2));
const fmtTok = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const fmtDur = (s: number) => (s >= 3600 ? (s / 3600).toFixed(1) + "h" : s >= 60 ? Math.round(s / 60) + "m" : Math.round(s) + "s");
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");
const fmtCounts = (r: Record<string, number>, top = 6) =>
  Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${titleCase(k)} ${v}`).join(", ");
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function skillRows() {
  const names = new Set([...skills.keys(), ...knownSkills]);
  return [...names]
    .map((name) => ({name, agent: skills.get(name) ?? 0, manual: skillsManual.get(name) ?? 0}))
    .filter((s) => s.agent + s.manual > 0)
    .sort((a, b) => b.agent + b.manual - (a.agent + a.manual));
}

function buildAggregate() {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, reasoning = 0, cost = 0;
  let gitCommits = 0, gitPushes = 0, filesEdited = 0, linesAdded = 0, linesRemoved = 0, interruptions = 0;
  const languages: Record<string, number> = {};
  const messageHours: number[] = [];
  const responseTimes: number[] = [];
  const models: Record<string, number> = {};
  for (const s of sessionStats) {
    input += s.input; output += s.output; cacheRead += s.cacheRead; cacheWrite += s.cacheWrite;
    reasoning += s.reasoning; cost += s.cost; gitCommits += s.gitCommits; gitPushes += s.gitPushes;
    filesEdited += s.files.size; linesAdded += s.linesAdded; linesRemoved += s.linesRemoved;
    interruptions += s.interruptions; responseTimes.push(...s.responseTimes); messageHours.push(...s.messageHours);
    for (const [k, v] of Object.entries(s.languages)) languages[k] = (languages[k] ?? 0) + v;
    for (const m of s.models) models[m] = (models[m] ?? 0) + 1;
  }
  const starts = sessionStats.filter((s) => s.start).map((s) => s.start);
  const ends = sessionStats.filter((s) => s.end).map((s) => s.end);
  const facetsPath = flagValue("--facets") ?? join(import.meta.dir, "harness-facets.json");
  return {
    sessions, userMessages, parseErrors, correctionHits,
    assistantMessages: sessionStats.reduce((a, s) => a + s.assistantMessages, 0),
    toolCalls: [...tools.values()].reduce((a, t) => a + t.calls, 0),
    toolErrors: [...tools.values()].reduce((a, t) => a + t.errors, 0),
    tokens: {input, output, cacheRead, cacheWrite, reasoning, total: input + output + cacheRead + cacheWrite},
    cost, models, gitCommits, gitPushes, filesEdited, linesAdded, linesRemoved, interruptions,
    languages, messageHours, responseTimes,
    concurrency: detectConcurrency(sessionStats),
    start: starts.length ? Math.min(...starts) : 0,
    end: ends.length ? Math.max(...ends) : 0,
    tools: [...tools].map(([name, t]) => ({name, calls: t.calls, errors: t.errors})).sort((a, b) => b.calls - a.calls),
    errorCategories: [...errorCategories].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count),
    slashCommands: [...slashCommands].map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count),
    skills: skillRows(),
    corrections: correctionExamples,
    sessionList: sessionStats
      .map((s) => ({id: s.id, cwd: s.cwd, start: s.start, durationMin: Math.round((s.end - s.start) / 60000), userMessages: s.userMessages, tokens: s.input + s.output, cost: s.cost, toolErrors: s.toolErrors, models: [...s.models], firstPrompt: s.firstPrompt, file: s.file}))
      .sort((a, b) => b.start - a.start),
    facets: aggregateFacets(loadFacets(facetsPath)),
    facetsPath,
  };
}

function renderText(): string {
  const a = buildAggregate();
  const L: string[] = [];
  L.push(`Sessions scanned: ${a.sessions} (latest ${limit}), unparseable lines: ${a.parseErrors}`);
  if (a.start) L.push(`Date range: ${day(a.start)} .. ${day(a.end)}`);
  L.push(`User messages: ${a.userMessages}, assistant messages: ${a.assistantMessages}, correction-signal hits: ${a.correctionHits}, interruptions: ${a.interruptions}`);
  L.push(`Tokens: in ${fmtTok(a.tokens.input)} / out ${fmtTok(a.tokens.output)} / cache-read ${fmtTok(a.tokens.cacheRead)} / cache-write ${fmtTok(a.tokens.cacheWrite)} / reasoning ${fmtTok(a.tokens.reasoning)} · cost ${fmtCost(a.cost)}`);
  L.push(`Models: ${fmtCounts(a.models) || "(none)"}`);
  L.push(`Activity: git commits ${a.gitCommits}, pushes ${a.gitPushes}, files edited ${a.filesEdited}, lines +${a.linesAdded}/-${a.linesRemoved}`);
  const rt = [...a.responseTimes].sort((x, y) => x - y);
  if (rt.length) L.push(`Response time p50/p90: ${fmtDur(rt[Math.floor(rt.length * 0.5)]!)} / ${fmtDur(rt[Math.floor(rt.length * 0.9)]!)} (n=${rt.length})`);
  const c = a.concurrency;
  L.push(`Concurrent sessions: ${c.events} overlapping pairs, ${c.sessionsInvolved} sessions, ${c.messagesDuring} interleaved messages`);
  for (const ex of a.corrections) L.push(`  [correction] ${ex}`);

  L.push(`\nTool usage (calls / errors / error rate):`);
  for (const t of a.tools) L.push(`  ${t.name.padEnd(24)} ${String(t.calls).padStart(6)} / ${String(t.errors).padStart(5)} / ${pct(t.errors, t.calls)}`);

  L.push(`\nTool error categories:`);
  if (!a.errorCategories.length) L.push("  (none)");
  for (const e of a.errorCategories) L.push(`  ${e.name.padEnd(24)} ${String(e.count).padStart(5)}`);

  L.push(`\nSlash-command usage (extension commands / unexpanded):`);
  if (!a.slashCommands.length) L.push("  (none)");
  for (const s of a.slashCommands) L.push(`  /${s.name.padEnd(22)} ${s.count}`);

  L.push(`\nSkill usage (manual / agent / total):`);
  if (!a.skills.length) L.push("  (none)");
  for (const s of a.skills) L.push(`  ${s.name.padEnd(26)} ${s.manual} / ${s.agent} / ${s.manual + s.agent}`);

  const tod: Record<string, number> = {Morning: 0, Afternoon: 0, Evening: 0, Night: 0};
  for (const h of a.messageHours) { if (h < 6) tod.Night!++; else if (h < 12) tod.Morning!++; else if (h < 18) tod.Afternoon!++; else tod.Evening!++; }
  L.push(`\nTime of day (user messages): ${fmtCounts(tod, 4)}`);
  L.push(`Languages touched: ${fmtCounts(a.languages, 8) || "(none)"}`);

  if (a.facets.total) {
    L.push(`\nSession facets (${a.facets.total} classified, ${basename(a.facetsPath)}):`);
    L.push(`  type: ${fmtCounts(a.facets.type, 6) || "(none)"}`);
    L.push(`  outcome: ${fmtCounts(a.facets.outcome, 6) || "(none)"}`);
    L.push(`  satisfaction: ${fmtCounts(a.facets.satisfaction, 6) || "(none)"}`);
    L.push(`  friction: ${fmtCounts(a.facets.friction, 8) || "(none)"}`);
  } else {
    L.push(`\nSession facets: none (write ${basename(a.facetsPath)} during analyze to enrich this report)`);
  }
  return L.join("\n");
}

function renderSessions(): string {
  const a = buildAggregate();
  return a.sessionList
    .map((s) => `${day(s.start)}  ${String(s.durationMin).padStart(4)}m  ${fmtTok(s.tokens).padStart(6)}  ${fmtCost(s.cost).padStart(8)}  err:${String(s.toolErrors).padStart(3)}  ${(s.cwd || "?").slice(0, 40).padEnd(40)}  ${s.file}`)
    .join("\n");
}

function bar(data: Record<string, number>, maxItems = 10, color = "#6366f1"): string {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, maxItems);
  if (!entries.length) return `<p class="empty">No data</p>`;
  const max = Math.max(...entries.map((e) => e[1]));
  return entries
    .map(([k, v]) => `<div class="bar"><span class="bl">${esc(titleCase(k))}</span><span class="bt"><i style="width:${(v / max) * 100}%;background:${color}"></i></span><span class="bv">${v}</span></div>`)
    .join("");
}

function htmlTable(headers: string[], rows: Array<Array<string | number>>): string {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function renderHtml(): string {
  const a = buildAggregate();
  const tod: Record<string, number> = {Morning: 0, Afternoon: 0, Evening: 0, Night: 0};
  for (const h of a.messageHours) { if (h < 6) tod.Night!++; else if (h < 12) tod.Morning!++; else if (h < 18) tod.Afternoon!++; else tod.Evening!++; }
  const facetSection = a.facets.total
    ? `<h2>Session facets <span class="muted">(${a.facets.total} classified)</span></h2>
       <div class="grid2">
         <div class="card"><h3>Session type</h3>${bar(a.facets.type, 8, "#0ea5e9")}</div>
         <div class="card"><h3>Outcome</h3>${bar(a.facets.outcome, 6, "#22c55e")}</div>
         <div class="card"><h3>User satisfaction</h3>${bar(a.facets.satisfaction, 6, "#eab308")}</div>
         <div class="card"><h3>Friction</h3>${bar(a.facets.friction, 8, "#ef4444")}</div>
       </div>`
    : "";
  const sessionRows = a.sessionList.slice(0, 60).map((s) => [day(s.start), `${s.durationMin}m`, fmtTok(s.tokens), fmtCost(s.cost), s.toolErrors, s.userMessages, s.models.join(", "), s.cwd]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harness session report</title>
<style>
:root{color-scheme:dark}
body{margin:0;padding:32px;background:#0b1020;color:#e5e7eb;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;border-bottom:1px solid #1f2937;padding-bottom:6px}
h3{font-size:13px;margin:0 0 10px;color:#9ca3af;font-weight:600}
.muted{color:#6b7280;font-weight:400}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.card{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:14px}
.card .v{font-size:20px;font-weight:700}.card .l{font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.bar{display:flex;align-items:center;gap:8px;margin:4px 0}
.bl{width:110px;flex:none;font-size:12px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{flex:1;height:12px;background:#1f2937;border-radius:6px;overflow:hidden}
.bt i{display:block;height:100%;border-radius:6px}
.bv{width:40px;text-align:right;font-variant-numeric:tabular-nums;color:#9ca3af;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #1f2937}
th{color:#9ca3af;font-weight:600}
td:nth-child(n+2){font-variant-numeric:tabular-nums}
.empty{color:#6b7280;font-style:italic}
</style></head><body>
<h1>Harness session report</h1>
<div class="muted">${a.sessions} sessions · ${day(a.start)} → ${day(a.end)} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</div>
<div class="cards">
  <div class="card"><div class="v">${a.userMessages}</div><div class="l">User messages</div></div>
  <div class="card"><div class="v">${fmtTok(a.tokens.total)}</div><div class="l">Tokens</div></div>
  <div class="card"><div class="v">${fmtCost(a.cost)}</div><div class="l">Cost</div></div>
  <div class="card"><div class="v">${pct(a.toolErrors, a.toolCalls)}</div><div class="l">Tool error rate</div></div>
  <div class="card"><div class="v">${a.interruptions}</div><div class="l">Interruptions</div></div>
  <div class="card"><div class="v">${a.correctionHits}</div><div class="l">Corrections</div></div>
</div>
<h2>Tools</h2>${bar(Object.fromEntries(a.tools.map((t) => [t.name, t.calls])), 12, "#6366f1")}
<h2>Tool error categories</h2>${bar(Object.fromEntries(a.errorCategories.map((e) => [e.name, e.count])), 10, "#ef4444")}
<h2>Usage over time</h2>
<div class="grid2">
  <div class="card"><h3>Time of day</h3>${bar(tod, 4, "#8b5cf6")}</div>
  <div class="card"><h3>Languages</h3>${bar(a.languages, 8, "#14b8a6")}</div>
  <div class="card"><h3>Models</h3>${bar(a.models, 6, "#f97316")}</div>
  <div class="card"><h3>Concurrency</h3>${bar({"Overlapping pairs": a.concurrency.events, "Sessions involved": a.concurrency.sessionsInvolved, "Interleaved messages": a.concurrency.messagesDuring}, 4, "#a855f7")}</div>
</div>
${facetSection}
<h2>Slash commands</h2>${bar(Object.fromEntries(a.slashCommands.map((s) => ["/" + s.name, s.count])), 10, "#0ea5e9")}
<h2>Skills</h2>${bar(Object.fromEntries(a.skills.map((s) => [s.name, s.agent + s.manual])), 10, "#22c55e")}
<h2>Recent sessions</h2>${htmlTable(["Date", "Dur", "Tokens", "Cost", "Err", "Msgs", "Models", "Cwd"], sessionRows)}
<h2>Corrections</h2>${a.corrections.length ? `<ul>${a.corrections.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : `<p class="empty">No correction signals</p>`}
</body></html>`;
}

function selftest() {
  const eq = (a: unknown, b: unknown, msg: string) => { if (a !== b) throw new Error(`selftest: ${msg}: got ${String(a)}, want ${String(b)}`); };
  eq(lineCount("a\nb\nc"), 3, "lineCount");
  eq(lineCount(""), 0, "lineCount empty");
  eq(langFor("/x/y.ts"), "TypeScript", "langFor ts");
  eq(langFor("/x/y.unknown"), null, "langFor unknown");
  eq(categorizeError("oldText not found in file"), "Edit Failed", "categorize edit");
  eq(categorizeError("spawn fd EACCES"), "Permission Denied", "categorize EACCES");
  eq(categorizeError("total gibberish"), "Other", "categorize other");
  const mk = (id: string, ts: number[]) => { const s = newSession(`/tmp/${id}.jsonl`); s.id = id; s.userTimestamps = ts; return s; };
  eq(detectConcurrency([mk("a", [0, 60000]), mk("b", [30000, 90000])]).sessionsInvolved, 2, "concurrency sessions");
  eq(detectConcurrency([mk("a", [0]), mk("b", [7_200_000])]).events, 0, "concurrency far apart");
  console.log("selftest: ok");
}

// known skill names = dirs in ~/.pi/agent/skills (manual invocations
// can only be identified as skills if we know the name is a skill)
const knownSkills = new Set<string>();
try {
  for (const e of readdirSync(join(home, ".pi/agent/skills"), { withFileTypes: true }))
    if (e.isDirectory())
      knownSkills.add(e.name);
} catch {}

// correction detection is a regex heuristic (openers + content markers);
// upgrade to LLM-assisted classification if precision matters. Content markers
// added because user corrections are usually assertions/questions, not "no"-openers
const CORRECTION = /^(no|nope|wrong|stop|revert|undo|actually)\b/i;
const CORRECTION_MARKERS = /(didn'?t work|does not work|doesn'?t work|do(?:es)? not revert|you broke|i did not (tell|ask|say)|why did you|instead use|still (broken|stuck|resetting)|you (did not|didn't) (mark|use|follow)|ignored (instruction|the|your)|explain why|take (all )?my (memory|cpu)|timeouts? under|do not do anything|only tell)/i;

function listSessionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const fp = join(p, e.name);
      if (e.isDirectory())
        walk(fp);
      else if (e.name.endsWith(".jsonl"))
        out.push(fp);
    }
  };
  walk(root);
  return out.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, limit);
}

type Counts = {
  calls: number; errors: number };

const tools = new Map<string, Counts>();
const slashCommands = new Map<string, number>();
const skills = new Map<string, number>(); // agent-invoked (read .../SKILL.md)
const skillsManual = new Map<string, number>(); // user-invoked
const correctionExamples: string[] = [];
let sessions = 0;
let parseErrors = 0;
let userMessages = 0;
let correctionHits = 0;

for (const f of listSessionFiles(dir)) {
  sessions++;
  const s = newSession(f);
  sessionStats.push(s);
  let lines: string[];
  try {
    lines = readFileSync(f, "utf8").split("\n");
  } catch {
    continue;
  }
  for (const line of lines) {
    if (!line.trim())
      continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }
    if (e.type === "session") {
      if (e.id) s.id = e.id;
      if (e.cwd) s.cwd = e.cwd;
      const t0 = Date.parse(e.timestamp ?? "");
      if (!Number.isNaN(t0)) s.start = t0;
      continue;
    }
    if (e.type === "model_change") {
      if (e.modelId) s.models.add(e.modelId);
      continue;
    }
    if (e.type !== "message" || !e.message)
      continue;
    const m = e.message;
    const ts = Date.parse(e.timestamp ?? "");
    if (m.role === "assistant") {
      s.assistantMessages++;
      if (!Number.isNaN(ts)) {
        s.end = Math.max(s.end, ts);
        s.lastAssistant = ts;
      }
      if (m.model) s.models.add(m.model);
      const u = m.usage;
      if (u) {
        s.input += u.input ?? 0;
        s.output += u.output ?? 0;
        s.cacheRead += u.cacheRead ?? 0;
        s.cacheWrite += u.cacheWrite ?? 0;
        s.reasoning += u.reasoning ?? 0;
        s.cost += u.cost?.total ?? 0;
      }
      for (const c of m.content ?? []) {
        if (c.type !== "toolCall" || !c.name)
          continue;
        s.toolCalls++;
        const t = tools.get(c.name) ?? { calls: 0, errors: 0 };
        t.calls++;
        tools.set(c.name, t);
        const a = c.arguments ?? {};
        const p: string = a.path ?? "";
        if (c.name === "read") {
          const skill = p.match(/skills\/([^/]+)\/SKILL\.md$/);
          const name = skill?.[1];
          if (name)
            skills.set(name, (skills.get(name) ?? 0) + 1);
        }
        if (p) {
          const lang = langFor(p);
          if (lang)
            s.languages[lang] = (s.languages[lang] ?? 0) + 1;
        }
        if (c.name === "edit") {
          // pi edit args: {path, edits:[{oldText,newText}]} (legacy: {oldText,newText})
          const edits = Array.isArray(a.edits) ? a.edits : [a];
          for (const ed of edits) {
            s.linesAdded += lineCount(ed?.newText);
            s.linesRemoved += lineCount(ed?.oldText);
          }
          if (p) s.files.add(p);
        } else if (c.name === "write") {
          s.linesAdded += lineCount(a.content);
          if (p) s.files.add(p);
        } else if (c.name === "bash") {
          const cmd: string = a.command ?? "";
          if (cmd.includes("git commit")) s.gitCommits++;
          if (cmd.includes("git push")) s.gitPushes++;
        }
      }
    } else if (m.role === "toolResult") {
      if (m.isError && m.toolName) {
        const t = tools.get(m.toolName) ?? { calls: 0, errors: 0 };
        t.errors++;
        tools.set(m.toolName, t);
        s.toolErrors++;
        const txt = (m.content ?? []).map((c: any) => c.text ?? "").join(" ").slice(0, 4000);
        const cat = categorizeError(txt);
        errorCategories.set(cat, (errorCategories.get(cat) ?? 0) + 1);
      }
    } else if (m.role === "user") {
      const text = userText(m);
      if (!text.trim())
        continue;
      userMessages++;
      s.userMessages++;
      s.messageHours.push(new Date(Number.isNaN(ts) ? s.end : ts).getHours());
      if (!Number.isNaN(ts)) {
        s.userTimestamps.push(ts);
        // response time = gap from the previous assistant turn to this human turn
        if (s.lastAssistant && ts > s.lastAssistant) {
          const sec = (ts - s.lastAssistant) / 1000;
          if (sec >= 2 && sec <= 6 * 3600) s.responseTimes.push(sec);
        }
      }
      if (text.includes("[Request interrupted by user")) s.interruptions++;
      if (!s.firstPrompt) s.firstPrompt = text.replace(/\s+/g, " ").trim().slice(0, 200);
      // Manual skill invocations are persisted in two forms:
      //   raw:      /skill:name [args]
      //   expanded: <skill name="name" location="...">
      // Prompt-template expansions (/name) lose the command name entirely —
      // those can't be attributed (their follow-up SKILL.md reads count as agent usage).
      const t = text.trim();
      const raw = t.match(/^\/skill:([a-z0-9][a-z0-9-]*)/);
      const expanded = t.match(/^<skill name="([^"]+)"/);
      if (raw || expanded) {
        const name = (raw?.[1] ?? expanded![1] ?? "").toLowerCase();
        skillsManual.set(name, (skillsManual.get(name) ?? 0) + 1);
      } else {
        const slash = t.match(/^\/([a-z0-9][a-z0-9-]*)/);
        if (slash && slash[1])
          slashCommands.set(slash[1], (slashCommands.get(slash[1]) ?? 0) + 1);
      }
      if (CORRECTION.test(text.trim()) || CORRECTION_MARKERS.test(text)) {
        correctionHits++;
        s.corrections++;
        if (correctionExamples.length < 5)
          correctionExamples.push(text.slice(0, 120).replace(/\s+/g, " ").trim());
      }
    }
  }
}

if (hasFlag("--selftest")) {
  selftest();
} else if (hasFlag("--sessions")) {
  console.log(renderSessions());
} else if (hasFlag("--json")) {
  console.log(JSON.stringify(buildAggregate(), null, 2));
} else if (hasFlag("--html")) {
  const out = flagValue("--html") ?? join(import.meta.dir, "harness-report.html");
  writeFileSync(out, renderHtml());
  console.log(`Wrote ${out}`);
} else {
  console.log(renderText());
}
