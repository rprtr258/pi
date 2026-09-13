# Generics and Type-Level Programming

Generics allow components to work over a variety of types while preserving type safety. Use them to write reusable,
type-safe abstractions — but keep them as simple as possible.

## Generic Functions

```ts
function identity<T>(arg: T): T {
  return arg;
}

// Inference works — don't specify the type argument when it's obvious:
const result = identity("hello"); // result: string
```

### Generic Constraints

Constrain type parameters with `extends` to access specific properties:

```ts
interface Lengthwise {
  length: number;
}

function logLength<T extends Lengthwise>(arg: T): T {
  console.log(arg.length);
  return arg;
}

logLength("hello");      // OK: string has length
logLength([1, 2, 3]);    // OK: array has length
logLength(42);           // Error: number has no length
```

Multiple type parameters can constrain each other:

```ts
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}

const merged = merge({ name: "Alice" }, { age: 30 });
merged.name; // string
merged.age;  // number
```

### Using Type Parameters in Constraints

```ts
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const person = { name: "Alice", age: 30 };
getProperty(person, "name"); // OK: "name" is keyof typeof person
getProperty(person, "foo");  // Error: "foo" is not a key
```

### Generic Parameter Defaults

```ts
interface Container<T, U = T[]> {
  element: T;
  children: U;
}

// U defaults to T[] when not specified:
const c: Container<string> = {
  element: "hello",
  children: ["world"],
};
```

## Utility Types

TypeScript's standard library includes essential type operators. See `./utility-types.md` for the full catalog with
custom utility type implementations.

### Object Transformation

- **`Partial<T>`** → All properties optional
- **`Required<T>`** → All properties required
- **`Readonly<T>`** → All properties readonly
- **`Pick<T, Keys>`** → Subset of properties
- **`Omit<T, Keys>`** → All except specified properties
- **`Record<Keys, T>`** → Object with specified keys and value type

```ts
interface User {
  name: string;
  email: string;
  age: number;
}

type UserUpdate = Partial<User>;
// { name?: string; email?: string; age?: number }

type UserPreview = Pick<User, "name" | "email">;
// { name: string; email: string }

type UserWithoutAge = Omit<User, "age">;
// { name: string; email: string }
```

### Union Manipulation

- **`Exclude<Union, Excluded>`** → Remove members from union
- **`Extract<Union, Extracted>`** → Keep only matching members
- **`NonNullable<T>`** → Remove `null` and `undefined`

```ts
type T = Exclude<"a" | "b" | "c", "a">; // "b" | "c"
type U = NonNullable<string | null>;      // string
```

### Function Types

- **`ReturnType<T>`** → Extract return type
- **`Parameters<T>`** → Extract parameter types as tuple
- **`Awaited<T>`** → Unwrap Promise types recursively
- **`NoInfer<T>`** → Block inference at this position

```ts
function fetchUser(id: string): Promise<User> { ... }

type FetchReturn = ReturnType<typeof fetchUser>;  // Promise<User>
type FetchParams = Parameters<typeof fetchUser>;  // [id: string]
type ResolvedUser = Awaited<ReturnType<typeof fetchUser>>; // User
```

### `NoInfer<T>` (TS 5.4+)

Prevents a parameter from being used as an inference site:

```ts
function createConfig<C extends string>(
  colors: C[],
  defaultColor?: NoInfer<C>,
) { ... }

createConfig(["red", "green"], "red");  // OK
createConfig(["red", "green"], "blue"); // Error
```

## Conditional Types

Types that act like if-statements in the type system:

```ts
type IsString<T> = T extends string ? true : false;

type A = IsString<"hello">; // true
type B = IsString<42>;      // false
```

### `infer` Keyword

Extract types from within conditional checks:

```ts
type ElementType<T> = T extends Array<infer E> ? E : T;

type A = ElementType<string[]>; // string
type B = ElementType<number>;   // number

type UnwrapReturn<T> = T extends (...args: never[]) => infer R ? R : never;
```

Conditional types can be nested for recursive inference:

```ts
type Flatten<T> = T extends Array<infer E>
  ? Flatten<E>
  : T;

type A = Flatten<number[][]>; // number
```

### Distributive Behavior

Conditional types distribute over unions:

```ts
type ToArray<T> = T extends any ? T[] : never;

type Result = ToArray<string | number>;
// string[] | number[]  (not (string | number)[])
```

Wrap in `[T]` to prevent distribution:

```ts
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;

type Result = ToArrayNonDist<string | number>;
// (string | number)[]
```

## Mapped Types

Transform all properties of a type:

```ts
type Optional<T> = {
  [P in keyof T]?: T[P];
};

// Remove readonly:
type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

// Remove optional:
type Concrete<T> = {
  [P in keyof T]-?: T[P];
};
```

### Key Remapping with `as`

```ts
type Getters<T> = {
  [P in keyof T as `get${Capitalize<string & P>}`]: () => T[P];
};

interface Person { name: string; age: number }
type PersonGetters = Getters<Person>;
// { getName: () => string; getAge: () => number }
```

Filter keys by producing `never`:

