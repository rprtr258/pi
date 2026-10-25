---
name: ts-fix-wrong-export
description: Fix a TypeScript module that only has a default export where a named export is required.
timeout_s: 120
---
Create a TypeScript module with the wrong export shape, then fix it. Work
entirely inside this workspace with shell commands. No network access is
needed.

1. Create `pricing.ts` in this workspace with exactly this content:

   ```ts
   export default function formatPrice(cents: number): string {
     return "$" + (cents / 100).toFixed(2);
   }
   ```

2. Consumers import it as `import { formatPrice } from "./pricing"` — a named
   export — but the module only has a default export. Fix the export shape so
   that `formatPrice` is available as a NAMED export from `pricing.ts`. Keep
   the function's behavior exactly the same:
   - `formatPrice(1250)` returns `"$12.50"`
   - `formatPrice(5)` returns `"$0.05"`
   - `formatPrice(0)` returns `"$0.00"`
   Do not rename the function, change its signature, or add extra exports.
3. Leave the file runnable with `bun` (plain TypeScript, no imports, no
   top-level side effects).
