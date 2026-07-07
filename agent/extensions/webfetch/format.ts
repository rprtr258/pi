import {HTMLRewriter} from "htmlrewriter";
import TurndownService from "turndown"

export async function htmlToText(html: string): Promise<string> {
  let text = "";
  let skipContent = false;
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html));

  await rewriter.text();
  return text.trim();
}

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

export function htmlToMd(html: string): string {
  turndownService.remove(["script", "style", "meta", "link"]);
  return turndownService.turndown(html);
}
