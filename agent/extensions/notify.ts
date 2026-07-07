/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 *
 */
import {execFile} from "child_process";
import type {ExtensionAPI} from "@mariozechner/pi-coding-agent";

function notify(title: string, body: string): void {
  execFile("notify-send", [title, body]);
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    notify("Pi", "Ready for input");
  });
}
