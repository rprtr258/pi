# Declaration Details

Companion to lang-typescript: overloads, class patterns, callback types, branded types, and array type syntax.

## Overloads

- **Prefer union types over overloads** when parameter types differ but logic is shared.
- **Prefer optional parameters over overloads** when signatures differ only in trailing params.
- **When overloads are necessary**, put specific signatures before general ones — TypeScript picks the first matching overload.

## Class Patterns

- **Omit `public`** — it's the default. Only use `public` on non-readonly constructor parameter properties.
- **Use `private`** for internal state, `protected` for subclass access.
- **Use `readonly`** on properties never reassigned after construction.
- **Use constructor parameter properties** to avoid boilerplate: `constructor(private readonly db: Database) {}`.
- **Initialize fields where declared** when possible: `private count = 0`.
- **Require `override` keyword** on overridden methods (`noImplicitOverride`).

## Callback Types

- **Use `void` return** for callbacks whose return value is ignored.
- **Don't use optional parameters in callbacks** — callers can always ignore extra args.
  `(data: unknown, elapsed: number) => void` not `(data: unknown, elapsed?: number) => any`.

## Branded Types

Use branded types for nominal-like safety when structural typing is too permissive: domain IDs (`UserId` vs `OrderId`),
validated strings (`Email`), units (`Meters` vs `Kilometers`). Pattern:
`type UserId = string & { readonly __brand: unique symbol }`. Keep the branding mechanism consistent across the project
— `unique symbol` is most robust.

## Array Type Syntax

Use `T[]` for simple element types (`string[]`, `User[]`). Use `Array<T>` for complex element types
(`Array<string | number>`). Same rule applies to readonly variants.
