# Go Error Handling

## Error String Conventions

Error strings must be lowercase, without trailing punctuation. Each wrapping layer adds a prefix, forming a readable chain:

```
creating order: charging card: connection refused
```

```go
// Good
return errors.New("connection refused")
return fmt.Errorf("fetching user: %w", err)

// Bad
return errors.New("Failed to connect to database.")
return fmt.Errorf("UserService: failed to fetch user: %w", err)
```

## Creating Errors

### Sentinel Errors

Use for expected conditions that callers match on:

```go
var ErrNotFound = errors.New("not found")
var ErrUnauthorized = errors.New("unauthorized")
```

### Custom Error Types

Use when callers need to extract structured data. Implement `Unwrap()` to preserve the error chain:

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string {
    return fmt.Sprintf("query %q: %v", e.Query, e.Err)
}

func (e *QueryError) Unwrap() error {
    return e.Err
}
```

### Decision Table

| Situation                           | Strategy                             |
| ----------------------------------- | ------------------------------------ |
| Caller matches a specific condition | Sentinel error (package-level `var`) |
| Caller extracts structured data     | Custom error type                    |
| Error is informational, not matched | `fmt.Errorf` or `errors.New`         |

## Wrapping with %w

Wrap at each layer to build context. Use `%w` within your module, `%v` at public API boundaries to hide internals:

```go
// Internal — preserve chain
return fmt.Errorf("querying database: %w", err)

// Public API boundary — break chain
return fmt.Errorf("item unavailable: %v", err)
```

## Inspecting Errors

### errors.Is — match sentinel values

```go
// Good — traverses the entire chain
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}

// Bad — breaks on wrapped errors
if err == sql.ErrNoRows {
```

### errors.As — extract typed errors

```go
var ve *ValidationError
if errors.As(err, &ve) {
    log.Printf("validation failed on field %s: %s", ve.Field, ve.Message)
}
```

## Combining Errors

Use `errors.Join` for independent errors:

```go
func validateUser(u User) error {
    var errs []error
    if u.Name == "" {
        errs = append(errs, errors.New("name is required"))
    }
    if u.Email == "" {
        errs = append(errs, errors.New("email is required"))
    }
    return errors.Join(errs...) // nil if empty
}
```

## The Single Handling Rule

An error must be handled exactly once — log it or return it, never both:

```go
// Bad — logs AND returns (duplicate noise)
func processOrder(id string) error {
    if err := chargeCard(id); err != nil {
        log.Printf("failed to charge card: %v", err)
        return fmt.Errorf("charging card: %w", err)
    }
    return nil
}

// Good — return with context, let the caller decide
func processOrder(id string) error {
    if err := chargeCard(id); err != nil {
        return fmt.Errorf("charging card: %w", err)
    }
    return nil
}

// Good — handle at the top level
func main() {
    if err := run(); err != nil {
        fmt.Fprintf(os.Stderr, "error: %v\n", err)
        os.Exit(1)
    }
}
```

## Panic Discipline

Never use `panic` for expected failures. Reserve for truly unrecoverable programmer errors. Name panicking wrappers with `Must` prefix:

```go
// Acceptable — programmer error during initialization
func MustCompileRegex(pattern string) *regexp.Regexp {
    re, err := regexp.Compile(pattern)
    if err != nil {
        panic(fmt.Sprintf("invalid regex %q: %v", pattern, err))
    }
    return re
}

// Bad — panic for a normal failure
func GetUser(id string) *User {
    user, err := db.Find(id)
    if err != nil {
        panic(err)
    }
    return user
}
```
