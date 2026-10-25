---
name: ts-fix-off-by-one
description: Fix an off-by-one loop bug in a TypeScript chunk function.
timeout_s: 120
---
Create a TypeScript module with a known bug, then fix it. Work entirely inside
this workspace with shell commands. No network access is needed.

1. Create `chunk.ts` in this workspace with exactly this content:

   ```ts
   export function chunk<T>(items: T[], size: number): T[][] {
     const out: T[][] = [];
     for (let i = 0; i <= items.length; i += size) {
       out.push(items.slice(i, i + size));
     }
     return out;
   }
   ```

2. The loop bound is wrong: for inputs whose length is a multiple of `size`,
   the function appends a spurious trailing empty array. Fix the off-by-one bug
   so that `chunk` behaves correctly:
   - `chunk([1, 2, 3, 4, 5], 2)` returns `[[1, 2], [3, 4], [5]]`
   - `chunk([1, 2], 2)` returns `[[1, 2]]` (no trailing empty array)
   - `chunk([], 3)` returns `[]`
   - `chunk(["a", "b", "c"], 5)` returns `[["a", "b", "c"]]`
   Keep the exported name `chunk`, the generic signature, and the two-parameter
   behavior (`size` is always a positive integer; do not add extra parameters
   or exports). Do not rewrite the function body from scratch if a one-line fix
   suffices — fix the loop condition or bounds.
3. Leave the file runnable with `bun` (plain TypeScript, no imports, no
   top-level side effects).
