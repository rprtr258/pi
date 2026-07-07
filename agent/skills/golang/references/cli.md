# Go CLI Patterns

General patterns for building command-line tools in Go. For Cobra-specific guidance, see `cobra.md`.

## Exit Codes

Follow Unix conventions:

| Code  | Meaning       | When to use                               |
| ----- | ------------- | ----------------------------------------- |
| 0     | Success       | Operation completed normally              |
| 1     | General error | Runtime failure                           |
| 2     | Usage error   | Invalid flags, arguments, or config       |
| 128+N | Signal N      | Terminated by signal (e.g., 130 = SIGINT) |

Map errors to exit codes at the top level — never call `os.Exit()` deep in the call stack:

```go
func main() {
    if err := run(); err != nil {
        fmt.Fprintf(os.Stderr, "error: %v\n", err)

        var exitErr *ExitError
        if errors.As(err, &exitErr) {
            os.Exit(exitErr.Code)
        }
        os.Exit(1)
    }
}

type ExitError struct {
    Code    int
    Message string
}

func (e *ExitError) Error() string { return e.Message }
```

## stdout vs stderr

stdout is for program output — data that can be piped. stderr is for diagnostics, progress, and errors. Never mix them:

```go
// Good — output to stdout, errors to stderr
fmt.Println(result)                         // program output
fmt.Fprintf(os.Stderr, "error: %v\n", err)  // diagnostic

// Bad — errors to stdout corrupt pipeable output
fmt.Printf("Error: %v\n", err)
```

## Signal Handling

Use `signal.NotifyContext` to propagate OS signals through context cancellation:

```go
func run() error {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    return execute(ctx)
}

func execute(ctx context.Context) error {
    // Long-running work checks context
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
            // do work
        }
    }
}
```

### Waiting for Child Processes

When managing child processes, combine signal handling with process lifecycle:

```go
func runChild(ctx context.Context, name string, args ...string) error {
    cmd := exec.CommandContext(ctx, name, args...)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Start(); err != nil {
        return fmt.Errorf("starting %s: %w", name, err)
    }

    return cmd.Wait()
}
```

## Context Propagation

Pass `context.Context` as the first parameter through the entire call chain. Never create `context.Background()` mid-chain:

```go
// Good — propagate from signal handler
func main() {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
    defer stop()
    run(ctx)
}

func run(ctx context.Context) error {
    return processWorkspaces(ctx, workspaces)
}

// Bad — new background context breaks cancellation
func processWorkspaces(workspaces []string) error {
    ctx := context.Background()  // signal cancellation won't reach here
    // ...
}
```

### Cancel Discipline

Always call `cancel()` — use `defer` immediately after creation:

```go
ctx, cancel := context.WithTimeout(parentCtx, 10*time.Second)
defer cancel()
```

## Spawning Processes Safely

Use `exec.Command` with explicit arguments — never shell interpolation:

```go
// Good — no shell, no injection
cmd := exec.Command("pi", "-p", "--model", model)

// Bad — shell interpolation
cmd := exec.Command("sh", "-c", fmt.Sprintf("pi -p --model %s", model))
```

Set working directory and environment explicitly:

```go
cmd := exec.Command("pi", "-p", "--model", model, "@NIGHTSHIFT.md")
cmd.Dir = workspacePath
cmd.Env = append(os.Environ(),
    "NIGHTSHIFT_RUN_ID="+runID,
    "NIGHTSHIFT_SIGNAL_FILE="+signalPath,
)
```
