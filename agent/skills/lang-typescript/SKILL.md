---
name: lang-typescript
description: >-
  TypeScript type system, strict mode, and TS-specific patterns beyond JavaScript fundamentals.
  Invoke whenever a task involves any interaction with TypeScript code — writing, reviewing,
  refactoring, or debugging .ts/.tsx files, type definitions, generics, conditional/mapped types,
  narrowing, type guards, branded types, utility types, tsconfig, monorepo project references, or
  type-level programming. triggers: TypeScript, generics, type safety, conditional types, mapped types, tsconfig, type guards, discriminated unions, strict mode, narrowing, branded types, type-level programming
---

# TypeScript

<prerequisite>
This skill extends the JavaScript skill. Load `lang-javascript` first — naming,
ternary operator rules, async patterns, and module conventions are defined there and
not duplicated here.
</prerequisite>

**Types encode intent. Let the compiler prove the rest.** Write types that express your domain; let inference handle the obvious. Never fight the type system — if you need `as` or `any`, the types are wrong.

## Verification

- **Run `tsc --noEmit` before and after changes** — confirm zero errors before proceeding.
- **Validate public API return types** — exported functions and methods should have explicit return types.

## References

- [references/generics.md](./references/generics.md) — generics and type-level programming: constraints, conditional/mapped types, `infer`, template literals, variance, recursion
- [references/utility-types.md](./references/utility-types.md) — utility types: `Partial`/`Pick`/`Omit`/`Record`, extraction, tuple/string/function utilities
- [references/narrowing.md](./references/narrowing.md) — narrowing, guards, discriminated unions: examples, exhaustive switch, predicates, assertion functions
- [references/configuration.md](./references/configuration.md) — tsconfig options, module resolution, project setup: base/strict/module configs, project references, framework configs
- [references/patterns.md](./references/patterns.md) — declaration patterns, branded types, enums: interface vs type, assertion patterns, enum anti-patterns, callback types
- [references/design-patterns.md](./references/design-patterns.md) — type-safe design patterns: builder/factory/repository/API client, Result/Either, state machines, decorators
- [references/declaration-details.md](./references/declaration-details.md) — overloads, class modifiers, callback types, branded types, array syntax

## Type Safety

- **Don't introduce TypeScript into plain JavaScript repositories**, and don't add `tsconfig.json` to them.
- **`strict: true` always** in TypeScript projects. It enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and other critical checks.
- **`unknown` over `any`.** Narrow with type guards; `any` disables type checking entirely. Reserve `any` for incremental JS→TS migration or test mocks — with a comment why.
- **No non-null assertions (`!`) without justification.** Prefer narrowing; if `!` is truly needed, comment why the value cannot be null.
- **No type assertions (`as`) for object literals.** Use annotations (`: Foo`) instead — assertions hide missing/extra property errors.

### `unknown` vs `any` Decision

- **Value from external source (API, JSON.parse, user input)** → `unknown`
- **Function accepts anything, passes through without touching** → `unknown`
- **Migrating JS to TS incrementally** → `any` (temporary, with comment)
- **Test mock that intentionally bypasses type checking** → `any` (with comment)

### The `{}` Type

`{}` means "any non-nullish value" — almost never what you want. `unknown` accepts everything (null, undefined, primitives, objects); `object` is non-primitive non-null; `Record<string, unknown>` is dict-like. Prefer `unknown` for opaque values, `Record<string, unknown>` for dict-like objects, `object` for "any non-primitive".

## Type Annotations

- **Omit trivially inferred types.** Don't annotate `const x: number = 5`.
- **Annotate complex return types** when inference produces opaque or wide types.
- **Annotate function signatures at API boundaries** — exported functions and public methods get explicit parameter and return types.
- **Use `import type` for type-only imports** (enforced by `verbatimModuleSyntax`); `export type` for re-exports (required by `isolatedModules`).
- **Annotate at declaration** so errors appear where the bug is, not at distant call sites.

## Interfaces and Types

- **`interface` for object shapes** — better error messages, IDE support, performance. **`type` for everything else** — unions, intersections, tuples, function types, mapped/conditional types. Stay consistent within a project.
- **No empty interfaces** — use a branded type or discriminated union as a marker.
- **No `namespace`** (use ES modules). **No wrapper types** — `string` not `String`.
- **Interfaces for data shapes, not classes** — a class used purely as a data shape adds overhead.

## Null Handling

- **Prefer optional `?` over `| undefined`** for fields and parameters.
- **Don't include `null`/`undefined` in type aliases** — keep nullability at the use site: `function getUser(): User | null`, not `type MaybeUser = User | null`.
- **Null narrowing:** `!= null` checks both null and undefined (the one valid `==` use); `?.` for optional access; `??` for defaults.

## Generics

