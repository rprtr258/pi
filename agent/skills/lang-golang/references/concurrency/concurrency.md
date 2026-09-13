# Concurrency Patterns

## Goroutine Lifecycle Management

```go
package main

import (
    "context"
    "fmt"
    "sync"
    "time"
)

// Worker pool with bounded concurrency
type WorkerPool struct {
    workers int
    tasks   chan func()
    wg      sync.WaitGroup
}

func NewWorkerPool(workers int) *WorkerPool {
    wp := &WorkerPool{
        workers: workers,
        tasks:   make(chan func(), workers*2), // Buffered channel
    }
    wp.start()
    return wp
}

func (wp *WorkerPool) start() {
    for i := 0; i < wp.workers; i++ {
        wp.wg.Add(1)
        go func() {
            defer wp.wg.Done()
            for task := range wp.tasks {
                task()
            }
        }()
    }
}

func (wp *WorkerPool) Submit(task func()) {
    wp.tasks <- task
}

func (wp *WorkerPool) Shutdown() {
    close(wp.tasks)
    wp.wg.Wait()
}
```

## Channel Patterns

```go
// Generator pattern
func generateNumbers(ctx context.Context, max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            select {
            case out <- i:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

// Fan-out, fan-in pattern
func fanOut(ctx context.Context, input <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := 0; i < workers; i++ {
        channels[i] = process(ctx, input)
    }
    return channels
}

func process(ctx context.Context, input <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for val := range input {
            select {
            case out <- val * 2:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}

func fanIn(ctx context.Context, channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup

    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for val := range c {
                select {
                case out <- val:
                case <-ctx.Done():
                    return
                }
            }
        }(ch)
    }

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

## Select Statement Patterns

```go
// Timeout pattern
func fetchWithTimeout(ctx context.Context, url string) (string, error) {
    result := make(chan string, 1)
    errCh := make(chan error, 1)

    go func() {
        // Simulate network call
        time.Sleep(100 * time.Millisecond)
        result <- "data from " + url
    }()

    select {
    case res := <-result:
        return res, nil
    case err := <-errCh:
        return "", err
    case <-time.After(50 * time.Millisecond):
        return "", fmt.Errorf("timeout")
    case <-ctx.Done():
        return "", ctx.Err()
    }
}

// Done channel pattern for graceful shutdown
type Server struct {
    done chan struct{}
}

func (s *Server) Shutdown() {
    close(s.done)
}

func (s *Server) Run(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ticker.C:
            fmt.Println("tick")
        case <-s.done:
            fmt.Println("shutting down")
            return
        case <-ctx.Done():
            fmt.Println("context cancelled")
            return
        }
    }
}
```

## Sync Primitives

```go
import "sync"

// Mutex for protecting shared state
type Counter struct {
    mu    sync.Mutex
    count int
}

func (c *Counter) Increment() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.count
}

// RWMutex for read-heavy workloads
type Cache struct {
    mu    sync.RWMutex
    items map[string]string
}

func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    val, ok := c.items[key]
    return val, ok
}

func (c *Cache) Set(key, value string) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.items[key] = value
}

// sync.Once for initialization
type Service struct {
    once   sync.Once
    config *Config
}

func (s *Service) getConfig() *Config {
    s.once.Do(func() {
        s.config = loadConfig() // Only called once
    })
    return s.config
}
```

## Rate Limiting and Backpressure

```go
import "golang.org/x/time/rate"

// Token bucket rate limiter
type RateLimiter struct {
    limiter *rate.Limiter
}

func NewRateLimiter(rps int) *RateLimiter {
    return &RateLimiter{
        limiter: rate.NewLimiter(rate.Limit(rps), rps),
    }
}

func (rl *RateLimiter) Process(ctx context.Context, item string) error {
    if err := rl.limiter.Wait(ctx); err != nil {
        return err
    }
    // Process item
    return nil
}

// Semaphore pattern for limiting concurrency
type Semaphore struct {
    slots chan struct{}
}

func NewSemaphore(n int) *Semaphore {
    return &Semaphore{
        slots: make(chan struct{}, n),
    }
}

func (s *Semaphore) Acquire() {
    s.slots <- struct{}{}
}

