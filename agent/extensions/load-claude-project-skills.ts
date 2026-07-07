import {cwd} from "process";
import {type ExtensionAPI, loadSkillsFromDir} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", async (event) => {
    const skill_dir = cwd() + "/.claude/skills";
    const res = loadSkillsFromDir({dir: skill_dir, source: "project-skills"});
    if (res.diagnostics.length > 0) {
      throw new Error(`load project-skills skill: ${res.diagnostics.join("\n")}`);
    }
    return {skillPaths: res.skills.map(skill => skill.filePath)};
  });
}
