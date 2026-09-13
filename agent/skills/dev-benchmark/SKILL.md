---
name: dev-benchmark
description: Use this skill to measure performance baselines, detect regressions before/after PRs, compare stack alternatives, profile to find root causes, and investigate production performance. Includes general benchmark methodology; Go-specific benchmarking lives in golang.md.
---

# Benchmark - Performance Baseline & Regression Detection

## When to Use

- Before and after a PR to measure performance impact
- Setting up performance baselines for a project
- When users report "it feels slow"
- Before a launch - ensure you meet performance targets
- Comparing your stack against alternatives

## Core Principles

- **Measure before optimizing.** Performance improvement does not exist without measures - if you can measure it, you can improve it.
- **Never conclude from a single run.** A single benchmark run cannot distinguish a real change from noise. Use statistical comparisons with enough samples - see [methodology.md](./references/methodology.md).
- **Validate the root cause with profiling data before applying any optimization.** Match the data type to the symptom, interpret the data yourself, and apply targeted changes - no auto-fixes. See [profiling.md](./references/profiling.md).

## How It Works

### Mode 1: Page Performance

Measures real browser metrics via browser MCP:

```
1. Navigate to each target URL
2. Measure Core Web Vitals:
   - LCP (Largest Contentful Paint) - target < 2.5s
   - CLS (Cumulative Layout Shift) - target < 0.1
   - INP (Interaction to Next Paint) - target < 200ms
   - FCP (First Contentful Paint) - target < 1.8s
   - TTFB (Time to First Byte) - target < 800ms
3. Measure resource sizes:
   - Total page weight (target < 1MB)
   - JS bundle size (target < 200KB gzipped)
   - CSS size
   - Image weight
   - Third-party script weight
4. Count network requests
5. Check for render-blocking resources
```

### Mode 2: API Performance

Benchmarks API endpoints:

```
1. Hit each endpoint 100 times
2. Measure: p50, p95, p99 latency
3. Track: response size, status codes
4. Test under load: 10 concurrent requests
5. Compare against SLA targets
```

### Mode 3: Build Performance

Measures development feedback loop:

```
1. Cold build time
2. Hot reload time (HMR)
3. Test suite duration
4. TypeScript check time
5. Lint time
6. Docker build time
```

### Mode 4: Before/After Comparison

Run before and after a change to measure impact:

```
1. Save current metrics as the baseline
2. Make changes
3. Run the same measurements and compare against the baseline
```

Output:
```
| Metric | Before | After | Delta | Verdict |
|--------|--------|-------|-------|---------|
| LCP | 1.2s | 1.4s | +200ms | WARNING: WARN |
| Bundle | 180KB | 175KB | -5KB | ✓ BETTER |
| Build | 12s | 14s | +2s | WARNING: WARN |
```

## Output

Stores baselines as JSON in a git-tracked directory so the team shares baselines.

## Integration

- CI: run the before/after comparison on every PR - see [ci-regression.md](./references/ci-regression.md) for the gating strategy and [golang.md](./golang.md) for Go tooling

## References

General (language-agnostic):

- **[methodology.md](./references/methodology.md)** - statistical benchmark methodology: A/B workflow, sample counts, confidence intervals, p-values, pitfalls
- **[profiling.md](./references/profiling.md)** - profiling and tracing concepts: matching data types to symptoms, sampling vs tracing, reading profiles, recurring patterns
- **[ci-regression.md](./references/ci-regression.md)** - CI regression detection strategy: gating, noisy-neighbor mitigation, self-hosted runner tuning
- **[investigation-session.md](./references/investigation-session.md)** - temporary deep-dive production investigation setup: high-resolution data collection, host correlation, cost warnings

Go-specific:

- **[golang.md](./golang.md)** - Go benchmarking, profiling, and measurement, with its own references: pprof, benchstat, execution tracer, diagnostic tools, compiler analysis, CI benchmark tools, and Prometheus Go runtime metrics
