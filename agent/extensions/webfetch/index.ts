import {Text, type Component} from "@mariozechner/pi-tui";
import {type ExtensionAPI, type AgentToolResult, type ToolDefinition, Theme, type ToolRenderResultOptions, keyHint} from "@mariozechner/pi-coding-agent";
import {Type, type Static} from "@sinclair/typebox";
import {htmlToText, htmlToMd} from "./format";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

const Params = Type.Object({
  url: Type.String({description: "The URL to fetch content from"}),
  format: Type.Enum({
    text: "text",
    markdown: "markdown",
    html: "html",
  }, {description: "The format to return the content in (text, markdown, or html)"}),
  timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds (max 120)" })),
});
type ParamsType = Static<typeof Params>;

type Result = {
  content: string,
};

const tool: ToolDefinition<typeof Params, Result> = {
  name: "webfetch",
  label: "webfetch",
  description: `- Fetches content from a specified URL
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
- IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- The prompt should describe what information you want to extract from the page
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL`,
  parameters: Params,
  async execute(toolCallId, params, signal): Promise<AgentToolResult<Result>> {
    // Validate URL
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://");
    }

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = {
      markdown: "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
      text: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
      html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1",
    }[params.format] ?? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";

    const response = await fetch(params.url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": acceptHeader,
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`);
    }

    // Check content length
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      // TODO: cut instead
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      // TODO: cut instead
      throw new Error("Response too large (exceeds 5MB limit)");
    }

    const content = new TextDecoder().decode(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? "";

    // Handle content based on requested format and actual content type
    const text = await (async () => {
      if (params.format === "markdown" && contentType.includes("text/html")) {
        return htmlToMd(content)
      }
      if (params.format === "text" && contentType.includes("text/html")) {
        return await htmlToText(content)
      }
      return content;
    })();
    return {
      content: [
        {type: "text", text: text, textSignature: "content"},
      ],
      details: {content},
    };
  },
  renderCall(args: ParamsType, theme: Theme, context): Component {
    const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatCall(args, theme));
    return text;
  },
  renderResult(result: AgentToolResult<Result>, options: ToolRenderResultOptions, theme: Theme, context): Component {
    const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
    text.setText(formatResult(result.details, options, theme));
    return text;
  },
};

function formatCall(args: ParamsType, theme: Theme): string {
  let text = theme.fg("toolTitle", theme.bold("webfetch")) +
    " " +
    theme.fg("accent", args.url);
  if (args.format !== "html") {
    theme.fg("toolOutput", ` (${args.format} format)`);
  }
  if (args.timeout !== undefined) {
    text += theme.fg("toolOutput", ` (timeout ${args.timeout})`);
  }
  return text;
}

function formatResult(result: Result, options: ToolRenderResultOptions, theme: Theme): string {
  const lines = result.content.trim().split("\n");
  const maxLines = options.expanded ? lines.length : 20;
  const displayLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  let text = displayLines.map(line => theme.fg("toolOutput", options.expanded ? line : line.slice(0, 97) + "...")).join("\n");
  if (remaining > 0) {
    text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
  }
  // TODO: show error
  return text;
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool(tool);
}
