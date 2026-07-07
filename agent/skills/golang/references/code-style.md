# Go Code Style

Style rules that require human judgment — formatters handle whitespace, this reference handles clarity.

## Line Length & Breaking

No rigid limit, but lines beyond ~120 characters must be broken at semantic boundaries. Function calls with 4+ arguments use one argument per line:

```go
// Good
handleUsers(
    w,
    r,
    cfg,
    logger,
)

// Bad — wall of arguments
handleUsers(w, r, cfg, logger, authMiddleware, rateLimiter)
```

When a function signature is too long, the fix is often fewer parameters (use an options struct) rather than better line wrapping.

## Variable Declarations

Use `:=` for non-zero values, `var` for zero-value initialization. The form signals intent:

```go
var count int          // zero value, set later
name := "default"      // non-zero, := is appropriate
var buf bytes.Buffer   // zero value is ready to use
```

### Slice & Map Initialization

Always initialize explicitly. Nil maps panic on write. Nil slices serialize to `null` in JSON instead of `[]`.

```go
// Good
users := []User{}
m := map[string]int{}
users := make([]User, 0, len(ids))   // preallocate when capacity is known

// Bad — nil
var users []User
var m map[string]int
```

### Composite Literals

Always use field names — positional fields break when the type adds or reorders fields:

```go
srv := &http.Server{
    Addr:         ":8080",
    ReadTimeout:  5 * time.Second,
    WriteTimeout: 10 * time.Second,
}
```

## Control Flow

### Early Returns

Handle errors and edge cases first. Keep the happy path at minimal indentation:

```go
// Good
func process(data []byte) (*Result, error) {
    if len(data) == 0 {
        return nil, errors.New("empty data")
    }

    parsed, err := parse(data)
    if err != nil {
        return nil, fmt.Errorf("parsing: %w", err)
    }

    return transform(parsed), nil
}
```

### Eliminate Unnecessary else

When the `if` body ends with `return`/`break`/`continue`, drop the `else`. Use default-then-override for simple assignments:

```go
// Good
level := slog.LevelInfo
switch {
case debug:
    level = slog.LevelDebug
case verbose:
    level = slog.LevelWarn
}

// Bad — else-if chain hides the default
if debug {
    level = slog.LevelDebug
} else if verbose {
    level = slog.LevelWarn
} else {
    level = slog.LevelInfo
}
```

### Complex Conditions

When an `if` condition has 3+ operands, extract into named booleans:

```go
// Good
isAdmin := user.Role == RoleAdmin
isOwner := resource.OwnerID == user.ID
if isAdmin || isOwner || permissions.Contains(PermOverride) {
    allow()
}
```

### Switch Over If-Else Chains

When comparing the same variable multiple times:

```go
switch status {
case StatusActive:
    activate()
case StatusInactive:
    deactivate()
default:
    return fmt.Errorf("unexpected status: %d", status)
}
```

## Function Design

- One function, one job
- 4 parameters max — beyond that, use an options struct
- Parameter order: `context.Context` first, then inputs, then output destinations
- Use `range` over index-based loops

```go
func FetchUser(ctx context.Context, id string) (*User, error)
```

## Value vs Pointer

Pass small types (`string`, `int`, `bool`, `time.Time`) by value. Use pointers when:

- The function mutates the value
- The struct is large (~128+ bytes)
- Nil is meaningful (optional parameter)

## Code Organization

- Group related declarations: type, constructor, methods together
- Order: package doc → imports → constants → types → constructors → methods → helpers
- One primary type per file when it has significant methods
- Unexport aggressively — you can always export later

## Strings & Conversions

- `strconv` for simple conversions (faster), `fmt.Sprintf` for complex formatting
- `%q` in error messages to make string boundaries visible
- `strings.Builder` for loops, `+` for simple concatenation
- Prefer generics over `any` when a concrete type will do

## Safety Pitfalls

### Nil Interface Trap

An interface holding a typed nil pointer is not `== nil`:

```go
// Bad — returns non-nil interface with nil value
func getHandler() http.Handler {
    var h *MyHandler
    if !enabled {
        return h // interface{type: *MyHandler, value: nil} != nil
    }
    return h
}

// Good — return nil explicitly
func getHandler() http.Handler {
    if !enabled {
        return nil
    }
    return &MyHandler{}
}
```

### Defer in Loops

`defer` runs at function exit, not loop iteration. Resources accumulate:

```go
// Bad — all files stay open until function returns
for _, path := range paths {
    f, _ := os.Open(path)
    defer f.Close()
    process(f)
}

// Good — extract to function so defer runs per iteration
for _, path := range paths {
    if err := processOne(path); err != nil {
        return err
    }
}

func processOne(path string) error {
    f, err := os.Open(path)
    if err != nil {
        return err
    }
    defer f.Close()
    return process(f)
}
```
