#!/usr/bin/env bun
/**
 * Unit tests for sandbox staging (stage.ts): snapshot skip rules and the
 * exact contents of a built sandbox. All against temp dirs — no real agent
 * dir, no model calls.
 *
 *   bun test loop/lib/stage.test.ts
 */
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {buildSandbox, capturePackages, snapshotReal} from "./stage.ts";

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

/** All file paths under root, relative, sorted (symlinks included as entries). */
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
    expect(snap.kinds.skills.map((s) => s.relPath)).toEqual(["skills/coding-standards/SKILL.md", "skills/review/SKILL.md"]);
  });

  test("returns agent-dir-relative relPaths and the AGENTS.md text", () => {
    const dir = makeAgentDir(tempRoot());
    const snap = snapshotReal(dir);
    expect(snap.kinds.agents).toEqual([{relPath: "AGENTS.md", content: "# Agents rules\n"}]);
    expect(snap.kinds.skills.map((s) => s.relPath).sort()).toEqual(["skills/coding-standards/SKILL.md", "skills/review/SKILL.md"]);
    expect(snap.kinds.skills.find((s) => s.relPath === "skills/coding-standards/SKILL.md")!.content).toBe("standard body\n");
    expect(snap.kinds.skills.find((s) => s.relPath === "skills/review/SKILL.md")!.content).toBe("review body\n");
  });

  test("an empty agent dir yields empty kinds", () => {
    const dir = tempRoot();
    const snap = snapshotReal(dir);
    expect(snap.kinds.agents).toEqual([]);
    expect(snap.kinds.skills).toEqual([]);
    expect(snap.kinds.templates).toEqual([]);
    expect(snap.kinds.subagents).toEqual([]);
  });

  test("templates kind: prompts/*.md flat, dotfiles and non-.md skipped (S8)", () => {
    const dir = tempRoot();
    mkdirSync(join(dir, "prompts", "nested"), {recursive: true});
    writeFileSync(join(dir, "prompts", "mode-ask.md"), "# Ask\n");
    writeFileSync(join(dir, "prompts", ".hidden.md"), "no\n");
    writeFileSync(join(dir, "prompts", "notes.txt"), "no\n");
    writeFileSync(join(dir, "prompts", "nested", "deep.md"), "no\n");
    const snap = snapshotReal(dir);
    expect(snap.kinds.templates).toEqual([{relPath: "prompts/mode-ask.md", content: "# Ask\n"}]);
  });

  test("subagents kind: flat *.md, dotfiles and *.chain.md excluded (S8)", () => {
    const dir = tempRoot();
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, "agents", "miner.md"), "---\nname: miner\n---\n");
    writeFileSync(join(dir, "agents", "flow.chain.md"), "chain, not an agent\n");
    writeFileSync(join(dir, "agents", ".hidden.md"), "no\n");
    mkdirSync(join(dir, "agents", "sub"));
    writeFileSync(join(dir, "agents", "sub", "deep.md"), "no\n");
    const snap = snapshotReal(dir);
    expect(snap.kinds.subagents).toEqual([{relPath: "agents/miner.md", content: "---\nname: miner\n---\n"}]);
  });
});

