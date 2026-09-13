---
name: lang-javascript
description: >-
  Core JavaScript conventions, idioms, and modern practices. Invoke whenever a task involves
  JavaScript — writing, reviewing, refactoring, or debugging .js/.jsx/.mjs/.cjs files; building
  vanilla JS or Node.js applications; async/await, ESM modules, Node.js APIs, or browser APIs.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: language
  triggers: JavaScript, ES2023, async await, Node.js, vanilla JavaScript, Web Workers, Fetch API, browser API, module system
  role: specialist
  scope: implementation
  output-format: code
  related-skills: typescript, fullstack-guardian
---

# JavaScript Pro

**Clarity is the highest JavaScript virtue. If your code requires a comment to explain its control flow, rewrite it.**

Prefer boring, readable patterns over clever tricks that save characters.

## When to Use This Skill

- Writing, reviewing, refactoring, or debugging any `.js`/`.jsx`/`.mjs`/`.cjs` file
- Building vanilla JavaScript applications and Node.js backend services
- Async/await and Promise patterns, ESM/CJS module systems
- Browser APIs (Web Workers, Service Workers, Fetch) and browser/Node performance

## Core Workflow

1. **Analyze requirements** — Review `package.json`, module system, Node version, browser targets; confirm `.js`/`.mjs`/`.cjs` conventions
2. **Design architecture** — Plan modules, async flows, and error handling strategies
3. **Implement** — Write ES2023+ code following the conventions in this skill
4. **Validate** — Run `eslint --fix`, fix reported issues and re-run; check for memory leaks with DevTools or `--inspect`
5. **Test** — Cover each public function's success and error paths; confirm no unhandled Promise rejections

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Idioms & Naming | [`references/idioms.md`](references/idioms.md) | Naming, equality coercion, falsy values |
| Functions | [`references/functions.md`](references/functions.md) | Arrows, closures, early return |
| Async Patterns | [`references/async.md`](references/async.md) | Combinators, error classes, cancellation, streams |
| Objects & Arrays | [`references/objects-and-arrays.md`](references/objects-and-arrays.md) | Iteration table, destructuring, Map/Set |
| Modules | [`references/modules.md`](references/modules.md) | ESM vs CJS, package.json exports, tree shaking |
| Modern Syntax | [`references/modern-syntax.md`](references/modern-syntax.md) | ES2023+ features |
| Browser APIs | [`references/browser-apis.md`](references/browser-apis.md) | Fetch, Web Workers, Storage |
| Node Essentials | [`references/node-essentials.md`](references/node-essentials.md) | fs/promises, streams, EventEmitter |

## Variables and Declarations

- **`const` by default.** Use `let` only when reassignment is required. Never `var`.
- **`const` prevents reassignment, not mutation.** Objects and arrays declared with `const` can still be mutated.
- **Block scope only.** `let`/`const` are block-scoped; `var` is function-scoped and hoists — this causes bugs in loops
  and conditionals.
- **One declaration per line** (`const` first, then `let`) — never chain `const a = 1, b = 2`.

## Naming

| Entity | Style | Examples |
|---|---|---|
| Variables, functions | camelCase | `userName`, `fetchData` |
| Classes, constructors | PascalCase | `UserService`, `HttpClient` |
| Compile-time constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES`, `API_BASE_URL` |
| Private fields/methods | `#` prefix (class) | `#count`, `#validate()` |
| Booleans | `is`/`has`/`can`/`should` prefix | `isValid`, `hasAccess` |
| File names | kebab-case or camelCase | `user-service.js`, `userService.js` |

- **SCREAMING_SNAKE_CASE is for true compile-time constants only** — never computed values.
- **Descriptive names, few abbreviations** (`url`, `id`, `err`, `ctx`, `req`, `res` only), no redundant context (`car.make`), consistent vocabulary (`getUser()` everywhere). More: [`references/idioms.md`](references/idioms.md).

## Equality and Safety

- **Always `===`/`!==`** (`==` only for `value == null`). **`??` over `||`** for defaults — `||` treats `0`, `""`, `false` as falsy. **`?.` for optional access**, sparingly — expected-missing data should throw.
- Falsy-value list and coercion table: [`references/idioms.md`](references/idioms.md).

## Ternary Operator

- **One-liners or split-per-branch only:** `const label = isActive ? "Active" : "Inactive";` — or one line per branch. Anything else becomes `if`/`else` or early return.
- **Nested ternaries are banned.** Use `if`/`else`, early returns, or a lookup object.

## Modern Syntax

- **Template literals** for interpolation, plain quotes otherwise. **Spread for copies** — never `Object.assign`. **Shorthand properties**, grouped at the top. **Logical assignment** (`??=`, `||=`, `&&=`) for defaults.
- Full ES2023+ tour: [`references/modern-syntax.md`](references/modern-syntax.md); everyday idioms: [`references/idioms.md`](references/idioms.md).

## Functions

- **Arrow functions** for callbacks and anonymous functions. Use function declarations only when hoisting or `this`
  binding is needed.
