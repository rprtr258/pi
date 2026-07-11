# Performance, WebAssembly, and Tooling

Reference detail behind the *Topic Reference* list in `SKILL.md`. Performance techniques, WebAssembly targets, and the surrounding tooling ecosystem.

## Performance Optimization

### Data‑Oriented Design
- Organize data in **arrays of structs** (AoS) or **structs of arrays** (SoA) depending on access patterns.
- **Cache locality** is critical; keep hot data together, avoid pointer chasing.
- **Branch prediction** friendly code: avoid unpredictable `if` statements in tight loops.

### Zero‑Cost Abstractions
- Abstractions that compile to the same machine code as hand‑written low‑level code.
- Achieved via **monomorphization** (generic code duplication) or **static dispatch**.
- **Inline expansion** of small functions.

### Profile‑Guided Optimization (PGO)
- Instrument the binary, run representative workloads, feed profile data back into the compiler.
- Improves inlining decisions, branch prediction, and code layout.

### Link‑Time Optimization (LTO)
- Optimize across translation unit boundaries after linking.
- Enables cross‑module inlining and dead code elimination.
## WebAssembly Compilation

### Targeting WASM
- WASM is a **stack‑based virtual machine** with linear memory.
- Use the **wasm32‑unknown‑unknown** target in LLVM or Cranelift.
- **WASI** provides a system interface for file I/O, sockets, etc.

### Garbage Collection and WASM
- The **WASM GC proposal** adds structs, arrays, and managed heap types.
- Allows direct compilation of languages with GC to WASM without embedding a runtime.
- For now, most languages ship their own GC as part of the WASM module (increases binary size).

### Tooling
- **wasm‑bindgen** (Rust) for interoperability with JavaScript.
- **wasm‑pack** for packaging Rust‑generated WASM for npm.
- **Binaryen** for post‑processing and optimization of WASM modules.
## Tooling

### IDE Support
- **Language Server Protocol (LSP)** enables editor‑agnostic features (completion, go‑to‑definition, rename).
- **Debug Adapter Protocol (DAP)** for debugging.
- **Syntax highlighting**, **code folding**, **outline view**.

### Debuggers
- **Source‑level debugging** requires emitting debug info (DWARF, PDB).
- **Time‑travel debugging** (record and replay) is invaluable for concurrency bugs.

### Formatters and Linters
- **Automatic formatting** (like `gofmt`, `rustfmt`) eliminates style debates.
- **Linters** catch common mistakes and enforce best practices.

### Package Managers
- **Centralized registry** (crates.io, npm) versus **decentralized** (Git dependencies).
- **Version resolution** algorithm (SAT solver in Cargo, simple greedy in npm).
- **Security** (auditing, vulnerability databases).
