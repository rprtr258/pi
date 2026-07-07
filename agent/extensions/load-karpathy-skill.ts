import {readFileSync} from "fs";
import {homedir} from "os";
import {type ExtensionAPI, loadSkillsFromDir} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const res = loadSkillsFromDir({dir: `${homedir()}/.pi/agent/skills/karpathy-guidelines`, source: "karpathy-guidelines"});
		if (res.diagnostics.length > 0) {
			throw new Error(`Failed to load karpathy-guidelines skill: ${res.diagnostics.join("\n")}`);
		}
		if (res.skills.length !== 1) {
			throw new Error(`Failed to load karpathy-guidelines skill: expected 1 skill, got ${res.skills.length}`);
		}
		return { systemPrompt: `${event.systemPrompt}\n\n${readFileSync(res.skills[0].filePath)}` };
	});
}
