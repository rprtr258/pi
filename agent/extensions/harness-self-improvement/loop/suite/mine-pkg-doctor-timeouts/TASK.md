---
name: mine-pkg-doctor-timeouts
description: Tighten the absurdly long shell-out timeouts in a dependency health-check script (including the default fallback) without breaking the TypeScript.
timeout_s: 120
---

Your workspace starts empty. First, recreate the existing project by creating the following files with exactly this content:

#### `package.json`

```json
{
  "name": "md",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "doctor": "bun index.ts"
  },
  "dependencies": {
    "@dotrex/command": "^0.3.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/bun": "^1.1.0"
  }
}
```

#### `index.ts`

```ts
#!/usr/bin/env bun
/**
 * pkg-doctor: quick health checks for this package's dependencies.
 * Shells out to the package manager and the TypeScript compiler.
 */

const TIMEOUTS = {
  pmList: 300_000, // bun pm ls
  registryMeta: 600_000, // npm view <pkg>
  install: 900_000, // bun add <pkg>
  typecheck: 600_000, // tsc --noEmit
};

const DEFAULT_TIMEOUT = 300_000;

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
```

Once these files exist, the task is:

This workspace contains `pkg-doctor`, a small Bun script (`index.ts`) that shells out to package managers and the TypeScript compiler to health-check the project's dependencies.

The script's timeouts are far too long: a hung registry request or a stalled install blocks the script for many minutes before it gives up. Tighten them so a stuck subprocess is killed quickly:

- `TIMEOUTS.pmList` (the `bun pm ls` step): at most 20 seconds
- `TIMEOUTS.registryMeta` (the `npm view <pkg>` step): at most 15 seconds
- `TIMEOUTS.install` (the `bun add <pkg>` helper): at most 60 seconds
- `TIMEOUTS.typecheck` (the `tsc --noEmit` step): at most 60 seconds
- `DEFAULT_TIMEOUT` (the fallback used when a caller passes no explicit timeout): at most 60 seconds

Constraints:
- Keep the same constant names and the overall structure of the script; only the timeout values (and nothing else) should need to change.
- Every timeout must remain a positive number of milliseconds.
- `index.ts` must remain valid TypeScript after your edit.

Do not add dependencies or modify any other files.