describe("capturePackages", () => {
  test("returns the settings.json packages string array; tolerant of junk", () => {
    const dir = tempRoot();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({packages: ["npm:pi-subagents", 42, "", null, "npm:pi-context"]}));
    expect(capturePackages(dir)).toEqual(["npm:pi-subagents", "npm:pi-context"]);
    writeFileSync(join(dir, "settings.json"), JSON.stringify({packages: "not-an-array"}));
    expect(capturePackages(dir)).toEqual([]);
    writeFileSync(join(dir, "settings.json"), "not json");
    expect(capturePackages(dir)).toEqual([]);
    expect(capturePackages(join(dir, "missing"))).toEqual([]);
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

  test("stages templates and subagents at their agent-dir-relative paths (S8)", () => {
    const agentDir = makeAgentDir(tempRoot());
    mkdirSync(join(agentDir, "prompts"));
    mkdirSync(join(agentDir, "agents"));
    writeFileSync(join(agentDir, "prompts", "mode-ask.md"), "# Ask\n");
    writeFileSync(join(agentDir, "agents", "scout.md"), "---\nname: scout\n---\n");
    writeFileSync(join(agentDir, "agents", "flow.chain.md"), "chain\n");
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(relativeFiles(dir)).toEqual([
      "AGENTS.md",
      "agents/scout.md", // *.chain.md excluded
      "auth.json",
      "models.json",
      "prompts/mode-ask.md",
      "settings.json",
      "skills/coding-standards/SKILL.md",
      "skills/review/SKILL.md",
    ]);
    expect(readFileSync(join(dir, "agents", "scout.md"), "utf8")).toBe("---\nname: scout\n---\n");
  });

  test("auth.json, mcp-auth.json and models.json copies are read-only (0o444)", () => {
    const agentDir = makeAgentDir(tempRoot());
    writeFileSync(join(agentDir, "mcp-auth.json"), '{"mcp-gateway":{"accessToken":"t"}}');
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o444);
    // mcp-auth.json staged READ-ONLY too (Step 9b review fix): OAuth servers
    // authenticate in sandbox probes instead of always reporting needs-auth.
    expect(readFileSync(join(dir, "mcp-auth.json"), "utf8")).toBe('{"mcp-gateway":{"accessToken":"t"}}');
    expect(statSync(join(dir, "mcp-auth.json")).mode & 0o777).toBe(0o444);
    expect(statSync(join(dir, "models.json")).mode & 0o777).toBe(0o444);
    // Settings and skills stay writable.
    expect(statSync(join(dir, "settings.json")).mode & 0o777).not.toBe(0o444);
  });

  test("mcp-auth.json is NOT staged when absent in the real agent dir (Step 9b review fix)", () => {
    const agentDir = makeAgentDir(tempRoot()); // no mcp-auth.json written
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(existsSync(join(dir, "mcp-auth.json"))).toBe(false);
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

  test("replicates the real settings.json packages array into the sandbox settings (S8)", () => {
    const agentDir = makeAgentDir(tempRoot());
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
      defaultModel: "claude-sonnet-4-5",
      defaultProvider: "anthropic",
      quietStartup: true,
      packages: ["npm:pi-subagents", "npm:pi-context"],
    }));
    const dir = join(tempRoot(), "sandbox");
    const built = buildSandbox(snapshotReal(agentDir), dir, agentDir);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(settings.packages).toEqual(["npm:pi-subagents", "npm:pi-context"]);
    expect(built.packages).toEqual(["npm:pi-subagents", "npm:pi-context"]);
    // Non-packages settings keys still not leaked.
    expect(settings.quietStartup).toBeUndefined();
  });

  test("no packages key in sandbox settings when the real settings has none", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    expect(settings.packages).toBeUndefined();
  });

  test("npm node_modules is staged as a symlink to the real store and resolves (S8)", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "npm", "node_modules", "pi-subagents"), {recursive: true});
    writeFileSync(join(agentDir, "npm", "node_modules", "pi-subagents", "package.json"), '{"name":"pi-subagents"}');
    const dir = join(root, "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    const link = join(dir, "npm", "node_modules");
    expect(statSync(link).isDirectory()).toBe(true);
    // Resolves to the REAL store — pi reads through it read-only.
    expect(realpathSync(link)).toBe(realpathSync(join(agentDir, "npm", "node_modules")));
    expect(existsSync(join(link, "pi-subagents", "package.json"))).toBe(true);
  });

  test("a dangling real npm node_modules symlink FAILS staging loudly (S8)", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "npm"), {recursive: true});
    symlinkSync(join(root, "does-not-exist"), join(agentDir, "npm", "node_modules"));
    const dir = join(root, "sandbox");
    expect(() => buildSandbox(snapshotReal(agentDir), dir, agentDir)).toThrow(/dangling symlink/);
  });

  test("no npm replication when the real agent dir has no npm store", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(existsSync(join(dir, "npm"))).toBe(false);
  });

  test("npm and git package stores are BOTH staged as resolving symlinks (S8 review fix)", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "npm", "node_modules", "pi-subagents"), {recursive: true});
    writeFileSync(join(agentDir, "npm", "node_modules", "pi-subagents", "package.json"), '{"name":"pi-subagents"}');
    mkdirSync(join(agentDir, "git", "github.com", "someone", "pi-tool"), {recursive: true});
    writeFileSync(join(agentDir, "git", "github.com", "someone", "pi-tool", "package.json"), '{"name":"pi-tool"}');
    const dir = join(root, "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    // Both links resolve to the REAL stores — pi reads through them read-only.
    expect(realpathSync(join(dir, "npm", "node_modules"))).toBe(realpathSync(join(agentDir, "npm", "node_modules")));
    expect(realpathSync(join(dir, "git"))).toBe(realpathSync(join(agentDir, "git")));
    expect(existsSync(join(dir, "npm", "node_modules", "pi-subagents", "package.json"))).toBe(true);
    expect(existsSync(join(dir, "git", "github.com", "someone", "pi-tool", "package.json"))).toBe(true);
  });

  test("a dangling real git store symlink FAILS staging loudly (S8 review fix)", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, {recursive: true});
    symlinkSync(join(root, "does-not-exist"), join(agentDir, "git"));
    const dir = join(root, "sandbox");
    expect(() => buildSandbox(snapshotReal(agentDir), dir, agentDir)).toThrow(/git store .* dangling symlink/);
  });

  test("no git replication when the real agent dir has no git store (S8 review fix)", () => {
    const agentDir = makeAgentDir(tempRoot());
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(existsSync(join(dir, "git"))).toBe(false);
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

  test("stages the real mcp.json at the sandbox root when present; nothing when absent (Step 9b)", () => {
    const agentDir = makeAgentDir(tempRoot());
    writeFileSync(join(agentDir, "mcp.json"), '{"mcpServers":{"fs":{"command":"fs-server"}}}\n');
    const dir = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir), dir, agentDir);
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toBe('{"mcpServers":{"fs":{"command":"fs-server"}}}\n');
    // Absent real file → no mcp.json in the sandbox at all (never an empty file).
    const agentDir2 = makeAgentDir(tempRoot());
    const dir2 = join(tempRoot(), "sandbox");
    buildSandbox(snapshotReal(agentDir2), dir2, agentDir2);
    expect(existsSync(join(dir2, "mcp.json"))).toBe(false);
  });
});
