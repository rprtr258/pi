---
name: mine-fix-e2e-duration-formatting
description: Make `bun run test:e2e` pass by fixing a rounding bug in a renderer utility, without touching the tests
timeout_s: 120
---

In this workspace, `bun run test:e2e` currently fails.

Diagnose the failure and fix the underlying implementation so the command exits 0.

Hard constraints:
- Do NOT edit, delete, rename, skip, or weaken any test file. In particular `renderer/e2e/utils.e2e.test.ts` and `renderer/components/input.test.ts` must keep their exact current content and all their assertions.
- Do NOT change the `test:e2e` script in `package.json`; it must still run the bun test suite.
- The fix must be in the application source (e.g. `renderer/lib/utils.ts`).

`bun` is installed and available on PATH. When you believe you are done, run `bun run test:e2e` and confirm it exits 0.
