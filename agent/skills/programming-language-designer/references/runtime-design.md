# Memory, Modules, Concurrency, and Compile-Time Execution

Reference detail behind the *Topic Reference* list in `SKILL.md`. Memory management, module systems and builds, concurrency, and compile-time execution.

## Memory Management

### Garbage Collection (GC)
- **Tracing GC** (mark‑sweep, copying, generational): automatic, but introduces pauses and non‑determinism.
- **Reference counting** (RC): deterministic, but cannot collect cycles without extra machinery (weak references, cycle detector).
- **Hybrid approaches** (like Swift’s ARC with cycle detection) combine benefits.
- **Region‑based memory** (arenas): allocate objects in a region; free the whole region at once. Good for lexically scoped allocations.
- **Manual memory management** with safety: **borrow checking** (Rust), **linear types**, **unique pointers**.

### Choosing a Memory Model
- **Systems programming**: manual + arenas, or borrow checking.
- **High‑level scripting**: tracing GC (generational, incremental).
- **Real‑time systems**: reference counting or region‑based.
- **Embedded**: static allocation, pools, arenas.

### Integration with the Type System
- **Ownership types** (Rust) enforce at compile time that each value has a single owner.
- **Capabilities** (Pony) isolate actors’ heaps; no shared mutable state.
- **Linear types** ensure resources are used exactly once.
## Module Systems

### Goals
- **Namespace management** to avoid name collisions.
- **Encapsulation** (public/private visibility).
- **Separate compilation** and **incremental builds**.
- **Dependency management** (versioning, downloading, pinning).

### Design Choices
- **First‑class modules** (like in ML) where modules are values that can be passed to functions.
- **Hierarchical namespaces** (like Java packages, Rust crates).
- **Explicit import/export lists** (like in ES6) versus implicit (like Python `*`).
- **Conditional compilation** and **feature flags** for platform‑specific code.

### Build Systems
- **Language‑integrated build scripts** (Jai, Zig) allow metaprogramming of the build process.
- **Declarative dependency specs** (Cargo.toml, package.json).
- **Reproducible builds** via lock files and vendored dependencies.
## Concurrency and Delimited Continuations

### Delimited Continuations
- A **continuation** represents the rest of the computation from a certain point.
- **Delimited** continuations capture only up to a programmer‑defined boundary (the “prompt”).
- Enable **coroutines**, **async/await**, **backtracking search**, and **effect handlers**.
- Implementation: either via **CPS transformation** at compile time or **stack copying** at runtime (like in Scheme’s `call/cc`).

### Async/Await
- Can be desugared into **delimited continuations** or **state machines** (like in C#).
- **Colored functions** problem: distinguish async from sync functions. Consider making **all functions async** (like in Go) or using **effect systems** to track suspension.

### Actors and Message Passing
- **Isolated processes** that communicate via immutable messages (Erlang, Elixir, Pony).
- **Fault tolerance** via supervision trees.
- **Location transparency**: actors can be local or remote.

### Data‑Parallelism
- **SIMD** intrinsics and auto‑vectorization.
- **GPU kernels** (like CUDA, OpenCL) as language‑extensions.
## Build‑Time and Compile‑Time Execution

### Compile‑Time Function Evaluation (CTFE)
- Execute pure functions at compile time, using the same interpreter/compiler as runtime.
- Requires that the language has a **pure subset** (no I/O, no non‑determinism).
- Use cases: constant folding, **static reflection**, generating lookup tables, validating invariants.

### Metaprogramming
- **Macros** (syntactic abstraction) can be **hygienic** (Scheme) or **unhygienic** (C).
- **Template metaprogramming** (C++ templates, D’s compile‑time evaluation).
- **Staged compilation** (like Terra) where code generators run at compile time.

### Language‑Integrated Build Scripts
- The build script is a program in the same language that configures compilation, runs code generators, and copies assets.
- Example: Zig’s `build.zig`, Jai’s build procedure.
