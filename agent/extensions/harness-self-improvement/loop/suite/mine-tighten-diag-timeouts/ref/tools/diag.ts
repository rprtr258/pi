#!/usr/bin/env bun
// diag.ts — run package diagnostics with generous timeouts so nothing gets cut off early

async function run(label: string, timeoutSecs: number, cmd: string[]) {
  console.log(`-- ${label} (timeout ${timeoutSecs}s)`);
  const proc = Bun.spawn(["timeout", String(timeoutSecs), ...cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  console.log(out.trim() || err.trim() || "(no output)");
  if (code !== 0) console.log(`exit=${code}`);
  return code;
}

const PM_LIST_TIMEOUT = 15;
const NPM_VIEW_TIMEOUT = 15;
const INSTALL_TIMEOUT = 60;
const TSC_TIMEOUT = 60;

await run("pm ls", PM_LIST_TIMEOUT, ["bun", "pm", "ls"]);
await run("cliffy meta", NPM_VIEW_TIMEOUT, ["npm", "view", "cliffy", "description"]);
await run("install", INSTALL_TIMEOUT, ["bun", "add", "@dotrex/command"]);
await run("typecheck", TSC_TIMEOUT, ["bun", "x", "tsc", "--noEmit"]);
