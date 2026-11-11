---
name: mine-lint-clean-wasm-emitter
description: Fix every eslint error in a small WebAssembly emitter by removing debug scaffolding from wasm.ts, without weakening or bypassing the lint configuration.
timeout_s: 120
---

Your workspace starts empty. First, recreate the existing (broken) project by creating the following files with exactly this content:

#### `package.json`

```json
{
  "name": "ef",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "lint": "eslint ."
  },
  "devDependencies": {
    "@eslint/js": "^9.18.0",
    "eslint": "^9.18.0",
    "typescript": "^5.7.0"
  }
}
```

#### `eslint.config.js`

```js
import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-console": "error",
      "no-debugger": "error",
    },
  },
];
```

#### `wasm.ts`

```ts
// ef — minimal WebAssembly module emitter

export type SectionId = 1 | 3 | 7 | 10;

const MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
const VERSION = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

function unsignedLeb128(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return new Uint8Array(out);
}

// __DBGEMIT: scratch buffer used while tracing emits
const debugBuf: number[] = [];

function section(id: SectionId, payload: Uint8Array): Uint8Array {
  // __DBGEMIT: temporary trace, remove before merge
  console.log("emit section", id, payload.length);
  const header = unsignedLeb128(id);
  const len = unsignedLeb128(payload.length);
  const out = new Uint8Array(header.length + len.length + payload.length);
  out.set(header, 0);
  out.set(len, header.length);
  out.set(payload, header.length + len.length);
  return out;
}

export function typeSection(params: number[], results: number[]): Uint8Array {
  const body: number[] = [params.length, ...params, results.length, ...results];
  return section(1, new Uint8Array(body));
}

export function exportSection(name: string, index: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const body = new Uint8Array(1 + nameBytes.length + 1);
  body[0] = nameBytes.length;
  body.set(nameBytes, 1);
  body[1 + nameBytes.length] = 0x00; // func
  const withIndex = new Uint8Array(body.length + 1);
  withIndex.set(body, 0);
  withIndex[body.length] = index;
  return section(7, withIndex);
}

export function emitModule(sections: Uint8Array[]): Uint8Array {
  const total =
    MAGIC.length + VERSION.length + sections.reduce((a, s) => a + s.length, 0);
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  out.set(VERSION, MAGIC.length);
  let off = MAGIC.length + VERSION.length;
  for (const s of sections) {
    out.set(s, off);
    off += s.length;
  }
  return out;
}

// __DBGEMIT: quick self-check while developing
debugger;
```

Once these files exist, run `bun install` once (the devDependencies in `package.json` are already declared) so that `bun run lint` can execute. The task is:

The `lint` script in this repository fails. Run `bun run lint` (equivalently `bunx eslint .`) and fix every reported error.

Constraints:
- Fix the problems in the source code itself (`wasm.ts`).
- Do not modify `eslint.config.js` or the `lint` script in `package.json`.
- Do not add `eslint-disable` comments or otherwise suppress, weaken, or remove any lint rule.
- Keep the public API of `wasm.ts` intact: `typeSection`, `exportSection`, and `emitModule` must still be exported with the same signatures and behavior.
- Remove all leftover debug scaffolding: anything marked with `__DBGEMIT`, stray `console` output, `debugger` statements, and unused debug-only variables.

The task is complete when `bun run lint` exits successfully with no errors and all constraints above hold.
