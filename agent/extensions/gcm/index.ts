/**
 * GCM - Git Commit Message Generator (pi-mono agent)
 *
 * A simple single-purpose tool that takes a git diff and returns a suggested
 * commit message. No automatic hooks, no system prompt injection — just a
 * clean tool you invoke when you need a commit message.
 *
 * Register it as part of your active tools via the extension system, then
 * ask the agent: "generate a commit message for my changes" — the agent
 * will compute the diff itself and call the `commit-msg` tool.
 *
 * Alternatively, invoke it directly via the subagent tool:
 *   subagent("commit-msg", "diff --git a/src/main.ts b/src/main.ts\n...")
 *
 * Install:
 *   pi -e ~/.pi/agent/extensions/gcm
 */
import {complete, type UserMessage} from "@mariozechner/pi-ai";
import {type ExtensionAPI} from "@mariozechner/pi-coding-agent";

async function getDiff(pi: ExtensionAPI): Promise<string> {
  const result = await pi.exec("git", ["diff"]);
  return result.stdout;
}

export default function (pi: ExtensionAPI) {
  return;
  pi.on("session_start", async (_, ctx) => {
    if (ctx.hasUI) {
      return;
    }
    const model = ctx.model;
    if (!model) {
      throw new Error("No active model available.");
    }

    // Resolve API key
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      throw new Error("Failed to resolve API key for the active model.");
    }

    const diff = await getDiff(pi);
    const userMessage: UserMessage = {
      role: "user",
      content: [
        {
          type: "text",
          text: `Generate a commit message for the following diff.

Style guide: Respond with one concise, descriptive line. Use imperative mood, capitalize first word unless starting with lowercase scope, no trailing period.

\`\`\`diff
${diff}
\`\`\``,
        },
      ],
      timestamp: Date.now(),
    };

    const response = await complete(
      model,
      {
        systemPrompt:
          "You are a helpful assistant that generates concise, descriptive git commit messages. " +
          "Respond with ONLY the commit message, no additional commentary, explanation, or formatting.",
        messages: [userMessage],
      },
      {apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal},
    );

    const responseText = response.content
      .filter((c): c is {type: "text"; text: string} => c.type === "text")
      .map(c => c.text)
      .join("\n")
      .trim();
    if (!responseText) {
      throw new Error("No commit message generated.");
    }

    console.log(responseText);
    process.exit(0);
  });
};
