import {createFindTool, type ExtensionAPI} from "@mariozechner/pi-coding-agent";
import writeTool from "./write.ts";
import lsTool from "./ls.ts";

export default function (pi: ExtensionAPI) {
  let cwd = "";
  pi.on("session_start", (_, ctx) => {
    cwd = ctx.cwd;
  });

  pi.registerTool(lsTool);
  pi.registerTool(createFindTool(cwd));
  pi.registerTool(writeTool);
  // pi.registerTool(grepTool);
}
