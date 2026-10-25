#!/usr/bin/env bun
/**
 * Unit tests for sandbox staging (stage.ts): snapshot skip rules and the
 * exact contents of a built sandbox. All against temp dirs — no real agent
 * dir, no model calls.
 *
 *   bun test loop/lib/stage.test.ts
 */
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {buildSandbox, snapshotReal} from "./stage.ts";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "stage-test-"));
  tmpRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

/** Fake HOME-like agent dir: AGENTS.md, settings/auth/models, skills tree
 *  polluted with node_modules and dotfiles, plus stuff that must NOT be staged. */
function makeAgentDir(root: string): string {
  const dir = join(root, "agent");
  mkdirSync(join(dir, "skills", "coding-standards"), {recursive: true});
  mkdirSync(join(dir, "skills", "review", "node_modules", "pkg"), {recursive: true});
  mkdirSync(join(dir, "extensions", "some-ext"), {recursive: true});
  mkdirSync(join(dir, "sessions"), {recursive: true});
  writeFileSync(join(dir, "AGENTS.md"), "# Agents rules\n");
  writeFileSync(join(dir, "settings.json"), JSON.stringify({defaultModel: "claude-sonnet-4-5", defaultProvider: "anthropic", quietStartup: true}));
  writeFileSync(join(dir, "auth.json"), '{"anthropic":{"token":"secret"}}');
  writeFileSync(join(dir, "models.json"), "[]");
  writeFileSync(join(dir, "skills", "coding-standards", "SKILL.md"), "standard body\n");
  writeFileSync(join(dir, "skills", ".hidden-skill.md"), "dotfile\n");
  writeFileSync(join(dir, "skills", "review", "SKILL.md"), "review body\n");
  writeFileSync(join(dir, "skills", "review", "node_modules", "pkg", "index.js"), "dependency\n");
  writeFileSync(join(dir, "skills", "review", ".hidden"), "nested dotfile\n");
  writeFileSync(join(dir, "extensions", "some-ext", "ext.ts"), "extension\n");
  writeFileSync(join(dir, "sessions", "s.json"), "{}\n");
  return dir;
}

/** All file paths under root, relative, sorted. */
function relativeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory())
        walk(join(dir, entry.name), rel);
      else
        out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

describe("snapshotReal (parametrized agent dir)", () => {
  test("skips node_modules and dotfiles in the skills tree", () => {
    const dir = makeAgentDir(tempRoot());
    const snap = snapshotReal(dir);
    expect(snap.skills.map((s) => s.relPath)).toEqual(["coding-standards/SKILL.md", "review/SKILL.md"]);
  });

  test("returns relPath shapes relative to skills/ and the AGENTS.md text", () => {
    const dir = makeAgentDir(tempRoot());
    const snap = snapshotReal(dir);
    expect(snap.agentsMd).toBe("# Agents rules\n");
    expect(snap.skills.map((s) => s.relPath).sort()).toEqual(["coding-standards/SKILL.md", "review/SKILL.md"]);
    expect(snap.skills.find((s) => s.relPath === "coding-standards/SKILL.md")!.content).toBe("standard body\n");
    expect(snap.skills.find((s) => s.relPath === "review/SKILL.md")!.content).toBe("review body\n");
  });

  test("an empty agent dir yields empty components", () => {
    const dir = tempRoot();
    const snap = snapshotReal(dir);
    expect(snap.agentsMd).toBe("");
    expect(snap.skills).toEqual([]);
  });
});

describe("buildSandbox", () => {
  test("stages the EXACT set of entries — settings.json, auth.json, models.json, AGENTS.md, skills/ — and nothing else", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    // Top level: exactly these five entries.
    expect(readdirSync(dir).sort()).toEqual(["AGENTS.md", "auth.json", "models.json", "settings.json", "skills"]);
    // Recursive file set: no extensions/, sessions/, node_modules or dotfiles.
    expect(relativeFiles(dir)).toEqual([
      "AGENTS.md",
      "auth.json",
      "models.json",
      "settings.json",
      "skills/coding-standards/SKILL.md",
      "skills/review/SKILL.md",
    ]);
  });

  test("auth.json and models.json copies are read-only (0o444)", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o444);
    expect(statSync(join(dir, "models.json")).mode & 0o777).toBe(0o444);
    // Settings and skills stay writable.
    expect(statSync(join(dir, "settings.json")).mode & 0o777).not.toBe(0o444);
  });

  test("settings.json contains the captured provider/model", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    const built = buildSandbox(snapshotReal(agentDir), dir, agentDir);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(settings.defaultModel).toBe("claude-sonnet-4-5");
    expect(settings.defaultProvider).toBe("anthropic");
    // Other settings keys are NOT leaked into the sandbox.
    expect(settings.quietStartup).toBeUndefined();
    expect(built.captured).toEqual({defaultModel: "claude-sonnet-4-5", defaultProvider: "anthropic"});
  });

  test("omits auth.json/models.json when absent in the source dir", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "skills", "s"), {recursive: true});
    writeFileSync(join(agentDir, "AGENTS.md"), "x");
    writeFileSync(join(agentDir, "settings.json"), "{}");
    writeFileSync(join(agentDir, "skills", "s", "SKILL.md"), "s");
    const dir = join(root, "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(relativeFiles(dir)).toEqual(["AGENTS.md", "settings.json", "skills/s/SKILL.md"]);
  });
});
