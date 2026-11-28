#!/usr/bin/env bun
/**
 * pkg-doctor: quick health checks for this package's dependencies.
 * Shells out to the package manager and the TypeScript compiler.
 */

const TIMEOUTS = {
  pmList: 20_000, // bun pm ls
  registryMeta: 15_000, // npm view <pkg>
  install: 60_000, // bun add <pkg>
  typecheck: 60_000, // tsc --noEmit
};

const DEFAULT_TIMEOUT = 60_000;

async function run(cmd: string[], timeoutMs: number = DEFAULT_TIMEOUT): Promise<number> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (stdout.trim()) console.log(stdout.trimEnd());
  if (stderr.trim()) console.error(stderr.trimEnd());
  return code;
}

export async function installPackage(pkg: string): Promise<number> {
  return run(["bun", "add", pkg], TIMEOUTS.install);
}

export async function main(): Promise<void> {
  console.log("== bun pm ls ==");
  await run(["bun", "pm", "ls"], TIMEOUTS.pmList);

  console.log("== npm view cliffy ==");
  await run(["npm", "view", "cliffy", "description", "homepage"], TIMEOUTS.registryMeta);

  console.log("== tsc --noEmit ==");
  await run(["bun", "x", "tsc", "--noEmit"], TIMEOUTS.typecheck);
}

if (import.meta.main) {
  await main();
}
