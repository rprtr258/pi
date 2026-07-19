// Agent discovery and configuration

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const userScopeDir = "~/.pi/agent/extensions/subagent/agents";
export const projectScopeDir = ".pi/agents";

export type AgentScope = "user" | "project" | "both";

export type AgentConfig = {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
};

export type AgentDiscoveryResult = {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
};

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries.flatMap(entry => {
    if (!entry.name.endsWith(".md") || !entry.isFile() && !entry.isSymbolicLink())
      return [];

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      return [];
    }

    const {frontmatter: {name, description, model, tools}, body} = parseFrontmatter<Record<string, string>>(content);
    if (!name || !description)
      return [];

    return [{
      name,
      description,
      tools: tools?.split(",").map(t => t.trim()).filter(Boolean),
      model,
      systemPrompt: body,
      source,
      filePath,
    }];
  });
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate))
      return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir)
      return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), "extensions", "subagent", "agents");
  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");

  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agents = new Map<string, AgentConfig>([
    ...(scope === "both" || scope === "user"    ? userAgents    : []),
    ...(scope === "both" || scope === "project" ? projectAgents : []),
  ].map(agent => [agent.name, agent])).values();

  return {
    agents: Array.from(agents),
    projectAgentsDir,
  };
}

function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
  if (agents.length === 0)
    return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    text: listed.map(a => `${a.name} (${a.source}): ${a.description}`).join("; "),
    remaining,
  };
}
