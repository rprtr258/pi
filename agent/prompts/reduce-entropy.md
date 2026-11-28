Systematically reduce architectural entropy across the entire codebase, standardize and normalize it, decouple its modules, and manage its complexity, gradually evolving it into a highly structured engineering system that is extremely easy to understand and maintain and well suited to large-scale parallel development by Agents.

Core idea:

Assume today is the product’s first day, but we already know
all the current real requirements, business constraints, and product form.
Consider what this codebase should ideally look like,
then converge toward that state through safe, incremental, verifiable refactoring.

Pursue the following engineering properties:

1. Single Source of Truth
   Every business rule, data definition, configuration, state, and design standard
   should have one clear, authoritative source.

2. Canonical Implementation
   Keep only one standard implementation for the same semantics and responsibility.
   Thoroughly eliminate legacy parallel implementations, duplicated logic, temporary patches,
   meaningless compatibility layers, and multiple coexisting technical solutions.
   Retain compatibility capabilities that have real callers or explicit contract requirements.

3. Deep Modules
   Draw on John Ousterhout’s A Philosophy of Software Design.
   Encapsulate complexity internally and expose capabilities through interfaces that are as simple and stable as possible.
   Reduce shallow modules, meaningless forwarding layers, and abstractions that leak internal implementation.

4. High Cohesion, Low Coupling
   Every module has a clear responsibility, ownership, and dependency direction.
   Modules are highly cohesive internally and interact through stable contracts.
   Eliminate circular dependencies, implicit coupling, cross-layer access, and shared mutable state.

5. Locality of Change
   When changing a business concept, change only one logical location whenever possible.
   Eliminate situations where a single requirement requires synchronized changes across a large number of unrelated files.

6. Deletion over Accumulation
   Prioritize whether unnecessary complexity can be deleted.
   Every time a new standard implementation is introduced, check and migrate existing callers,
   and delete the replaced implementation only after confirming it is safe.
   Do not allow old and new systems to coexist for long periods.

7. Enforceable Architecture
   Turn established engineering standards into machine-enforceable constraints,
   using the type system, linting, AST checks, contract tests, and CI
   to prevent future development from reintroducing eliminated chaos.

Execution process:

First, understand the entire codebase’s real business, architecture, historical decisions,
module relationships, technology stack, existing tests, and production constraints.

Build a complete architecture map, dependency graph, state ownership map,
list of duplicate implementations, list of technical solutions, and list of deviations from standards.

Inspect and remediate them one by one:

- UI components and design system
- Business logic and domain model
- API interfaces and data contracts
- State management and data flow
- Data access and caching
- Configuration and environment variables
- Error handling and retry mechanisms
- Logging and observability
- Permissions and authentication
- Naming, directory structure, and module boundaries
- Utility functions and shared infrastructure
- Testing, build, and development toolchain

Continuously run the following loop:

Scan the entire system
→ Discover architectural entropy and deviations from standards
→ Analyze real callers and dependencies
→ Propose multiple refactoring options
→ Choose the option with the lowest overall complexity
→ Establish a behavioral baseline and tests
→ Complete a full batch of migrations
→ Delete the old implementations that have been replaced
→ Independent review
→ Run verification
→ Establish anti-regression constraints
→ Record the results and continue to the next round

Every refactoring round must form a complete closed loop. Do not only create new abstractions,
new directories, or new interfaces without migrating the original callers.

Apply the Deletion Test to every layer of abstraction:
If this layer is deleted, does the complexity disappear, or does it spread to the callers?
Only abstractions that truly encapsulate complexity are worth keeping.

Acceptance criteria:

- Each core business concept has a clear authoritative implementation.
- Each core module has a clear responsibility and public interface.
- There are no unexplained multiple implementations of the same semantics.
- There are no unapproved circular dependencies between core modules.
- Business logic is reasonably decoupled from the UI, storage, frameworks, and external services.
- New features can be completed within clear module boundaries.
- Established critical architectural standards have automated anti-regression checks.
- All existing functionality, data compatibility, and external contracts are preserved.

Do not over-abstract, relocate directories with no value, sacrifice readability
to reduce lines of code, or merge concepts with different semantics for the sake of formal uniformity.

Execute in an isolated Git worktree, with each batch of effective improvements committed independently.
Continuously maintain a progress file, architecture decision records, and an optimization task pool.

When encountering items that require product decisions, major architectural changes, or breaking migrations,
record them as pending confirmation and continue with other independent tasks.

There is no need to ask whether to continue each round.
Keep executing until all high-value governance tasks have converged,
or the runtime budget is reached, or no further improvements can be implemented safely.