- **Name type parameters descriptively** when meaning is non-obvious (`TKey`, `TItem`); `T` is fine for single-parameter generics.
- **Constrain with `extends`** when possible: `<T extends string>` beats `<T>`. Keep constraints tight — `<T extends Record<string, unknown>>` beats `<T extends object>` when you need string keys.
- **Every generic must appear in the signature** — no unused or return-type-only type parameters (those can't be inferred, forcing callers to guess).
- **Let inference work:** `identity("hello")`, not `identity<string>("hello")`.
- **Relate parameters:** `<T, K extends keyof T>`. **Defaults:** `interface Container<T, U = T[]>`.
- **`NoInfer<T>`** (TS 5.4+) stops a parameter from being an inference site — for parameters constrained by other params, not driving inference.

### Utility Types

Prefer built-in utility types over hand-rolling: `Partial`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `ReturnType`, `Parameters`, `Awaited`, `NoInfer`. Use explicit interfaces when the type is a distinct domain concept. Full catalog: [references/utility-types.md](./references/utility-types.md).

Conditional (`T extends U ? X : Y`), mapped (`{ [P in keyof T]: ... }`), and template literal types are advanced tools — for library/framework code. See [references/generics.md](./references/generics.md) for distributivity, `infer`, modifier removal, key remapping.

### Complexity Budget

- **Simple** (`interface`, `type` alias, union) → default choice
- **Moderate** (`Partial`, `Pick`, `Omit`, `Record`) → well-known transformations
- **Advanced** (conditional, mapped, template literal) → library/framework code
- **Expert** (recursive types, complex `infer` chains) → last resort

Stay at the lowest tier that solves the problem. If you can't explain a type in one sentence, split or simplify it.

## Narrowing

- **Prefer discriminated unions** for variant types — add a `kind`/`type` literal field per variant. Use exhaustive switches: `default: { const _exhaustive: never = value; return _exhaustive; }` catches unhandled variants at compile time.
- **Type predicates for reusable guards:** `function isFish(pet: Animal): pet is Fish`. Assertion functions for boundary validation: `function assertIsError(value: unknown): asserts value is Error`.
- **`typeof`, `instanceof`, `in`** narrow natively — but `typeof null === "object"`, so check for `null` first. With optional props, `"swim" in animal` narrows to `Fish | Human`, not just `Fish`.
- **Truthiness narrowing fails on `""`, `0`, `NaN`, `false`** — prefer explicit checks when these are valid values.
- **Equality narrows:** `x === y` narrows both operands to their common type.

## Enums

- **Prefer union types** for simple string literals: `type Status = "active" | "inactive"`; a `const object` with `as const` covers cases needing a runtime object. Use enums when you need iteration/lookup, a namespace, or reverse mapping.
- **String enums over numeric** when an enum is needed — always assign explicit values, never mix member types.
- **Never coerce enums to booleans:** compare explicitly (`level !== Level.NONE`), not `!!level` — numeric `0` is falsy.

## Type Assertions

- **Prefer annotations over assertions** — `: Foo` catches errors, `as Foo` hides them.
- **`as` syntax only**, never angle brackets (`<Foo>value` conflicts with JSX).
- **Use `satisfies` to validate literals** (configs, maps, route tables) — checks the value while preserving the narrower inferred type, unlike `as`.
- **Justified when you know more than the compiler:** `JSON.parse` results, DOM APIs returning wider types, trusted external sources. Double assertions go through `unknown` (`value as unknown as Foo`), never `any`.

## Overloads, Classes, Callbacks, Branded Types, Arrays

Detailed guidance: [references/declaration-details.md](./references/declaration-details.md). Essentials:

- **Overloads:** prefer unions (shared logic) or optional params (trailing differences); when necessary, specific signatures first.
- **Classes:** omit `public` (default); `private`/`protected` for state; `readonly` on never-reassigned properties; parameter properties to avoid boilerplate; initialize where declared; require `override` (`noImplicitOverride`).
- **Callbacks:** `void` return when the value is ignored; no optional parameters.
- **Branded types** for nominal-like safety (domain IDs, validated strings, units): `type UserId = string & { readonly __brand: unique symbol }`, consistent across the project.
- **Arrays:** `T[]` for simple element types, `Array<T>` for complex; same for readonly variants.

## Configuration (tsconfig.json)

- **`strict: true` always**, plus `noUncheckedIndexedAccess` and `noImplicitOverride`.
- **Module resolution:** `"NodeNext"` when transpiling with tsc; `"preserve"` with external bundlers (Vite, esbuild, Bun). `verbatimModuleSyntax: true` in both cases.
- **Target:** `es2022`; add `dom` to `lib` for browser projects.
- **Never `@ts-ignore`.** Use `@ts-expect-error` in tests only, with a comment; never `@ts-nocheck` in production.
- **Keep it minimal:** `extends` for shared configs; separate `tsconfig.build.json` for builds (excludes tests/scripts).
- **Libraries:** `declaration: true`, `declarationMap: true`; `composite: true` for monorepo project references.

Full options catalog, project references, framework configs, and diagnostics: [references/configuration.md](./references/configuration.md).

## Application

**Writing:** apply all conventions silently; match the project's existing patterns (interface vs type, enum style); if the repository contradicts a convention, follow the repository and flag the divergence once.

**Reviewing:** cite the specific issue and show the fix inline — state what's wrong and how to fix it, don't lecture.

## Integration

The **lang-javascript** skill is a prerequisite: it governs code patterns; this skill governs type-level choices for repositories that already use TypeScript.