```ts
type RemoveKind<T> = {
  [P in keyof T as Exclude<P, "kind">]: T[P];
};
```

## Template Literal Types

String manipulation at the type level:

```ts
type EventName<T extends string> = `${T}Changed`;

type Result = EventName<"name" | "age">;
// "nameChanged" | "ageChanged"
```

Intrinsic string types: `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize`.

Extract from patterns:

```ts
type ExtractRouteParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

type Params = ExtractRouteParams<"/users/:userId/posts/:postId">;
// { userId: string; postId: string }
```

## Recursive Types

Types that reference themselves:

```ts
type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
```

Infer deep paths from nested objects:

```ts
type PathsToProps<T> = T extends object
  ? {
      [K in keyof T]: T[K] extends object
        ? K | `${K & string}.${PathsToProps<T[K]>}`
        : K;
    }[keyof T]
  : never;

type Person = {
  name: string;
  address: { city: string; zip: string };
};

type PersonPaths = PathsToProps<Person>;
// "name" | "address" | "address.city" | "address.zip"
```

## Variance

Structural typing makes most types covariant, but function parameters are contravariant:

```ts
class Animal { name = "Animal" }
class Dog extends Animal { breed = "Lab" }

// Covariant: Dog[] is assignable to Animal[]
const dogs: Dog[] = [];
const animals: Animal[] = dogs; // OK

// Contravariant: parameter types invert in function types
type Handler<T> = (item: T) => void;

const animalHandler: Handler<Animal> = (animal) => { /* ... */ };
const dogHandler: Handler<Dog> = animalHandler; // OK: Handler<Animal> accepts Dogs
// const animalHandler2: Handler<Animal> = dogHandler; // Error under strictFunctionTypes
```

## Type-Level Programming

Compute types the way you compute values:

```ts
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;

type Concat<A extends string, B extends string> = `${A}${B}`;
type Full = Concat<"Hello, ", "World">; // "Hello, World"

type Length<T extends readonly unknown[]> = T["length"];
type Three = Length<[string, number, boolean]>; // 3

type If<C extends boolean, T, F> = C extends true ? T : F;
type Result = If<true, string, number>; // string
```

Use for library and framework code; see the complexity budget below before reaching for these in application code.

## Complexity Budget

Type-level programming is powerful but has real costs:

- Every complex type adds cognitive load for all readers
- IDE performance degrades with deeply nested conditional/mapped types
- Error messages become cryptic when types are too abstract

**Rule of thumb:** If you can't explain what a type does in one sentence, it's too complex. Split it, simplify it, or
use explicit interfaces instead.

### Complexity Tiers

- **Simple** (`interface`, `type` alias, union) → Always — default choice
- **Moderate** (`Partial`, `Pick`, `Omit`, `Record`) → Well-known transformations
- **Advanced** (Conditional, mapped, template literal) → Library code, framework types
- **Expert** (Recursive types, complex `infer` chains) → Rarely — last resort

Stay at the lowest tier that solves your problem.

## Best Practices

- **Use the simplest construct that works.** Interface extension over `Pick`. Explicit properties over mapped types.
  Repetition is cheaper than complexity.
- **Mapped and conditional types are powerful but costly** — they hurt readability, IDE performance, and refactoring.
  Use only when the alternative is worse.
- **Avoid return-type-only generics.** If a generic parameter appears only in the return type, it cannot be inferred and
  forces callers to guess.
- **Prefer built-in utility types** over hand-rolling equivalents.
- **Keep generic constraints tight** — `<T extends Record<string, unknown>>` is better than `<T extends object>` when
  you need string keys.

### When to Use Utility Types vs Explicit Interfaces

**Prefer explicit interfaces** when:

- The type represents a distinct domain concept
- The shape is referenced in many places
- Readability matters more than DRY

**Use utility types** when:

- Deriving a type from an existing one is unambiguous
- The transformation is a well-known pattern (e.g., update payload = `Partial<T>`)
- The source type is the canonical definition

```ts
// Good: Partial communicates intent clearly
function updateUser(id: string, changes: Partial<User>): void {}

// Bad: Pick where a purpose-named interface is clearer
type LoginInfo = Pick<User, "email" | "passwordHash" | "lastLogin" | "mfaEnabled">;

// Better: explicit interface with a meaningful name
interface LoginInfo {
  email: string;
  passwordHash: string;
  lastLogin: Date;
  mfaEnabled: boolean;
}
```

## Quick Reference

| Pattern | Example | Use Case |
|---------|---------|----------|
| Generic function | `identity<T>(arg: T): T` | Type-safe pass-through |
| Generic constraint | `<T extends Lengthwise>` | Access specific properties |
| Generic default | `<T, U = T[]>` | Optional type arguments |
| Conditional type | `T extends X ? Y : Z` | Type branching |
| Type inference | `T extends infer U` | Extract nested types |
| Mapped type | `{ [K in keyof T]: T[K] }` | Transform properties |
| Template literal | `` `${T}Event` `` | String type patterns |
| Recursive type | `T extends object ? Deep<T> : T` | Nested structures |
| Type-level computation | `Equal`, `Concat`, `Length` | Library/framework code |
