---
name: mine-fix-e2e-classname-join
description: Make `bun run test:e2e` pass by fixing the production `cn()` class-joiner in renderer/lib/utils.ts without touching any test files.
timeout_s: 120
---

Your workspace starts empty. First, recreate the existing (broken) project by creating the following files with exactly this content:

#### `package.json`

```json
{
  "name": "apiary",
  "private": true,
  "scripts": {
    "test:e2e": "bun test renderer/e2e"
  }
}
```

#### `renderer/lib/utils.ts`

```ts
export type ClassValue = string | false | null | undefined;

/**
 * Join class names, skipping falsy values.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter((c) => typeof c === "string").join("");
}
```

#### `renderer/components/input.ts`

```ts
import { cn } from "../lib/utils";

export type InputState = {
  invalid?: boolean;
  disabled?: boolean;
};

/**
 * Build the className for a form input from its state flags.
 */
export function buildInputClass(state: InputState): string {
  return cn("input", state.invalid && "input--invalid", state.disabled && "is-disabled");
}
```

#### `renderer/e2e/form.e2e.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { buildInputClass } from "../components/input";

describe("form input e2e", () => {
  test("invalid state class chain", () => {
    expect(buildInputClass({ invalid: true, disabled: false })).toBe(
      "input input--invalid",
    );
  });

  test("disabled state class chain", () => {
    expect(buildInputClass({ invalid: false, disabled: true })).toBe(
      "input is-disabled",
    );
  });

  test("combined states keep order and single spaces", () => {
    expect(buildInputClass({ invalid: true, disabled: true })).toBe(
      "input input--invalid is-disabled",
    );
  });

  test("no stray whitespace for clean state", () => {
    expect(buildInputClass({ invalid: false, disabled: false })).toBe("input");
  });
});
```

#### `renderer/components/input.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { cn } from "../lib/utils";

describe("cn", () => {
  test("joins with single spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  test("skips falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  test("returns empty string when nothing valid", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
```

Once these files exist, the task is:

In this workspace, `bun run test:e2e` currently fails.

Diagnose the failure and fix it so that `bun run test:e2e` exits with code 0.

Constraints:
- The test suites define the expected behavior. You must NOT modify any file under `renderer/e2e/` and you must NOT modify any `*.test.ts` file (including `renderer/components/input.test.ts`). They must remain byte-for-byte identical to their current content.
- Fix the bug in the production code (the non-test source files).
- Do not add skip/TODO/`test.skip` or otherwise weaken the tests.

When you are done, `bun run test:e2e` must exit 0 and the unit suite `bun test renderer/components/input.test.ts` must also exit 0.
