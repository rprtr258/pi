# TypeScript Configuration

## tsconfig.json Essentials

### Base Options (All Projects)

```json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "skipLibCheck": true,
    "target": "es2022",
    "allowJs": true,
    "resolveJsonModule": true,
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- **`esModuleInterop`** → Fixes CJS/ESM interop issues
- **`skipLibCheck`** → Skips `.d.ts` checking for performance
- **`target: "es2022"`** → Stable target; prefer over `esnext`
- **`allowJs`** → Allows `.js` imports in TS projects
- **`resolveJsonModule`** → Enables JSON imports with type safety
- **`moduleDetection: "force"`** → Treats all files as modules (avoids block-scope errors)
- **`isolatedModules`** → Prevents features unsafe in single-file transpilation
- **`verbatimModuleSyntax`** → Forces `import type`/`export type` for type-only imports

### Strictness (All Projects)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

- **`strict`** → Enables all strict checks. Non-negotiable.
- **`noUncheckedIndexedAccess`** → Array/object index access returns `T | undefined`
- **`noImplicitOverride`** → Requires `override` keyword on overridden methods

**Optional strictness** (add per project preference):

- `noImplicitReturns` — all code paths must return
- `noFallthroughCasesInSwitch` — prevent switch fallthrough
- `noUnusedLocals` / `noUnusedParameters` — flag unused code (can be noisy)
- `exactOptionalPropertyTypes` — `?: T` no longer permits `undefined` (prevents a common bug class)
- `noPropertyAccessFromIndexSignature` — forces bracket access for index-signature keys

### Module System

**Transpiling with `tsc` (Node.js):**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "outDir": "dist",
    "sourceMap": true
  }
}
```

`module: "NodeNext"` implies `moduleResolution: "NodeNext"` — supports both ESM and CJS based on `package.json` `"type"`
field.

**Using an external bundler (Vite, esbuild, webpack, Bun):**

```json
{
  "compilerOptions": {
    "module": "preserve",
    "noEmit": true
  }
}
```

`module: "preserve"` implies `moduleResolution: "Bundler"` — lets the bundler handle module resolution while TS focuses
on type checking.

### Library Projects

```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

For monorepo libraries, also add `"composite": true` to enable project references and incremental builds.

### Runtime Environment

**DOM (browser):**

```json
{ "compilerOptions": { "lib": ["es2022", "dom", "dom.iterable"] } }
```

**Server-only (Node.js/Bun):**

```json
{ "compilerOptions": { "lib": ["es2022"] } }
```

## Path Mapping

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Use sparingly. Prefer relative imports; deep `../../../` chains suggest the module structure needs refactoring, not
aliases. If you do map paths in a tsc-transpiled Node project, the runtime also needs the mapping (e.g.
`tsconfig-paths/register`).

## Project References (Monorepos)

Root `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/cli" }
  ]
}
```

Each package config:

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "outDir": "./dist"
  }
}
```

Build the whole graph with `tsc --build` — only changed projects recompile.

## Multiple Configurations

```json
// tsconfig.json — default: dev, tests, IDE
{ "include": ["src/**/*", "tests/**/*"] }

// tsconfig.build.json — production build only
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "tests/**"]
}
```

Build with `tsc -p tsconfig.build.json`.

## Framework-Specific Configs

**React + Vite** — start from `module: "preserve"` / bundler resolution:

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"],
    "module": "preserve",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

**Next.js** — the framework generates most of it; keep `strict: true` and don't edit generated blocks:

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Node.js API (Express, Fastify):**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "target": "es2022",
    "lib": ["es2022"],
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

## Custom Type Definitions

Extend global types in a `.d.ts` file (included by `tsconfig`):

```ts
// types/global.d.ts
declare global {
  interface Window {
    ENV: Record<string, string>;
  }
}

export {};
```

Declare modules without types:

```ts
// types/assets.d.ts
declare module "*.svg" {
  const content: string;
  export default content;
}
```

## Build Optimization

```json
{
  "incremental": true
}
```

- **`incremental`** → Caches compilation in `.tsbuildinfo`; skip files already checked
- **`composite: true`** → Required for project references; implies `incremental`
- **`skipLibCheck: true`** → Skip type checking of declaration files

## Performance Monitoring

```json
{
  "compilerOptions": {
    "explainFiles": true
  }
}
```

- **`tsc --noEmit --extendedDiagnostics`** → Prints timing and memory per compilation phase
- **`explainFiles: true`** → Lists why each file was included in the program
- **`listFiles: true`** → Prints all files in the program

Use when compile times become slow — usually it's too many `include` paths or missing `skipLibCheck`.

## Import Conventions

### Use `import type` for Types

```ts
import type { User } from "./types";
import { createUser } from "./users";

// Inline form:
import { type User, createUser } from "./users";
```

`verbatimModuleSyntax` enforces this. Type imports are erased at compile time and produce no runtime code.

### Use `export type` for Type Re-exports

```ts
export type { User } from "./types";
```

Required for correct behavior with `isolatedModules` and file-by-file transpilation.

### No `namespace`, No `require`

```ts
// Bad:
namespace Foo { ... }
import x = require("foo");

// Good:
export function foo() { ... }
import { foo } from "./foo";
```

ES modules are the only supported module system. `namespace` is legacy.

## Array Type Syntax

- **Simple element type** → `T[]` — e.g. `string[]`, `number[]`, `User[]`
- **Complex element type (union, object)** → `Array<T>` — e.g. `Array<string | number>`
- **Readonly simple** → `readonly T[]` — e.g. `readonly string[]`
- **Readonly complex** → `ReadonlyArray<T>` — e.g. `ReadonlyArray<string | number>`
- **Nested simple** → `T[][]` — e.g. `string[][]`

## Compiler Directives

### `@ts-ignore` and `@ts-expect-error`

**Do not use `@ts-ignore`.** It suppresses all errors on the next line, making future type errors invisible.

**`@ts-expect-error` is acceptable in tests** when deliberately testing invalid usage. It errors when the suppressed
line has no error, so it won't silently mask changes.

```ts
// Bad: hides all errors forever
// @ts-ignore
const x: string = 42;

// Acceptable in tests: documents expected failure
// @ts-expect-error — testing invalid input handling
const result = processString(42);
```

**Prefer narrowing or explicit casts** over suppression. If you must suppress, use `@ts-expect-error` with a comment
explaining why.

### `@ts-nocheck`

Never use `@ts-nocheck` in production code. It disables all type checking for the entire file.

## Project Structure Tips

- **Use `paths` sparingly.** Prefer relative imports. Deep `../../../` chains suggest the module structure needs
  refactoring, not aliases.
- **Keep `tsconfig.json` minimal.** Use `extends` for shared base configs.
- **`include` explicitly.** Don't rely on defaults — specify which directories to compile.
- **Separate `tsconfig.build.json`** for builds (excludes tests, scripts).

## Quick Reference

| Option | Purpose | Recommended |
|--------|---------|-------------|
| `strict` | Enable all strict type checks | Always |
| `noUncheckedIndexedAccess` | Index access returns `T \| undefined` | Always |
| `noImplicitOverride` | Require `override` keyword | Always |
| `exactOptionalPropertyTypes` | `?: T` doesn't allow `undefined` | Optional |
| `verbatimModuleSyntax` | Force `import type`/`export type` | Always |
| `isolatedModules` | Safe single-file transpilation | Always |
| `skipLibCheck` | Skip .d.ts checking | Always |
| `declaration` | Generate `.d.ts` files | Libraries |
| `incremental` | Cache compilation | Large projects |
| `composite` | Enable project references | Monorepos |
