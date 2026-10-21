#!/usr/bin/env bun
/**
 * Unit tests for the surface registry (surface.ts, Step 8): allowlists,
 * per-kind content validators, snapshot skip rules, and staging.
 *
 *   bun test loop/lib/surface.test.ts
 */
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, test} from "bun:test";
import {
  kindForPath,
  parseFrontmatterField,
  SURFACE_KINDS,
  surfaceKind,
  validateSubagent,
  validateTemplate,
  type SurfaceKindName,
} from "./surface.ts";

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) rmSync(root, {recursive: true, force: true});
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "surface-test-"));
  tmpRoots.push(root);
  return root;
}

describe("registry routing (kindForPath)", () => {
  test("routes each managed path to its owning kind", () => {
    expect(kindForPath("AGENTS.md")!.name).toBe("agents");
    expect(kindForPath("skills/cli-jq/SKILL.md")!.name).toBe("skills");
    expect(kindForPath("skills/cli-jq/scripts/run.sh")!.name).toBe("skills");
    expect(kindForPath("prompts/mode-ask.md")!.name).toBe("templates");
    expect(kindForPath("agents/miner.md")!.name).toBe("subagents");
  });

  test("rejects paths outside every allowlist", () => {
    for (const path of [
      "agents.md", // case variant
      "skills/CLI-JQ/SKILL.md", // uppercase skill dir
      "skills/cli-jq/other.md",
      "prompts/sub/deep.md", // no subdirectories
      "prompts/.hidden.md", // no dotfiles
      "prompts/notes.txt", // md only
      "agents/flow.chain.md", // chain files excluded
      "agents/sub/deep.md", // flat only
      "extensions/x.ts",
      "sessions/s.json",
    ]) {
      expect(kindForPath(path)).toBeNull();
    }
  });

  test("every registry kind exposes its gitPath and applyDir", () => {
    const byName = Object.fromEntries(SURFACE_KINDS.map((k) => [k.name, k])) as Record<SurfaceKindName, (typeof SURFACE_KINDS)[number]>;
    expect(byName.agents!.gitPath).toBe("AGENTS.md");
    expect(byName.agents!.applyDir).toBe("");
    expect(byName.skills!.gitPath).toBe("skills/");
    expect(byName.skills!.applyDir).toBe("skills");
    expect(byName.templates!.gitPath).toBe("prompts/");
    expect(byName.templates!.applyDir).toBe("prompts");
    expect(byName.subagents!.gitPath).toBe("agents/");
    expect(byName.subagents!.applyDir).toBe("agents");
  });

  test("surfaceKind throws on an unknown name", () => {
    expect(() => surfaceKind("nope" as SurfaceKindName)).toThrow(/unknown surface kind/);
  });
});

describe("template validator", () => {
  test("unbalanced {{ without }} rejected; balanced accepted", () => {
    expect(validateTemplate("Use {{MODE here", "prompts/x.md")).toEqual(["template prompts/x.md: unbalanced {{ without }} (placeholder opener has no closer)"]);
    expect(validateTemplate("Use {{MODE}} here", "prompts/x.md")).toEqual([]);
    // Multiple balanced placeholders pass.
    expect(validateTemplate("{{A}} and {{B}}", "prompts/x.md")).toEqual([]);
  });

  test("frontmatter-less templates accepted (pi falls back to the first line)", () => {
    expect(validateTemplate("# Just a heading\n\nBody with no {{tokens}}.\n", "prompts/x.md")).toEqual([]);
  });

  test("deletion allowed", () => {
    expect(validateTemplate(null, "prompts/x.md")).toEqual([]);
  });
});

describe("subagent validator", () => {
  test("missing name rejected", () => {
    const reasons = validateSubagent("---\ndescription: Does work.\n---\nbody", "agents/worker.md");
    expect(reasons.some((r) => r.includes('frontmatter field "name" is required'))).toBe(true);
  });

  test("missing description rejected", () => {
    const reasons = validateSubagent("---\nname: worker\n---\nbody", "agents/worker.md");
    expect(reasons.some((r) => r.includes('frontmatter field "description" is required'))).toBe(true);
  });

  test("no frontmatter rejected", () => {
    expect(validateSubagent("# just text", "agents/worker.md").some((r) => r.includes("YAML frontmatter"))).toBe(true);
  });

  test("name + description present accepted; empty values rejected; deletion allowed", () => {
    expect(validateSubagent("---\nname: worker\ndescription: Does work.\n---\nbody", "agents/worker.md")).toEqual([]);
    expect(validateSubagent('---\nname: worker\ndescription: ""\n---\nbody', "agents/worker.md").length).toBe(1);
    expect(validateSubagent(null, "agents/worker.md")).toEqual([]);
  });
});

