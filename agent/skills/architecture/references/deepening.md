# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in [language](language.md): **module**, **interface**, **seam**, and **adapter**.

## Dependency Categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is tested across its seam.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules and test through the new interface directly. No adapter needed.

### 2. Local-substitutable

Dependencies that have local test stand-ins. Deepenable if the stand-in exists. The deepened module is tested with the stand-in running in the test suite. The seam is internal; no port at the module's external interface.

### 3. Remote but owned

Your own services across a network boundary. Define a port at the seam. The deep module owns the logic; the transport is injected as an **adapter**. Tests use an in-memory adapter. Production uses an HTTP, gRPC, or queue adapter.

Recommendation shape: "Define a port at the seam, implement an HTTP adapter for production and an in-memory adapter for testing, so the logic sits in one deep module even though it is deployed across a network."

### 4. True external

Third-party services you don't control. The deepened module takes the external dependency as an injected port; tests provide a mock adapter.

## Seam Discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified, typically production and test.
- **Internal seams vs external seams.** A deep module can have internal seams private to its implementation. Do not expose internal seams through the interface just because tests use them.

## Testing Strategy: Replace, Don't Layer

- Old unit tests on shallow modules become waste once tests at the deepened module's interface exist — delete them.
- Write new tests at the deepened module's interface.
- Tests assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors. If a test has to change when the implementation changes, it is testing past the interface.
