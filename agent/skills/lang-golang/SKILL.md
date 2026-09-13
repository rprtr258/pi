---
name: lang-golang
description: "Go language conventions for CLI projects using Cobra, stdlib testing, and standard error handling. Use when writing, reviewing, or refactoring Go code — covers code style, error handling, naming, testing, concurrency, structs and interfaces, generics, project structure, performance, CLI patterns, Cobra usage, plus extended topics: CI/CD, database, dependency management, documentation, lint, modernize, observability, design patterns, safety, security, troubleshooting, gRPC, samber/lo, and testify."
---

# Go Conventions

Idiomatic Go conventions for CLI-focused projects.

## Core Rules

1. Always check returned errors — never discard with `_`
2. Wrap errors with `fmt.Errorf("context: %w", err)` — each layer adds one prefix
3. Log OR return errors, never both
4. Table-driven tests with named subtests via `t.Run`
5. Early returns for errors and edge cases — keep happy path at minimal indentation
6. Initialize slices and maps explicitly (`[]T{}`, `map[K]V{}`) — never leave nil
7. Cobra commands: set `SilenceUsage: true`, `SilenceErrors: true`, use `RunE` not `Run`
8. stdout for program output, stderr for diagnostics and errors
9. Constructor is `New()` when a package exports one primary type — avoid stutter
10. Enum zero value (iota 0) is always an explicit `Unknown` or `Invalid` sentinel
11. `context.Context` as first arg for blocking operations (network, exec, long work)
12. Never start a goroutine without a termination plan — WaitGroup, channel, or ctx cancel
13. Document every exported symbol with a doc comment
14. Config comes from env vars or functional options — no hardcoded values

## Workflow

1. Identify the area of Go code being changed
2. Read the matching reference(s) from the table below
3. Apply conventions, using Good/Bad examples as guidance
4. Validate: `gofmt -w .`, `go vet ./...`, `golangci-lint run`, `go test -race ./...`
5. Fix issues and re-run validation

## References

Read the reference that matches the area you are working in:

| Topic          | Description                                                        | Reference                                      |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| code style     | Line breaking, variables, control flow, function design, safety    | [code-style](references/code-style/code-style.md) |
| error handling | Creation, wrapping, inspection, single handling rule, panic        | [error-handling](references/error-handling.md) |
| naming         | Constructors, enums, error naming, anti-stutter                    | [naming](references/naming.md)                 |
| testing        | Table-driven tests, stub binaries, HTTP testing, mocking, commands | [testing](references/testing/testing.md)       |
| TDD & advanced | Red-green-refactor, benchmarks, fuzzing, goleak, coverage, race    | [tdd](references/testing/tdd.md)               |
| CLI patterns   | Exit codes, stdout/stderr, signal handling, context cancellation   | [cli](references/cli.md)                       |
| Cobra          | Root command, subcommands, flags, arg validators                   | [cobra](references/libs/cobra.md)              |
| Concurrency    | Goroutines, channels, select, sync, cancellation, timeouts         | [concurrency](references/concurrency/concurrency.md) |
| Structs        | Zero value, struct tags, receivers, noCopy, stdlib interfaces      | [structs](references/interfaces/structs.md)    |
| Interfaces     | Small interfaces, accept interfaces/return structs, io patterns    | [interfaces](references/interfaces/interfaces.md) |
| Generics       | Type parameters, constraints, generic data structures              | [generics](references/generics.md)             |
| Project layout | Standard layout, go.mod, module commands, workspaces               | [project-structure](references/project-layout/project-layout.md) |
| Performance    | Profiling, benchmarks, pprof, iterative optimization               | [performance](performance/performance.md)            |
| gRPC           | Proto organization, server/client impl, interceptors, testing      | [gRPC](references/libs/grpc/grpc.md)          |

## Extended Topic Guides

Deeper, domain-specific references. Read the one matching the area you are working in:

| Topic             | Description                                                | Reference                                              |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| CLI app structure | Cobra app assembly, Viper config, completions, versioning  | [cli-app](cli/cli.md)                                  |
| CI/CD             | GitHub Actions, goreleaser, dependabot, codecov, codeql    | [ci](continuous-integration/continuous-integration.md) |
| Database          | sqlx, GORM, migrations, transactions, connection pooling   | [database](database/database.md)                       |
| Dependency mgmt   | go.mod, versioning, vendoring, private modules             | [deps](dependency-management/dependency-management.md) |
| Documentation     | Doc comments, README/CHANGELOG templates, llms.txt         | [docs](documentation/documentation.md)                 |
| Lint              | golangci-lint config, linter catalog, enforcement          | [lint](lint/lint.md)                                   |
| Modernize         | Upgrading to newer Go: iterators, generics, stdlib updates | [modernize](modernize/modernize.md)                    |
| Observability     | Logging, metrics, tracing, alerting rules                  | [observability](observability/observability.md)        |
| Idioms & patterns | Core Go idioms, anti-patterns, tooling integration         | [patterns](patterns/patterns.md)                       |
| Design patterns   | Constructors, error flow, resilience, architecture guides  | [design-patterns](patterns/design-patterns.md)         |
| Safety            | Nil safety, zero values, bounds, type-safe helpers         | [safety](safety/safety.md)                             |
| Security          | Input validation, crypto, secrets, OWASP for Go            | [security](security/security.md)                       |
| Troubleshooting   | Debugging methodology, pprof, race, root-cause analysis    | [troubleshooting](troubleshooting/troubleshooting.md)  |
| samber/lo         | Generic helpers: map, filter, reduce, tuples, channels     | [samber-lo](references/libs/samber-lo/samber-lo.md)    |
| stretchr/testify  | assert/require, testify/mock, suites, linters              | [testify](references/libs/stretchr-testify/stretchr-testify.md)         |
