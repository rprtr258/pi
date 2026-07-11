# Type Systems

Reference detail behind the *Topic Reference* list in `SKILL.md`. Dependent types (with a full bidirectional type checker), effect systems, gradual typing, and inference.

## Type Systems

### Dependent Types
- Types can depend on **values** (e.g., `Vec n` where `n` is a runtime‑known length).
- Enable proofs of correctness (like “this array access is in‑bounds”).
- Implementation challenges: **type checking** becomes undecidable in general; need a **termination checker** or rely on a trusted kernel.
- Languages: **Idris**, **Agda**, **Coq**, **Lean**.
- Practical advice: start with **indexed types** (like GADTs) before full dependent types.

#### Implementing a Dependent Types Typechecker
When implementing a dependent type system (e.g., with Pi (Π) and Sigma (Σ) types):

1. **Define the syntax formally**:
   - Terms: variables, lambdas, applications, pairs, projections, type constructors
   - Types: base types (Nat, Bool), Pi types (Πx:A. B), Sigma types (Σx:A. B), universes (Type₀, Type₁, …)
   - Use **de Bruijn indices** or **named variables with substitution**

2. **Typing judgements**:
   - Γ ⊢ t : A  (term t has type A in context Γ)
   - Γ ⊢ A : Typeₙ  (A is a well‑formed type of universe n)
   - Context Γ is a list of (name, type) assumptions

3. **Bidirectional type checking**:
   - **Inference mode** (Γ ⊢ t ⇒ A): synthesise a type for term t
   - **Checking mode** (Γ ⊢ t ⇐ A): verify that term t has type A
   - Pi and Sigma types are checked, applications are inferred

4. **Key inference rules**:
   - **Variable**: Γ, x:A ⊢ x ⇒ A
   - **Lambda**: Γ, x:A ⊢ t ⇐ B  ⇒  Γ ⊢ λx.t ⇒ Πx:A. B
   - **Application**: Γ ⊢ f ⇒ Πx:A. B, Γ ⊢ a ⇐ A  ⇒  Γ ⊢ f a ⇒ B[a/x]
   - **Pair**: Γ ⊢ a ⇐ A, Γ ⊢ b ⇐ B[a/x]  ⇒  Γ ⊢ (a,b) ⇒ Σx:A. B
   - **Projection**: Γ ⊢ p ⇒ Σx:A. B  ⇒  Γ ⊢ π₁ p ⇒ A, Γ ⊢ π₂ p ⇒ B[π₁ p/x]

5. **Conversion (definitional equality)**:
   - Terms are considered equal if they reduce to a common normal form
   - Implement **weak head normalization** (β‑reduction, projection reduction)
   - Use **neutral terms** (variables, applications) to handle irreducible cases

6. **Normalization algorithm**:
   - Reduce under binders (lambda, Pi, Sigma)
   - Cache results to avoid exponential blow‑up
   - Handle **η‑expansion** for unit types if desired

7. **Implementation tips**:
   - Start with **simply‑typed lambda calculus**, add dependent types incrementally
   - Use **explicit substitutions** to avoid capture bugs
   - Provide good error messages by tracking source locations
   - Consider **coverage checking** for pattern matching and **termination checking** for recursion

### Effect Systems
- Annotate functions with the **effects** they may perform (I/O, state, exceptions, nondeterminism).
- **Algebraic effects** separate effect definition from handling; handlers can reinterpret effects.
- **Row polymorphism** allows extensible effect rows.
- Languages: **Koka**, **Eff**, **Frank**, **Unison**.
- Integration: an effect system can replace monadic boilerplate while keeping purity.

### Gradual Typing
- Allow **dynamic types** (`any`) in a statically typed language; insert runtime checks at boundaries.
- Enables **incremental adoption** of types in existing codebases.
- **Type inference** (Hindley‑Milner) works well with gradual typing via **constraint solving**.
- Languages: **TypeScript**, **Python with mypy**, **Racket**.
- Performance penalty at dynamic/static boundaries; can be mitigated by JIT compilation.

### Type Inference
- **Hindley‑Milner** (Damas‑Hindley‑Milner) with let‑polymorphism works for functional core languages.
- **Bidirectional type checking** scales better to complex features (dependent types, subtyping).
- **Constraint‑based inference** generates unification variables and solves constraints.
- **Local type inference** (like C# `var`) reduces annotation burden without global inference.
