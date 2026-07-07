# Go Naming Conventions

Only the conventions LLMs consistently get wrong. For basics (MixedCaps, exported = uppercase), the agent already knows.

## Anti-Stutter

Go call sites always include the package name. Never repeat it in the identifier:

```go
// Good — clean at call site
http.Client         // not http.HTTPClient
json.Decoder        // not json.JSONDecoder
config.Parse()      // not config.ParseConfig()

// In package dbpool:
type Pool struct{}   // not DBPool
type Option func(*Pool)  // not PoolOption
```

## Constructor Naming

When a package exports a single primary type, the constructor is `New()`. Use `NewTypeName()` only when a package has multiple constructible types:

```go
// Good — single primary type
ring.New()
apiclient.New()

// Good — multiple types in same package
http.NewRequest()
http.NewServeMux()

// Bad — stutters
apiclient.NewClient()
```

## Enum Zero Values

Always place an explicit `Unknown`/`Invalid` sentinel at iota position 0. A `var s Status` silently becomes 0 — if that maps to a real state, code behaves as if a status was deliberately chosen when it wasn't:

```go
// Good
type Status int
const (
    StatusUnknown Status = iota
    StatusActive
    StatusInactive
)

// Bad — zero value is a real state
const (
    StatusActive Status = iota  // 0 = active by accident
    StatusInactive
)
```

## Error Naming

Sentinel error variables use `Err` prefix. Error types use `Error` suffix:

```go
// Variables — matched with errors.Is
var ErrNotFound = errors.New("not found")
var ErrTimeout = errors.New("timeout")

// Types — matched with errors.As
type PathError struct { ... }
type ValidationError struct { ... }
```

Error strings are fully lowercase including acronyms, no punctuation:

```go
// Good
errors.New("invalid message id")
fmt.Errorf("fetching user: %w", err)

// Bad
errors.New("invalid message ID.")
errors.New("Failed to fetch user")
```

## Receivers

Use 1-2 letter abbreviation of the type name, consistent across all methods:

```go
func (s *Server) Start() error { ... }
func (s *Server) Stop() error { ... }

// Bad
func (this *Server) Start() error { ... }
func (srv *Server) Stop() error { ... }  // inconsistent with Start
```

## Boolean Fields

Unexported boolean fields use `is`/`has`/`can` prefix. Exported getter keeps the prefix:

```go
type Connection struct {
    isConnected bool
    hasTimeout  bool
}

func (c *Connection) IsConnected() bool { return c.isConnected }
```

## Quick Reference

| Element        | Convention               | Example                          |
| -------------- | ------------------------ | -------------------------------- |
| Package        | lowercase, single word   | `json`, `http`, `config`         |
| Exported name  | UpperCamelCase           | `ReadAll`, `HTTPClient`          |
| Unexported     | lowerCamelCase           | `parseToken`, `userCount`        |
| Constant       | MixedCaps (not ALL_CAPS) | `MaxRetries`, `defaultTimeout`   |
| Acronym        | all caps or all lower    | `URL`, `HTTPServer`, `xmlParser` |
| Error variable | `Err` prefix             | `ErrNotFound`                    |
| Error type     | `Error` suffix           | `PathError`                      |
| Receiver       | 1-2 letter abbreviation  | `func (s *Server)`               |
