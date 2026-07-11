# Writing a Language Specification

Reference detail behind the *Designing a Language* steps in `SKILL.md`: the full section-by-section spec checklist and an example design sketch.

## Creating a Language Specification

When asked to design a language, aim to produce a **complete specification** that could be implemented by a compiler writer. Focus on **thorough design rationale**, especially for complex features like ownership systems, async/await, or dependent types—explain why they are included, how they interact, and their implementation trade‑offs. Present the specification in **logical dependency order**: start with lexical syntax, then expressions, types, memory management, concurrency, standard library, and finally tooling and sample programs. This ensures lower‑level concepts are defined before higher‑level ones that depend on them. **Always include a section on the standard library** (even if minimal) to show practical ecosystem considerations. A good spec includes:

### 1. Language Philosophy & Core Idea
- **Elevator pitch**: One‑sentence summary (e.g., "Rust is safe C with OCaml's expressivity", "Zig is better C with full control over everything").
- **Design goals** in priority order (safety, performance, simplicity, etc.).
- **Target domain** (systems, embedded, scripting, etc.) and **audience**.

### 2. Grammar & Syntax
- **Lexical grammar**: Tokens, identifiers, literals, comments.
- **Concrete syntax**: BNF or EBNF for major constructs (expressions, statements, declarations).
- **Keywords list** and **reserved words**.
- **Operator precedence** and **associativity** tables.
- **Visual examples** of typical code (idiomatic style).

### 3. Type System
- **Type grammar**: How types are written (e.g., `Array<Int>`, `Result<T, E>`).
- **Built‑in types** (integers, floats, strings, booleans, unit).
- **Composite types** (structs, enums, tuples, arrays, slices).
- **Type inference** rules (what can be inferred, what must be annotated).
- **Subtyping**, **variance**, **coercions** (if any).
- **Generics** (type parameters, constraints, monomorphization vs. boxing).

### 4. Memory Management
- **Safety philosophy**: Choose a safety approach that matches the language's goals. For simplicity, consider compile-time checks (like Zig's `comptime`), linear types, capabilities, or region-based memory instead of complex borrow checking. Borrow checking (Rust-style) is powerful but adds significant cognitive load; only include it if safety is the highest priority and you can provide excellent tooling.
- **Ownership model** (if any): Borrowing, lifetimes, move semantics. If used, explain how lifetimes are tracked (inferred, explicit, or both) and how they prevent use-after-free.
- **Allocation strategies**: Stack, heap, arenas, pools. Consider providing allocator interfaces (like Zig's `std.mem.Allocator`) to let programmers choose allocation policies.
- **Resource cleanup**: Destructors (RAII) automatically release resources when objects go out of scope. `defer` (Zig) or `finally` (Java) execute code at scope exit, useful for cleanup that doesn't map to object lifetimes. Choose one primary mechanism to avoid confusion—don't include both RAII and `defer` unless they serve distinct purposes.
- **Garbage collection** (tracing, reference counting, hybrid) or **manual** management. Manual management can be made safer with arenas, borrow checking, or linear types.

### 5. Concurrency & Parallelism
- **Threading model** (OS threads, green threads, async/await).
- **Synchronization primitives** (mutexes, channels, atomic operations).
- **Memory model** (sequential consistency, relaxed atomics).
- **Data‑race safety** guarantees (ownership, linear types, capabilities).

### 6. Standard Library (Minimum Viable)
- **Essential modules**: I/O, collections, strings, math, time, concurrency.
- **Platform abstraction** (file system, networking, threading).
- **Runtime services** (panic handling, debugging, profiling).
- **Foreign‑function interface** (C ABI, other languages).

**Always include at least a brief mention of standard library components**; even a minimal language needs basic I/O and collections. This shows you’ve considered the practical ecosystem, not just the core language.

### 7. Tooling & Ecosystem
- **Build system** (integrated vs. external, dependency management).
- **Package manager** (centralized vs. decentralized, versioning).
- **IDE support** (LSP, DAP, formatters, linters).
- **Debugging** (source maps, DWARF, time‑travel).

### 8. Sample Programs
- **Hello World** (simplest possible).
- **Data structures** (linked list, hash map, tree).
- **Algorithms** (quicksort, breadth‑first search).
- **Domain‑specific example** (HTTP server for web, ray tracer for graphics).

### 9. Implementation Notes
- **Compiler pipeline** (lexer, parser, type checker, IR, codegen).
- **Intermediate representations** (AST, HIR, MIR, SSA).
- **Optimization passes** (inlining, constant propagation, vectorization).
- **Backend targets** (x86‑64, ARM, RISC‑V, WASM).

### 10. Inspiration & Differentiation
- **Prior art**: Reference existing languages where they directly inspired a feature, but avoid forced citations. The goal is a coherent design, not a checklist of inspirations.
- **Novel contributions**: What makes this language unique—what problem does it solve that existing languages don't?
- **Migration paths**: How programmers from similar languages could adapt.
- **Design rationale**: For each major feature, explain why it was included and what trade‑offs were considered.

Ensure each section is detailed enough to guide implementation. Provide concrete examples: grammar productions, type inference rules, sample code snippets, and explanations of how features interact. Present the spec in **dependency order**: define lower‑level concepts before higher‑level ones. Use **TypeScript/Rust/Go‑like pseudocode** for type definitions (avoid C syntax unless specifically requested).

## Example Language Design Sketch

When asked to design a new language, produce a **complete specification** as outlined in the “Creating a Language Specification” section. Follow this workflow:

**Prioritize simplicity**: Choose safety mechanisms that are easy to understand and implement (compile‑time checks, linear types, capabilities) over complex borrow checking unless absolutely necessary. Ensure each feature has a clear rationale and distinct purpose.

1. **Articulate the core idea** in one sentence (e.g., “safe C with OCaml's expressivity”).
2. **Define the grammar** (BNF/EBNF) and **syntax** (keywords, operators, precedence).
3. **Specify the type system** in detail (built‑in types, composites, generics, inference).
4. **Design memory management** (ownership, allocation, cleanup).
5. **Describe concurrency model** (threads, async, synchronization).
6. **Outline the standard library** (minimum viable modules).
7. **Detail tooling** (build system, package manager, IDE support).
8. **Provide sample programs** that demonstrate the language's look and feel.
9. **Include implementation notes** (compiler pipeline, IR, backends).

Present the spec in **dependency order**: lower‑level concepts before higher‑level ones. Use **TypeScript/Rust/Go‑like pseudocode** for type definitions (avoid C syntax unless requested).

### For Comparison Tasks
When comparing language features (e.g., module systems):
- **Establish clear criteria** first (simplicity, compile‑time cost, runtime overhead, tooling integration).
- **Compare each language against those criteria** in a structured table.
- **Avoid duplication**: describe each system once, then analyze differences.
- **Make a reasoned recommendation** based on the criteria, not personal preference.
- **Explain concepts** (e.g., “namespace” in Zig) clearly for readers unfamiliar with the language.
