# Cobra

Patterns for Go CLIs built with `github.com/spf13/cobra`.

## Root Command Setup

Always set `SilenceUsage` and `SilenceErrors` on the root command. Without these, Cobra prints the full usage text on every error:

```go
var rootCmd = &cobra.Command{
    Use:           "nightshift",
    Short:         "Sleep-time autonomous task executor",
    SilenceUsage:  true,
    SilenceErrors: true,
}

func Execute() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Fprintf(os.Stderr, "error: %v\n", err)
        os.Exit(1)
    }
}
```

## RunE Over Run

Always use `RunE` — it returns an error that Cobra propagates to `Execute()`. `Run` swallows errors and forces `os.Exit` inside the handler:

```go
// Good
var startCmd = &cobra.Command{
    Use:   "start",
    Short: "Start a nightshift run",
    RunE: func(cmd *cobra.Command, args []string) error {
        return run(cmd.Context(), cfg)
    },
}

// Bad — can't propagate errors
var startCmd = &cobra.Command{
    Use: "start",
    Run: func(cmd *cobra.Command, args []string) {
        if err := run(cmd.Context(), cfg); err != nil {
            fmt.Println(err)
            os.Exit(1)  // skips defers, cleanup
        }
    },
}
```

## Subcommand Registration

One file per command in `cmd/`. Register in `init()`:

```go
// cmd/start.go
func init() {
    rootCmd.AddCommand(startCmd)
}
```

## Argument Validators

Use built-in validators for positional arguments:

```go
// No arguments allowed
var endCmd = &cobra.Command{
    Use:  "end",
    Args: cobra.NoArgs,
    RunE: runEnd,
}

// Exactly one argument required
var checkinCmd = &cobra.Command{
    Use:  "checkin [summary]",
    Args: cobra.ExactArgs(1),
    RunE: runCheckin,
}
```

Available validators:

| Validator                   | Description                  |
| --------------------------- | ---------------------------- |
| `cobra.NoArgs`              | Fails if any args provided   |
| `cobra.ExactArgs(n)`        | Requires exactly n args      |
| `cobra.MinimumNArgs(n)`     | Requires at least n args     |
| `cobra.MaximumNArgs(n)`     | Allows at most n args        |
| `cobra.RangeArgs(min, max)` | Requires between min and max |

## Flags

### Persistent vs Local

Persistent flags are inherited by all subcommands. Local flags apply only to the command they're defined on:

```go
func init() {
    // Persistent — available to all subcommands
    rootCmd.PersistentFlags().StringVarP(&cfgFile, "config", "c", "", "config file path")

    // Local — only for this command
    startCmd.Flags().StringSliceVar(&models, "model", nil, "model string (repeatable)")
}
```

### Required Flags

```go
func init() {
    startCmd.Flags().StringVar(&model, "model", "", "model to use")
    startCmd.MarkFlagRequired("model")
}
```

### Mutually Exclusive Flags

```go
func init() {
    startCmd.MarkFlagsMutuallyExclusive("config", "model")
}
```

## Output Discipline

Use `cmd.OutOrStdout()` and `cmd.ErrOrStderr()` instead of `os.Stdout`/`os.Stderr` so tests can capture output:

```go
RunE: func(cmd *cobra.Command, args []string) error {
    fmt.Fprintln(cmd.OutOrStdout(), "result")
    fmt.Fprintln(cmd.ErrOrStderr(), "warning: something happened")
    return nil
},
```

## Testing Commands

Execute commands programmatically and capture output:

```go
func executeCommand(root *cobra.Command, args ...string) (string, error) {
    buf := new(bytes.Buffer)
    root.SetOut(buf)
    root.SetErr(buf)
    root.SetArgs(args)

    err := root.Execute()
    return buf.String(), err
}

func TestStartCommand(t *testing.T) {
    output, err := executeCommand(rootCmd, "start", "--model", "test/model")
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    // assert output
}
```

## Common Mistakes

| Mistake                           | Fix                                                   |
| --------------------------------- | ----------------------------------------------------- |
| Missing `SilenceUsage: true`      | Full usage text prints on every error                 |
| Missing `SilenceErrors: true`     | Cobra prints error, then you print it again — doubled |
| Using `Run` instead of `RunE`     | Can't propagate errors to `Execute()`                 |
| Writing to `os.Stdout` directly   | Tests can't capture output — use `cmd.OutOrStdout()`  |
| Calling `os.Exit()` inside `RunE` | Deferred functions and cleanup never run              |
