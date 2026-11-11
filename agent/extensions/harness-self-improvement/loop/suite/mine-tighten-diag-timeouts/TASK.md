---
name: mine-tighten-diag-timeouts
description: Tighten excessive shell-command timeouts in a diagnostic script while keeping long-running steps (install, typecheck) generous, and register an npm script for it.
timeout_s: 120
---

The diagnostic script `tools/diag.ts` in this repo shells out to package-manager commands, but its timeouts are far too long: when a registry lookup hangs, the script stalls for minutes.

Fix the timeouts in `tools/diag.ts` as follows:

- Quick operations — the package listing (`bun pm ls`) and the registry metadata lookup (`npm view ...`) — must time out after **at most 20 seconds** (pick a sensible positive value).
- The dependency install (`bun add @dotrex/command`) and the typecheck (`bun x tsc --noEmit`) legitimately take a while on cold caches. Keep both at **60 seconds**. Do NOT set them below 45 seconds — the install will spuriously fail on a slow network, which is exactly the regression we want to avoid.

Do not change the script's output format, the commands being run, or anything else about its behavior.

Also add a `diag` script to `package.json` that runs `tools/diag.ts` with bun, so it can be invoked as `bun run diag`.

When done, verify the TypeScript still compiles cleanly with `bun x tsc --noEmit`.