- **Parenthesize** single arrow params — smaller diffs when adding/removing.
- **Implicit return** for single expressions (no braces). Explicit return (braces) for multi-statement bodies.
- **Arrow functions capture lexical `this`** — they do NOT have their own `this`. For object methods and prototypes, use method shorthand.
- **Destructured options** for 3+ parameters. Self-documenting and order-independent.
- **Default parameters** over `||` — they can reference earlier params.
- **Rest parameters** over `arguments` object. `arguments` is array-like, not a real Array.
- **Early return.** Guard clauses first, happy path flat. Reduce nesting.
- **One function, one job.** If the name contains "and", split it.
- **Keep functions under ~30 lines.** Extract helpers. Use composition over complex branching.
- **Prefer pure functions**; isolate side effects (DOM, network, logging).
- **Closures retain references, not copies** — large captured objects stay alive until the closure is released.
- **Don't mutate parameters** — copy, then modify.
- **JSDoc** on exported and complex functions: types and intent for callers.

## Async

- **`async`/`await` over `.then()` chains** for sequential operations.
- **Always `await` promises.** Missing `await` = floating promise = silent failures.
- **`return await` only inside `try`** to catch the error; otherwise `return promise` directly.
- **`Promise.all`** for independent parallel work. Rejects on first rejection.
- **`Promise.allSettled`** when all results matter regardless of individual failures.
- **`Promise.race`** for timeouts. **`Promise.any`** for fallbacks (rejects only when ALL reject).
- **Avoid sequential awaits in loops** — `Promise.all(items.map(...))`, or a concurrency limiter (`p-map`) for large arrays.
- **Throw `Error` objects**, never strings or plain objects — strings lose stack traces.
- **Custom error classes** to distinguish errors: extend `Error`, set `this.name`.
- **Never swallow errors.** Every `catch` handles, rethrows, or reports — `console.log(err)` alone isn't handling.
- **Let errors propagate** to a top-level handler; wrap `await` in `try`/`catch` only where you handle them.
- **Attach `.catch()` to non-awaited promise chains.** Unhandled rejections crash Node.js. Fire-and-forget:
  `fetchData().catch(reportError)`.
- **`new Promise()`** only to wrap callback APIs — otherwise compose existing promises.
- **`AbortController`** for cancellable async operations: pass `{ signal }` to `fetch` and other APIs.
- **`for await...of`** for async iterables (streams, async generators).
- **Never block the event loop** — no synchronous I/O in Node (`fs.readFileSync`), no heavy CPU work on the browser main thread (use a Web Worker).

## Modules

- **ES modules only.** `import`/`export` for all new code. CommonJS (`require`) is legacy — use only when runtime
  requires it.
- **Named exports** over default exports (they cause inconsistent import naming). Exception: framework conventions (Next.js pages, Remix routes).
- **Don't export mutable `let` bindings.** Export accessor functions instead: `export function getCount()` not
  `export let count`.
- **Imports at the top**, grouped with blank lines: built-in (`node:fs`), external (`express`), internal (`./utils`).
- **Always include file extensions** in import paths — `"./user.js"`, not `"./user"`. Extensionless imports vary across
  runtimes.
- **No directory imports.** Import from the file directly, not from a directory that resolves to `index.js`.
- **No barrel files in subdirectories** — `index.js` re-exports create indirection and hurt tree-shaking. Fine as a package entry enforced via `package.json` `exports`.
- **No circular dependencies.** Extract shared code to a third module, merge tightly coupled modules, or use dependency
  injection.
- **No wildcard re-exports.** Explicit re-exports only — wildcards bypass tree-shaking.
- **Merge imports from the same module** into a single statement.
- **Namespace imports** (`import * as dateFns`) for 5+ imports; named imports below that.
- **Dynamic imports** (`import()`) for code splitting: routes, large conditional deps, feature flags.
- **One concern per module.** If a module exports unrelated functionality, split it.
- **Side-effect imports** (`import "./polyfill.js"`) should be rare. Document why.

## Objects and Arrays

- **Literal syntax.** `{}` and `[]`, never `new Object()` / `new Array()`.
- **Use method shorthand** on objects: `greet() { }` not `greet: function() { }`.
- **Spread for copies.** `{ ...obj }` and `[...arr]`. Prefer over `Object.assign`.
- **Destructure** to extract properties. Prefer parameter destructuring.
- **Dot notation** for static properties, brackets for dynamic: `user.name` vs `user[dynamicKey]`.
- **`Object.hasOwn(obj, key)`** instead of `obj.hasOwnProperty(key)`.
- **Functional array methods** (`map`, `filter`, `find`, `some`, `every`, `flatMap`, `reduce`) over imperative loops for
  data transformation.
- **Always return** in `map`, `filter`, `reduce` callbacks.
- **`Array.from(arrayLike)`** for array-likes; `Array.from(iterable, mapFn)` over `[...iterable].map(mapFn)`.
- **Don't mutate inputs.** Return new objects/arrays. Immutable update patterns: add `[...arr, item]`, remove
  `arr.filter(...)`, update `arr.map(...)`.
- **`for...of`** for side-effect loops. Never `for...in` on arrays.
- **Return objects for multiple values**, not arrays — callers don't depend on order.
- **Never extend built-in prototypes** (`Array.prototype`, `Object.prototype`). Use utility functions or subclasses.

Iteration table and class conventions: [`./references/objects-and-arrays.md`](./references/objects-and-arrays.md).

Use `Map` for non-string or user-provided keys (prototype pollution), `Set` for dedup (`[...new Set(items)]`), generators for lazy sequences.

## Application

When **writing**: apply conventions silently; if the codebase contradicts a convention, follow the codebase and flag the divergence once.

When **reviewing**: state what's wrong and show the fix inline — don't lecture or quote rules.

## Integration

This skill governs JavaScript implementation choices in this agent setup. The **typescript** skill extends this one for
TypeScript projects.