func (s *Semaphore) Release() {
    <-s.slots
}

func (s *Semaphore) Do(fn func()) {
    s.Acquire()
    defer s.Release()
    fn()
}
```

## Pipeline Pattern

```go
// Stage-based processing pipeline
func pipeline(ctx context.Context, input <-chan int) <-chan int {
    // Stage 1: Square numbers
    stage1 := make(chan int)
    go func() {
        defer close(stage1)
        for num := range input {
            select {
            case stage1 <- num * num:
            case <-ctx.Done():
                return
            }
        }
    }()

    // Stage 2: Filter even numbers
    stage2 := make(chan int)
    go func() {
        defer close(stage2)
        for num := range stage1 {
            if num%2 == 0 {
                select {
                case stage2 <- num:
                case <-ctx.Done():
                    return
                }
            }
        }
    }()

    return stage2
}
```

## Quick Reference

| Pattern | Use Case | Key Points |
|---------|----------|------------|
| Worker Pool | Bounded concurrency | Limit goroutines, reuse workers |
| Fan-out/Fan-in | Parallel processing | Distribute work, merge results |
| Pipeline | Stream processing | Chain transformations |
| Rate Limiter | API throttling | Control request rate |
| Semaphore | Resource limits | Cap concurrent operations |
| Done Channel | Graceful shutdown | Signal completion |

---

# Concurrency Decision Guide

**Persona:** You are a Go concurrency engineer. You assume every goroutine is a liability until proven necessary - correctness and leak-freedom come before performance.

**Modes:**

- **Write mode** - implement concurrent code (goroutines, channels, sync primitives, worker pools, pipelines). Follow the sequential instructions below.
- **Review mode** - reviewing a PR's concurrent code changes. Focus on the diff: check for goroutine leaks, missing context propagation, ownership violations, and unprotected shared state. Sequential.
- **Audit mode** - auditing existing concurrent code across a codebase. Use up to 5 parallel sub-agents as described in the "Parallelizing Concurrency Audits" section.

> **Community default.** A company skill that explicitly supersedes `golang-concurrency` takes precedence.

## Core Principles

Go's concurrency model is built on goroutines and channels. Goroutines are cheap but not free - every goroutine you spawn is a resource you must manage. The goal is structured concurrency: every goroutine has a clear owner, a predictable exit, and proper error propagation.

1. **Every goroutine must have a clear exit** - without a shutdown mechanism (context, done channel, WaitGroup), they leak and accumulate until the process crashes
2. **Share memory by communicating** - channels transfer ownership explicitly; mutexes protect shared state but make ownership implicit
3. **Send copies, not pointers** on channels - sending pointers creates invisible shared memory, defeating the purpose of channels
4. **Only the sender closes a channel** - closing from the receiver side panics if the sender writes after close
5. **Specify channel direction** (`chan<-`, `<-chan`) - the compiler prevents misuse at build time
6. **Default to unbuffered channels** - larger buffers mask backpressure; use them only with measured justification
7. **Always include `ctx.Done()` in select** - without it, goroutines leak after caller cancellation
8. **Never use `time.After` in loops** - each call creates a timer that lives until it fires, accumulating memory. Use `time.NewTimer` + `Reset`
9. **Track goroutine leaks in tests** with `go.uber.org/goleak`

For detailed channel/select code examples, see [Channels and Select Patterns](references/channels-and-select.md).

## Channel vs Mutex vs Atomic

| Scenario | Use | Why |
| --- | --- | --- |
| Passing data between goroutines | Channel | Communicates ownership transfer |
| Coordinating goroutine lifecycle | Channel + context | Clean shutdown with select |
| Protecting shared struct fields | `sync.Mutex` / `sync.RWMutex` | Simple critical sections |
| Simple counters, flags | `sync/atomic` | Lock-free, lower overhead |
| Many readers, few writers on a map | `sync.Map` | Optimized for read-heavy workloads. **Concurrent map read/write causes a hard crash** |
| Caching expensive computations | `sync.Once` / `singleflight` | Execute once or deduplicate |

## WaitGroup vs errgroup

| Need | Use | Why |
| --- | --- | --- |
| Wait for goroutines, errors not needed | `sync.WaitGroup` | Fire-and-forget |
| Wait + collect first error | `errgroup.Group` | Error propagation |
| Wait + cancel siblings on first error | `errgroup.WithContext` | Context cancellation on error |
| Wait + limit concurrency | `errgroup.SetLimit(n)` | Built-in worker pool |

## Sync Primitives Quick Reference

| Primitive | Use case | Key notes |
| --- | --- | --- |
| `sync.Mutex` | Protect shared state | Keep critical sections short; never hold across I/O |
| `sync.RWMutex` | Many readers, few writers | Never upgrade RLock to Lock (deadlock) |
| `sync/atomic` | Simple counters, flags | Prefer typed atomics (Go 1.19+): `atomic.Int64`, `atomic.Bool` |
| `sync.Map` | Concurrent map, read-heavy | No explicit locking; use `RWMutex`+map when writes dominate |
| `sync.Pool` | Reuse temporary objects | Always `Reset()` before `Put()`; reduces GC pressure |
| `sync.Once` | One-time initialization | Go 1.21+: `OnceFunc`, `OnceValue`, `OnceValues` |
| `sync.WaitGroup` | Wait for goroutine completion | `Add` before `go`; Go 1.24+: `wg.Go()` simplifies usage |
| `x/sync/singleflight` | Deduplicate concurrent calls | Cache stampede prevention |
| `x/sync/errgroup` | Goroutine group + errors | `SetLimit(n)` replaces hand-rolled worker pools |

For detailed examples and anti-patterns, see [Sync Primitives Deep Dive](references/sync-primitives.md).

## Concurrency Checklist

Before spawning a goroutine, answer:

- [ ] **How will it exit?** - context cancellation, channel close, or explicit signal
- [ ] **Can I signal it to stop?** - pass `context.Context` or done channel
- [ ] **Can I wait for it?** - `sync.WaitGroup` or `errgroup`
- [ ] **Who owns the channels?** - creator/sender owns and closes
- [ ] **Should this be synchronous instead?** - don't add concurrency without measured need

## Pipelines and Worker Pools

For pipeline patterns (fan-out/fan-in, bounded workers, generator chains, Go 1.23+ iterators, `samber/ro`), see [Pipelines and Worker Pools](references/pipelines.md).

## Parallelizing Concurrency Audits

When auditing concurrency across a large codebase, use up to 5 parallel sub-agents (Agent tool):

1. Find all goroutine spawns (`go func`, `go method`) and verify shutdown mechanisms
2. Search for mutable globals and shared state without synchronization
3. Audit channel usage - ownership, direction, closure, buffer sizes
4. Find `time.After` in loops, missing `ctx.Done()` in select, unbounded spawning
5. Check mutex usage, `sync.Map`, atomics, and thread-safety documentation

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Fire-and-forget goroutine | Provide stop mechanism (context, done channel) |
| Closing channel from receiver | Only the sender closes |
| `time.After` in hot loop | Reuse `time.NewTimer` + `Reset` |
| Missing `ctx.Done()` in select | Always select on context to allow cancellation |
| Unbounded goroutine spawning | Use `errgroup.SetLimit(n)` or semaphore |
| Sharing pointer via channel | Send copies or immutable values |
| `wg.Add` inside goroutine | Call `Add` before `go` - `Wait` may return early otherwise |
| Forgetting `-race` in CI | Always run `go test -race ./...` |
| Mutex held across I/O | Keep critical sections short |

## Cross-References

- -> See [performance](../../performance/performance.md) for false sharing, cache-line padding, `sync.Pool` hot-path patterns
- -> See [context](concurrency.md) for cancellation propagation and timeout patterns
- -> See [safety](../../safety/safety.md) for concurrent map access and race condition prevention
- -> See [troubleshooting](../../troubleshooting/troubleshooting.md) for debugging goroutine leaks and deadlocks
- -> See [design-patterns](../../patterns/design-patterns.md) for graceful shutdown patterns

## References

- [Go Concurrency Patterns: Pipelines](https://go.dev/blog/pipelines)
- [Effective Go: Concurrency](https://go.dev/doc/effective_go#concurrency)
