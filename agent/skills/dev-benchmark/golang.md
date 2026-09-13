---
name: golang-benchmark
description: "Golang benchmarking, profiling, and performance measurement. Use when writing, running, or comparing Go benchmarks, profiling hot paths with pprof, interpreting CPU/memory/trace profiles, analyzing results with benchstat, setting up CI benchmark regression detection, or investigating production performance with Prometheus runtime metrics. Also use when the developer needs deep analysis on a specific performance indicator - dev-benchmark provides the general measurement methodology, while golang-performance provides the optimization patterns."
---

# Go Benchmarking & Performance Measurement

Go-specific benchmarking, profiling, and performance measurement. The general layers live in [SKILL.md](./SKILL.md) and its references: statistical benchmark methodology ([methodology.md](./references/methodology.md)), profiling & tracing concepts ([profiling.md](./references/profiling.md)), CI regression strategy ([ci-regression.md](./references/ci-regression.md)), and production investigation setup ([investigation-session.md](./references/investigation-session.md)). Read those first - never draw conclusions from a single benchmark run; statistical rigor and controlled conditions are prerequisites before any optimization decision.

This file covers the Go-specific workflow: write a benchmark, run it, profile the result, compare before/after, and track regressions in CI. For optimization patterns to apply after measurement, → See [](../lang-golang/performance/performance.md). For pprof setup on running services, → See [](../lang-golang/troubleshooting/troubleshooting.md).

## Writing Benchmarks

### `b.Loop()` (Go 1.24+) - preferred

`b.Loop()` prevents the compiler from optimizing away the code under test - without it, the compiler can detect dead results and eliminate them, producing misleadingly fast numbers. It also excludes setup code before the loop from timing automatically.

```go
func BenchmarkParse(b *testing.B) {
    data := loadFixture("large.json") // setup - excluded from timing
    for b.Loop() {
        Parse(data)  // compiler cannot eliminate this call
    }
}
```

Existing `for range b.N` benchmarks still work but should migrate to `b.Loop()` - the old pattern requires manual `b.ResetTimer()` and a package-level sink variable to prevent dead code elimination.

### Memory tracking

```go
func BenchmarkAlloc(b *testing.B) {
    b.ReportAllocs() // or run with -benchmem flag
    for b.Loop() {
        _ = make([]byte, 1024)
    }
}
```

`b.ReportMetric()` adds custom metrics (e.g., throughput):

```go
b.ReportMetric(float64(totalBytes)/b.Elapsed().Seconds(), "bytes/s")
```

### Sub-benchmarks and table-driven

```go
func BenchmarkEncode(b *testing.B) {
    for _, size := range []int{64, 256, 4096} {
        b.Run(fmt.Sprintf("size=%d", size), func(b *testing.B) {
            data := make([]byte, size)
            for b.Loop() {
                Encode(data)
            }
        })
    }
}
```

## Running Benchmarks

```bash
go test -bench=BenchmarkEncode -benchmem -count=10 ./pkg/... | tee bench.txt
```

| Flag                   | Purpose                                   |
| ---------------------- | ----------------------------------------- |
| `-bench=.`             | Run all benchmarks (regexp filter)        |
| `-benchmem`            | Report allocations (B/op, allocs/op)      |
| `-count=10`            | Run 10 times for statistical significance |
| `-benchtime=3s`        | Minimum time per benchmark (default 1s)   |
| `-cpu=1,2,4`           | Run with different GOMAXPROCS values      |
| `-cpuprofile=cpu.prof` | Write CPU profile                         |
| `-memprofile=mem.prof` | Write memory profile                      |
| `-trace=trace.out`     | Write execution trace                     |

**Output format:** `BenchmarkEncode/size=64-8  5000000  230.5 ns/op  128 B/op  2 allocs/op` - the `-8` suffix is GOMAXPROCS, `ns/op` is time per operation, `B/op` is bytes allocated per op, `allocs/op` is heap allocation count per op.

## Profiling from Benchmarks

Generate profiles directly from benchmark runs - no HTTP server needed:

