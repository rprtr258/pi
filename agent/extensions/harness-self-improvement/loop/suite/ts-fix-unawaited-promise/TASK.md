---
name: ts-fix-unawaited-promise
description: Fix a missing await on a promise in an async TypeScript function.
timeout_s: 120
---
Create a TypeScript module with an async bug, then fix it. Work entirely inside
this workspace with shell commands. No network access is needed.

1. Create `fetch-total.ts` in this workspace with exactly this content:

   ```ts
   type Price = { item: string; cents: number };

   async function loadPrices(): Promise<Price[]> {
     return [
       { item: "tea", cents: 250 },
       { item: "cup", cents: 900 },
     ];
   }

   export async function totalCents(): Promise<number> {
     const prices = loadPrices(); // BUG: promise not awaited
     return prices.reduce((sum, p) => sum + p.cents, 0);
   }
   ```

2. `loadPrices()` returns a promise; calling `.reduce` on it throws at runtime,
   so `totalCents()` always rejects. Fix the bug so `totalCents()` resolves to
   the correct total:
   - `await totalCents()` returns `1150`
   - `totalCents()` must be an async function returning a Promise, as before.
   Keep the exported name `totalCents` and the `loadPrices` helper unchanged
   apart from the fix. Do not restructure the code.
3. Leave the file runnable with `bun` (plain TypeScript, no imports, no
   top-level side effects).
