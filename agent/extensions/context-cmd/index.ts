import {type AgentMessage} from "@earendil-works/pi-agent-core";
import {type ExtensionAPI, type ExtensionCommandContext} from "@earendil-works/pi-coding-agent";
import {DEFAULT_COMPACTION_SETTINGS, estimateTokens} from "@earendil-works/pi-coding-agent";

function myEstimateTokens(text: string): number {
  return estimateTokens({
    role: "toolResult",
    content: [{ type: "text", text: text }],
    toolName: "",
    isError: false,
    timestamp: 0,
    toolCallId: "",
  });
}

type TreeNode = {
  name: string,
  value?: number, // optional, sum of children if none
  children?: TreeNode[],
};

function stat(val: number, total: number, label: string): string {
  return `${label}: ${val} (${((val / total) * 100).toFixed(2)}%)`;
}

function getValue(node: TreeNode): number {
  if (node.value) return node.value;
  return node.children?.reduce((a, b) => a + getValue(b), 0) ?? 0;
}

function printTree(node: TreeNode, total: number): string[] {
  const children = node.children ?? [];
  const value = node.value ?? getValue(node);
  return [
    stat(value, total, node.name),
    ...children.flatMap((c, i) => printTree(c, value)
      .map((line, j) => (i === children.length-1 ? j === 0 ? '└── ' : '    ' : j === 0 ? '├── ' : '│   ') + line)),
  ];
}

export default function (pi: ExtensionAPI) {
  // Drop large tool results older than 10 messages
  pi.on("context", (event, ctx) => {
    const pruned = event.messages.filter((msg, i) => {
      return msg.role !== "toolResult" ||
        i >= event.messages.length - 10 ||
        msg.content.filter(c => c.type === "text").map(c => c.text.length).reduce((a, b) => a + b, 0) <= 5000;
    });
    return { messages: pruned };
  });
  pi.registerCommand("context", {
    description: "Visualize current context usage as a colored grid",
    async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
      const usage = ctx.getContextUsage();
      if (!usage) return;

      const m: Map<AgentMessage["role"], number> = new Map();
      const tools: Map<string, number> = new Map();
      for (const entry of ctx.sessionManager.getEntries()) {
        switch (entry.type) {
        case "message": {
          const role = entry.message.role;
          const tokens = estimateTokens(entry.message);
          if (role === "toolResult") {
            const toolName = entry.message.toolName;
            tools.set(toolName, (tools.get(toolName) ?? 0) + tokens);
          } else {
            m.set(role, (m.get(role) ?? 0) + tokens);
          }
          break;
        }
        case "branch_summary":
        case "compaction":
        case "custom":
        case "custom_message":
        case "label":
        case "model_change":
        case "session_info":
        case "thinking_level_change":
          // console.log("unknown entry:", entry);
        }
      }

      const systemPrompt = myEstimateTokens(ctx.getSystemPrompt());
      const toolsDescriptions = myEstimateTokens(JSON.stringify(pi.getActiveTools().map(name => pi.getAllTools().find(tool => tool.name === name))));
      ctx.ui.setWidget("context-usage", printTree({
        name: "Max",
        value: usage.contextWindow,
        children: [
          {
            name: "Context Usage",
            value: usage.tokens!,
            children: [
              {
                name: "fixed",
                children: [
                  { name: "system prompt", value: systemPrompt },
                  { name: "tools descriptions", value: toolsDescriptions },
                ],
              },
              {
                name: "session",
                children: [
                  ...m.entries().map(([role, tokens]) => ({ name: role, value: tokens })),
                  {
                    name: "toolResult",
                    children: [
                      ...tools.entries().map(([role, tokens]) => ({ name: role, value: tokens })),
                    ],
                  },
                ],
              },
            ],
          },
          { name: "Free space", value: usage.contextWindow-usage.tokens!-DEFAULT_COMPACTION_SETTINGS.reserveTokens },
          { name: "Autocompaction buffer", value: DEFAULT_COMPACTION_SETTINGS.reserveTokens },
        ]
      }, usage.contextWindow));
    },
  });
}
