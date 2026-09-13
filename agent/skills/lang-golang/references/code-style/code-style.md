# Go Code Style

Style rules that require human judgment — formatters handle whitespace, this reference handles clarity. For naming see the [naming reference](../naming.md); for design patterns see the [design-patterns skill](../../design-patterns/SKILL.md); for struct/interface design see the [interfaces reference](../interfaces/interfaces.md).

> "Clear is better than clever." — Go Proverbs

When ignoring a rule, add a comment to the code.

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

When a function signature is too long, the fix is often fewer parameters (use an options struct) rather than better line wrapping. For multi-line signatures, put each parameter on its own line.

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
m := make(map[string]int, len(items)) // preallocate when size is known

// Bad — nil
var users []User
var m map[string]int
```

Do not preallocate speculatively — `make([]T, 0, 1000)` wastes memory when the common case is 10 items.

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

### Complex Conditions & Init Scope

When an `if` condition has 3+ operands, extract into named booleans. Keep expensive checks inline for short-circuit benefit. [Details](./references/details.md)

```go
// Good — named booleans make intent clear
isAdmin := user.Role == RoleAdmin
isOwner := resource.OwnerID == user.ID
isPublicVerified := resource.IsPublic && user.IsVerified
if isAdmin || isOwner || isPublicVerified || permissions.Contains(PermOverride) {
    allow()
}
```

Scope variables to `if` blocks when only needed for the check:

```go
if err := validate(input); err != nil {
    return err
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

- One function, one job — keep functions short and focused
- 4 parameters max — beyond that, use an options struct
- Parameter order: `context.Context` first, then inputs, then output destinations
- Use `range` over index-based loops; `range n` (Go 1.22+) for simple counting
- Naked returns only in very short functions (1–3 lines) where return values are obvious — name returns explicitly in longer functions

```go
func FetchUser(ctx context.Context, id string) (*User, error)
func SendEmail(ctx context.Context, msg EmailMessage) error  // params grouped into struct
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
- Blank imports (`_ "pkg"`) register side effects (init functions) — restrict them to `main` and test packages so side effects stay visible at the application root
- Dot imports pollute the namespace — never use them in library code
- Unexport aggressively — you can always export later

## Strings & Conversions

- `strconv` for simple conversions (faster), `fmt.Sprintf` for complex formatting
- `%q` in error messages to make string boundaries visible
- `strings.Builder` for loops, `+` for simple concatenation
- Prefer generics over `any` when a concrete type will do

```go
func Contains[T comparable](slice []T, target T) bool  // not []any
```

## Philosophy

- "A little copying is better than a little dependency"
- Use the `slices` and `maps` standard packages; for filter/group-by/chunk, use `github.com/samber/lo`
- "Reflection is never clear" — avoid `reflect` unless necessary
- Don't abstract prematurely — extract when the pattern is stable
- Minimize public surface — every exported name is a commitment

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

## Parallelizing Code Style Reviews

When reviewing code style across a large codebase, use up to 5 parallel sub-agents, each targeting an independent style concern (e.g. control flow, function design, variable declarations, string handling, code organization).

## Enforce with Linters

Many rules are enforced automatically: `gofmt`, `gofumpt`, `goimports`, `gocritic`, `revive`, `wsl_v5`. → See the [lint skill](../../lint/SKILL.md).
