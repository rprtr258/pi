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

| Element | Convention | Example |
| --- | --- | --- |
| Package | lowercase, single word, _test suffix OK for test files | `json`, `http`, `tabwriter`, `http_test` |
| File | lowercase, underscores OK | `user_handler.go` |
| Exported name | UpperCamelCase | `ReadAll`, `HTTPClient` |
| Unexported | lowerCamelCase | `parseToken`, `userCount` |
| Interface | method name + `-er` | `Reader`, `Closer`, `Stringer` |
| Struct | MixedCaps noun | `Request`, `FileHeader` |
| Constant | MixedCaps (not ALL_CAPS) | `MaxRetries`, `defaultTimeout` |
| Receiver | 1-2 letter abbreviation | `func (s *Server)`, `func (b *Buffer)` |
| Error variable | `Err` prefix | `ErrNotFound`, `ErrTimeout` |
| Error type | `Error` suffix | `PathError`, `SyntaxError` |
| Constructor | `New` (single type) or `NewTypeName` (multi-type) | `ring.New`, `http.NewRequest` |
| Boolean field | `is`, `has`, `can` prefix on **fields** and methods | `isReady`, `IsConnected()` |
| Test function | `Test` + function name | `TestParseToken` |
| Acronym | all caps or all lower | `URL`, `HTTPServer`, `xmlParser` |
| Variant: context | `WithContext` suffix | `FetchWithContext`, `QueryContext` |
| Variant: in-place | `In` suffix | `SortIn()`, `ReverseIn()` |
| Variant: error | `Must` prefix | `MustParse()`, `MustLoadConfig()` |
| Option func | `With` + field name | `WithPort()`, `WithLogger()` |
| Enum (iota) | type name prefix, zero-value = unknown | `StatusUnknown` at 0, `StatusReady` |
| Named return | descriptive, for docs only | `(n int, err error)` |
| Error string | lowercase (incl. acronyms), no punctuation | `"image: unknown format"`, `"invalid id"` |
| Import alias | short, only on collision | `mrand "math/rand"`, `pb "app/proto"` |
| Format func | `f` suffix | `Errorf`, `Wrapf`, `Logf` |
| Test table fields | `got`/`expected` prefixes | `input string`, `expected int` |

## Frequently Missed Conventions

These conventions are correct but non-obvious — they are the most common source of naming mistakes:

**Constructor naming:** When a package exports a single primary type, the constructor is `New()`, not `NewTypeName()`. This avoids stuttering — callers write `apiclient.New()` not `apiclient.NewClient()`. Use `NewTypeName()` only when a package has multiple constructible types (like `http.NewRequest`, `http.NewServeMux`).

**Boolean struct fields:** Unexported boolean fields MUST use `is`/`has`/`can` prefix — `isConnected`, `hasPermission`, not bare `connected` or `permission`. The exported getter keeps the prefix: `IsConnected() bool`. This reads naturally as a question and distinguishes booleans from other types.

**Error strings are fully lowercase — including acronyms.** Write `"invalid message id"` not `"invalid message ID"`, because error strings are often concatenated with other context (`fmt.Errorf("parsing token: %w", err)`) and mixed case looks wrong mid-sentence. Sentinel errors should include the package name as prefix: `errors.New("apiclient: not found")`.

**Enum zero values:** Always place an explicit `Unknown`/`Invalid` sentinel at iota position 0. A `var s Status` silently becomes 0 — if that maps to a real state like `StatusReady`, code can behave as if a status was deliberately chosen when it wasn't.

**Subtest names:** Table-driven test case names in `t.Run()` should be fully lowercase descriptive phrases: `"valid id"`, `"empty input"` — not `"valid ID"` or `"Valid Input"`.

## Detailed Categories

For complete rules, examples, and rationale, see:

- **[Packages, Files & Import Aliasing](./naming/packages-files.md)** — Package naming (single word, lowercase, no plurals), file naming conventions, import alias patterns (only use on collision to avoid cognitive load), and directory structure.

- **[Variables, Booleans, Receivers & Acronyms](./naming/identifiers.md)** — Scope-based naming (length matches scope: `i` for 3-line loops, longer names for package-level), single-letter receiver conventions (`s` for Server), acronym casing (URL not Url, HTTPServer not HttpServer), and boolean naming patterns (isReady, hasPrefix).