```bash
# CPU profile
go test -bench=BenchmarkParse -cpuprofile=cpu.prof ./pkg/parser
go tool pprof cpu.prof

# Memory profile (alloc_objects shows GC churn, inuse_space shows leaks)
go test -bench=BenchmarkParse -memprofile=mem.prof ./pkg/parser
go tool pprof -alloc_objects mem.prof

# Execution trace
go test -bench=BenchmarkParse -trace=trace.out ./pkg/parser
go tool trace trace.out
```

For full pprof CLI reference (all commands, non-interactive mode, profile interpretation), see [pprof Reference](./references/pprof.md). For execution trace interpretation, see [Trace Reference](./references/trace.md). For statistical comparison, see [benchstat Reference](./references/benchstat.md).

## Reference Files

- **[pprof Reference](./references/pprof.md)** - Interactive and non-interactive analysis of CPU, memory, and goroutine profiles. Full CLI commands, profile types (CPU vs alloc*objects vs inuse_space), web UI navigation, and interpretation patterns. Use this to dive deep into \_where* time and memory are being spent in your code.

- **[benchstat Reference](./references/benchstat.md)** - Statistical comparison of benchmark runs with rigorous confidence intervals and p-value tests. Covers output reading, filtering old benchmarks, interleaving results for visual clarity, and regression detection. Use this when you need to prove a change made a meaningful performance difference, not just a lucky run.

- **[Trace Reference](./references/trace.md)** - Execution tracer for understanding *when* and *why* code runs. Visualizes goroutine scheduling, garbage collection phases, network blocking, and custom span annotations. Use this when pprof (which shows *where* CPU goes) isn't enough - you need to see the timeline of what happened.

- **[Diagnostic Tools](./references/tools.md)** - Quick reference for ancillary tools: fieldalignment (struct padding waste), GODEBUG (runtime logging flags), fgprof (frame graph profiles), race detector (concurrency bugs), and others. Use this when you have a specific symptom and need a focused diagnostic - don't reach for pprof if a simpler tool already answers your question.

- **[Compiler Analysis](./references/compiler-analysis.md)** - Low-level compiler optimization insights: escape analysis (when values move to the heap), inlining decisions (which function calls are eliminated), SSA dump (intermediate representation), and assembly output. Use this when benchmarks show allocations you didn't expect, or when you want to verify the compiler did what you intended.

- **[Go CI Benchmark Tools](./references/go-ci-tools.md)** - CI regression gating tools: benchdiff (quick PR comparisons via benchstat), cob (strict threshold-based gating), gobenchdata (long-term trend dashboards). Use this when you want to ensure pull requests don't silently slow down your codebase - detecting regressions early prevents shipping performance debt.

- **[Prometheus Go Metrics Reference](./references/prometheus-go-metrics.md)** - Complete listing of Go runtime metrics actually exposed as Prometheus metrics by `prometheus/client_golang`. Covers 30 default metrics, 40+ optional metrics (Go 1.17+), process metrics, common PromQL queries, deep-dive investigation queries, and example alerting rules. Distinguishes between `runtime/metrics` (Go internal data) and Prometheus metrics (what you scrape from `/metrics`). Use this when setting up monitoring dashboards, writing PromQL queries, or investigating production performance.

### General references (language-agnostic, shared with SKILL.md)

- **[methodology.md](./references/methodology.md)** - statistical A/B benchmark methodology: workflow, sample counts, confidence intervals, pitfalls
- **[profiling.md](./references/profiling.md)** - profiling and tracing concepts: matching data types to symptoms, reading profiles, recurring patterns
- **[ci-regression.md](./references/ci-regression.md)** - CI regression detection strategy: gating, noisy-neighbor mitigation, self-hosted runner tuning
- **[investigation-session.md](./references/investigation-session.md)** - temporary deep-dive production investigation setup: high-resolution data collection, host correlation, cost warnings

## Cross-References

- → See [](../lang-golang/performance) for optimization patterns to apply after measuring ("if X bottleneck, apply Y")
- → See [](../lang-golang/troubleshooting) for pprof setup on running services (enable, secure, capture), Delve debugger, GODEBUG flags, root cause methodology
- → See [](../lang-golang/observability) for everyday always-on monitoring, continuous profiling (Pyroscope), distributed tracing (OpenTelemetry)
- → See [](../lang-golang/testing) for general testing practices
- → See `samber/cc-skills@promql-cli` skill for querying Prometheus runtime metrics in production to validate benchmark findings