describe("parseFrontmatterField", () => {
  test("reads scalar values, strips quotes, null when absent/empty", () => {
    const fm = "name: miner\ndescription: \"Mines logs\"\ntools: bash\n";
    expect(parseFrontmatterField(fm, "name")).toBe("miner");
    expect(parseFrontmatterField(fm, "description")).toBe("Mines logs");
    expect(parseFrontmatterField(fm, "thinking")).toBeNull();
    expect(parseFrontmatterField("name:   \n", "name")).toBeNull();
  });
});

describe("kind snapshots", () => {
  test("agents kind: AGENTS.md text or empty list when absent", () => {
    const dir = tempDir();
    expect(surfaceKind("agents").snapshot(dir)).toEqual([]);
    writeFileSync(join(dir, "AGENTS.md"), "# rules\n");
    expect(surfaceKind("agents").snapshot(dir)).toEqual([{relPath: "AGENTS.md", content: "# rules\n"}]);
  });

  test("skills kind snapshot: recursive, agent-dir-relative, skips node_modules/dotfiles", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "skills", "a", "node_modules", "pkg"), {recursive: true});
    writeFileSync(join(dir, "skills", "a", "SKILL.md"), "a\n");
    mkdirSync(join(dir, "skills", "a", "scripts"), {recursive: true});
    writeFileSync(join(dir, "skills", "a", "scripts", "run.sh"), "s\n");
    writeFileSync(join(dir, "skills", "a", "node_modules", "pkg", "i.js"), "dep\n");
    writeFileSync(join(dir, "skills", ".hidden"), "no\n");
    const files = surfaceKind("skills").snapshot(dir);
    expect(files.map((f) => f.relPath).sort()).toEqual(["skills/a/SKILL.md", "skills/a/scripts/run.sh"]);
  });

  test("templates kind snapshot: flat prompts/*.md only", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "prompts", "sub"), {recursive: true});
    writeFileSync(join(dir, "prompts", "a.md"), "a\n");
    writeFileSync(join(dir, "prompts", "b.txt"), "no\n");
    writeFileSync(join(dir, "prompts", ".c.md"), "no\n");
    writeFileSync(join(dir, "prompts", "sub", "d.md"), "no\n");
    expect(surfaceKind("templates").snapshot(dir)).toEqual([{relPath: "prompts/a.md", content: "a\n"}]);
  });

  test("subagents kind snapshot: flat agents/*.md, *.chain.md excluded", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, "agents", "miner.md"), "---\nname: miner\n---\n");
    writeFileSync(join(dir, "agents", "flow.chain.md"), "chain\n");
    expect(surfaceKind("subagents").snapshot(dir)).toEqual([{relPath: "agents/miner.md", content: "---\nname: miner\n---\n"}]);
  });

  test("staging round-trips every kind's files at their agent-dir-relative paths", () => {
    const src = tempDir();
    mkdirSync(join(src, "skills", "a"), {recursive: true});
    mkdirSync(join(src, "prompts"));
    mkdirSync(join(src, "agents"));
    writeFileSync(join(src, "AGENTS.md"), "# rules\n");
    writeFileSync(join(src, "skills", "a", "SKILL.md"), "skill\n");
    writeFileSync(join(src, "prompts", "a.md"), "template\n");
    writeFileSync(join(src, "agents", "a.md"), "agent\n");
    const sandbox = tempDir();
    for (const kind of SURFACE_KINDS) kind.stage(sandbox, kind.snapshot(src));
    expect(readFileSync(join(sandbox, "AGENTS.md"), "utf8")).toBe("# rules\n");
    expect(readFileSync(join(sandbox, "skills", "a", "SKILL.md"), "utf8")).toBe("skill\n");
    expect(readFileSync(join(sandbox, "prompts", "a.md"), "utf8")).toBe("template\n");
    expect(readFileSync(join(sandbox, "agents", "a.md"), "utf8")).toBe("agent\n");
    // Top-level entries are exactly the staged kinds.
    expect(readdirSync(sandbox).sort()).toEqual(["AGENTS.md", "agents", "prompts", "skills"]);
  });

  test("agents stage always writes AGENTS.md, even from an empty file list (Phase I behavior)", () => {
    const sandbox = tempDir();
    surfaceKind("agents").stage(sandbox, []);
    expect(readFileSync(join(sandbox, "AGENTS.md"), "utf8")).toBe("");
  });
});