- **[Functions, Methods & Options](./naming/functions-methods.md)** — Getter/setter patterns (Go omits `Get` so `user.Name()` reads naturally), constructor conventions (`New` or `NewTypeName`), named returns (for documentation only), format function suffixes (`Errorf`, `Wrapf`), and functional options (`WithPort`, `WithLogger`).

- **[Types, Constants & Errors](./naming/types-errors.md)** — Interface naming (`Reader`, `Closer` suffix with `-er`), struct naming (nouns, MixedCaps), constants (MixedCaps, not ALL_CAPS), enums (type name prefix like `StatusReady`), sentinel errors (`ErrNotFound` variables), error types (`PathError` suffix), and error message conventions (lowercase, no punctuation).

- **[Test Naming](./naming/testing.md)** — Test function naming (`TestFunctionName`), table-driven test field conventions (`input`, `expected`), test helper naming, and subcase naming patterns.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| `ALL_CAPS` constants | Go reserves casing for visibility, not emphasis — use `MixedCaps` (`MaxRetries`) |
| `GetName()` getter | Go omits `Get` because `user.Name()` reads naturally at call sites. But `Is`/`Has`/`Can` prefixes are kept for boolean predicates: `IsHealthy() bool` not `Healthy() bool` |
| `Url`, `Http`, `Json` acronyms | Mixed-case acronyms create ambiguity (`HttpsUrl` — is it `Https+Url`?). Use all caps or all lower |
| `this` or `self` receiver | Go methods are called frequently — use 1-2 letter abbreviation (`s` for `Server`) to reduce visual noise |
| `util`, `helper` packages | These names say nothing about content — use specific names that describe the abstraction |
| `http.HTTPClient` stuttering | Package name is always present at call site — `http.Client` avoids reading "HTTP" twice |
| `user.NewUser()` constructor | Single primary type uses `New()` — `user.New()` avoids repeating the type name |
| `connected bool` field | Bare adjective is ambiguous — use `isConnected` so the field reads as a true/false question |
| `"invalid message ID"` error | Error strings must be fully lowercase including acronyms — `"invalid message id"` |
| `StatusReady` at iota 0 | Zero value should be a sentinel — `StatusUnknown` at 0 catches uninitialized values |
| `"not found"` error string | Sentinel errors should include the package name — `"mypackage: not found"` identifies the origin |
| `userSlice` type-in-name | Types encode implementation detail — `users` describes what it holds, not how |
| Inconsistent receiver names | Switching names across methods of the same type confuses readers — use one name consistently |
| `snake_case` identifiers | Underscores conflict with Go's MixedCaps convention and tooling expectations — use `mixedCaps` |
| Long names for short scopes | Name length should match scope — `i` is fine for a 3-line loop, `userIndex` is noise |
| Naming constants by value | Values change, roles don't — `DefaultPort` survives a port change, `Port8080` doesn't |
| `FetchCtx()` context variant | `WithContext` is the standard Go suffix — `FetchWithContext()` is instantly recognizable |
| `sort()` in-place but no `In` | Readers assume functions return new values. `SortIn()` signals mutation |
| `parse()` panicking on error | `MustParse()` warns callers that failure panics — surprises belong in the name |
| Mixing `With*`, `Set*`, `Use*` | Consistency across the codebase — `With*` is the Go convention for functional options |
| Plural package names | Go convention is singular (`net/url` not `net/urls`) — keeps import paths consistent |
| `Wrapf` without `f` suffix | The `f` suffix signals format-string semantics — `Wrapf`, `Errorf` tell callers to pass format args |
| Unnecessary import aliases | Aliases add cognitive load. Only alias on collision — `mrand "math/rand"` |
| Inconsistent concept names | Using `user`/`account`/`person` for the same concept forces readers to track synonyms — pick one name |

## Enforce with Linters

Many naming convention issues are caught automatically by linters: `revive`, `predeclared`, `misspell`, `errname`. See [lint](../lint/lint.md) for configuration and usage.

## Cross-References

- → See [code-style](code-style/code-style.md) for broader formatting and style decisions
- → See [structs-interfaces](interfaces/structs.md) for interface naming depth and receiver design
- → See [lint](../lint/lint.md) for automated enforcement (revive, predeclared, misspell, errname)
