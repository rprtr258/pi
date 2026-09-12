#!/usr/bin/env bun
/**
 * Harness cycle stats from pi session logs.
 * Reports: tool call/error counts, slash-command (skill/template) usage,
 * correction-signal user messages. Used by the /harness analyze phase.
 *
 * Usage: bun stats.ts
 * Scans the 500 most recent sessions in ~/.pi/agent/sessions.
 */
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

const home = process.env.HOME ?? "";
const dir = join(home, ".pi/agent/sessions");
const limit = 500;

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
    if (e.type !== "message" || !e.message)
      continue;
    const m = e.message;
    if (m.role === "assistant") {
      for (const c of m.content ?? []) {
        if (c.type === "toolCall" && c.name) {
          const t = tools.get(c.name) ?? { calls: 0, errors: 0 };
          t.calls++;
          tools.set(c.name, t);
          if (c.name === "read") {
            const p: string = c.arguments?.path ?? "";
            const skill = p.match(/skills\/([^/]+)\/SKILL\.md$/);
            const name = skill?.[1];
            if (name)
              skills.set(name, (skills.get(name) ?? 0) + 1);
          }
        }
      }
    } else if (m.role === "toolResult") {
      if (m.isError && m.toolName) {
        const t = tools.get(m.toolName) ?? { calls: 0, errors: 0 };
        t.errors++;
        tools.set(m.toolName, t);
      }
    } else if (m.role === "user") {
      const text = (m.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join(" ");
      if (!text.trim())
        continue;
      userMessages++;
      // Manual skill invocations are persisted in two forms:
      //   raw:      /skill:name [args]
      //   expanded: <skill name="name" location="...">
      // Prompt-template expansions (/name) lose the command name entirely —
      // those can't be attributed (their follow-up SKILL.md reads count as agent usage).
      const t = text.trim();
      const raw = t.match(/^\/skill:([a-z0-9][a-z0-9-]*)/);
      const expanded = t.match(/^<skill name="([^"]+)"/);
      if (raw || expanded) {
        const name = (raw?.[1] ?? expanded![1]).toLowerCase();
        skillsManual.set(name, (skillsManual.get(name) ?? 0) + 1);
      } else {
        const slash = t.match(/^\/([a-z0-9][a-z0-9-]*)/);
        if (slash)
          slashCommands.set(slash[1], (slashCommands.get(slash[1]) ?? 0) + 1);
      }
      if (CORRECTION.test(text.trim()) || CORRECTION_MARKERS.test(text)) {
        correctionHits++;
        if (correctionExamples.length < 5)
          correctionExamples.push(text.slice(0, 120).replace(/\s+/g, " ").trim());
      }
    }
  }
}

console.log(`Sessions scanned: ${sessions} (latest ${limit}), unparseable lines: ${parseErrors}`);
console.log(`User messages: ${userMessages}, correction-signal hits: ${correctionHits}`);
for (const ex of correctionExamples)
  console.log(`  [correction] ${ex}`);

console.log("\nTool usage (calls / errors / error rate):");
for (const [name, t] of [...tools].sort((a, b) => b[1].calls - a[1].calls)) {
  const rate = t.calls ? ((t.errors / t.calls) * 100).toFixed(1) : "0.0";
  console.log(`  ${name.padEnd(24)} ${String(t.calls).padStart(6)} / ${String(t.errors).padStart(5)} / ${rate}%`);
}

console.log("\nSlash-command usage (extension commands / unexpanded):");
const slashes = [...slashCommands].sort((a, b) => b[1] - a[1]);
if (slashes.length === 0)
  console.log("  (none)");
for (const [name, n] of slashes)
  console.log(`  /${name.padEnd(22)} ${n}`);

console.log("\nSkill usage (manual / agent / total):");
const skillNames = new Set([...skills.keys(), ...knownSkills]);
const used = [...skillNames].filter((n) => (skills.get(n) ?? 0) + (skillsManual.get(n) ?? 0) > 0);
if (used.length === 0)
  console.log("  (none)");
for (const name of used.sort((a, b) => ((skills.get(b) ?? 0) - (skills.get(a) ?? 0)))) {
  const agent = skills.get(name) ?? 0;
  const manual = skillsManual.get(name) ?? 0;
  console.log(`  ${name.padEnd(26)} ${manual} / ${agent} / ${manual + agent}`);
}
