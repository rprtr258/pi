---
name: golang
description: Go language conventions for CLI projects using Cobra, stdlib testing, and standard error handling. Use when writing, reviewing, or refactoring Go code — covers code style, error handling, naming, testing, CLI patterns, and Cobra usage.
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

## Workflow

1. Identify the area of Go code being changed
2. Read the matching reference(s) from the table below
3. Apply conventions, using Good/Bad examples as guidance
4. Validate: `gofmt -w .`, `go vet ./...`, `go test ./...`
5. Fix issues and re-run validation

## References

Read the reference that matches the area you are working in:

| Topic          | Description                                                        | Reference                                      |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| code style     | Line breaking, variables, control flow, function design, safety    | [code-style](references/code-style.md)         |
| error handling | Creation, wrapping, inspection, single handling rule, panic        | [error-handling](references/error-handling.md) |
| naming         | Constructors, enums, error naming, anti-stutter                    | [naming](references/naming.md)                 |
| testing        | Table-driven tests, stub binaries, HTTP testing, mocking, commands | [testing](references/testing.md)               |
| CLI patterns   | Exit codes, stdout/stderr, signal handling, context cancellation   | [cli](references/cli.md)                       |
| Cobra          | Root command, subcommands, flags, arg validators                   | [cobra](references/cobra.md)                   |
