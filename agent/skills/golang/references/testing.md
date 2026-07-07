# Go Testing

Stdlib `testing` only — no testify. Tests are executable specifications, not coverage targets.

## Table-Driven Tests

The idiomatic Go pattern for testing multiple scenarios. Always name each case:

```go
func TestCalculatePrice(t *testing.T) {
    tests := []struct {
        name     string
        quantity int
        price    float64
        want     float64
    }{
        {name: "single item", quantity: 1, price: 10.0, want: 10.0},
        {name: "bulk discount", quantity: 100, price: 10.0, want: 900.0},
        {name: "zero quantity", quantity: 0, price: 10.0, want: 0.0},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := CalculatePrice(tt.quantity, tt.price)
            if got != tt.want {
                t.Errorf("CalculatePrice(%d, %.2f) = %.2f, want %.2f",
                    tt.quantity, tt.price, got, tt.want)
            }
        })
    }
}
```

### Naming Conventions

```go
func TestAdd(t *testing.T) { ... }                // function
func TestMyStruct_MyMethod(t *testing.T) { ... }  // method
```

Subtest names in `t.Run()` are lowercase descriptive phrases: `"valid id"`, `"empty input"`.

## Assertions Without Testify

Use `t.Errorf` for non-fatal, `t.Fatalf` for fatal assertions. Include got/want in the message:

```go
if got != want {
    t.Errorf("Parse(%q) = %v, want %v", input, got, want)
}

// Fatal — stop test immediately
f, err := os.Open(path)
if err != nil {
    t.Fatalf("opening %s: %v", path, err)
}
```

For deep equality:

```go
if !reflect.DeepEqual(got, want) {
    t.Errorf("got %+v, want %+v", got, want)
}
```

## Test Helpers

Mark helpers with `t.Helper()` so failure messages report the caller's line:

```go
func assertNoError(t *testing.T, err error) {
    t.Helper()
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
}
```

## Parallel Tests

Use `t.Parallel()` for independent tests:

```go
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        got := Process(tt.input)
        if got != tt.want {
            t.Errorf("got %v, want %v", got, tt.want)
        }
    })
}
```

## Testing with Stub Executables

For testing code that spawns external processes, compile a stub binary and put it on PATH:

```go
func TestMain(m *testing.M) {
    // Build stub binary
    cmd := exec.Command("go", "build", "-o", filepath.Join(tmpDir, "pi"), "./testdata/stub")
    if err := cmd.Run(); err != nil {
        log.Fatalf("building stub: %v", err)
    }

    // Prepend to PATH
    os.Setenv("PATH", tmpDir+string(os.PathListSeparator)+os.Getenv("PATH"))

    os.Exit(m.Run())
}
```

The stub binary reads environment variables and writes expected output:

```go
// testdata/stub/main.go
func main() {
    signalFile := os.Getenv("NIGHTSHIFT_SIGNAL_FILE")
    // Write signal, print output, exit with expected code
}
```

## HTTP Handler Testing

Use `httptest` for handler tests:

```go
func TestHealthHandler(t *testing.T) {
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    rec := httptest.NewRecorder()

    healthHandler(rec, req)

    if rec.Code != http.StatusOK {
        t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
    }

    want := `{"status":"ok"}`
    if got := rec.Body.String(); got != want {
        t.Errorf("body = %q, want %q", got, want)
    }
}
```

### Table-driven HTTP tests

```go
func TestAPIHandler(t *testing.T) {
    tests := []struct {
        name       string
        method     string
        path       string
        body       string
        wantStatus int
        wantBody   string
    }{
        {name: "get ok", method: "GET", path: "/api/item/1", wantStatus: 200},
        {name: "not found", method: "GET", path: "/api/item/999", wantStatus: 404},
        {name: "bad method", method: "DELETE", path: "/api/item/1", wantStatus: 405},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            var body io.Reader
            if tt.body != "" {
                body = strings.NewReader(tt.body)
            }
            req := httptest.NewRequest(tt.method, tt.path, body)
            rec := httptest.NewRecorder()

            handler.ServeHTTP(rec, req)

            if rec.Code != tt.wantStatus {
                t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
            }
        })
    }
}
```

## Mocking

Mock interfaces, not concrete types. Define interfaces where consumed:

```go
// In the package that uses the dependency
type UserStore interface {
    FindByID(ctx context.Context, id string) (*User, error)
}

// Production implementation
type PostgresUserStore struct { db *sql.DB }

// Test mock
type mockUserStore struct {
    findByIDFunc func(ctx context.Context, id string) (*User, error)
}

func (m *mockUserStore) FindByID(ctx context.Context, id string) (*User, error) {
    return m.findByIDFunc(ctx, id)
}

// Usage in tests
func TestService(t *testing.T) {
    store := &mockUserStore{
        findByIDFunc: func(_ context.Context, id string) (*User, error) {
            if id == "123" {
                return &User{ID: "123", Name: "Alice"}, nil
            }
            return nil, ErrNotFound
        },
    }

    svc := NewService(store)
    // ... test svc methods
}
```

## Integration Tests

Use build tags to separate from unit tests:

```go
//go:build integration

package mypackage

func TestDatabaseIntegration(t *testing.T) {
    // ...
}
```

```bash
go test -tags=integration ./...
```

## Quick Reference

```bash
go test ./...                        # all tests
go test -run TestName ./...          # specific test
go test -run TestName/subtest ./...  # specific subtest
go test -race ./...                  # race detection
go test -cover ./...                 # coverage summary
go test -count=1 ./...               # disable test caching
```
