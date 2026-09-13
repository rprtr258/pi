# Go CI Benchmark Tools

Tools for detecting Go benchmark regressions in CI. For the general strategy (why CI and not locally, gating thresholds, noisy-neighbor mitigation, runner tuning), see [CI Regression Detection](./ci-regression.md).

## benchdiff

Runs Go benchmarks on two git refs and uses `benchstat` to display deltas. Caches results for non-worktree refs so re-runs are fast. Prevents macOS sleep during benchmarks.

```bash
go install filippo.io/mostly-harmless/benchdiff@latest
```

```bash
# Compare current worktree against HEAD (default)
benchdiff -- -benchmem

# Compare two specific refs
benchdiff -base-ref main -head-ref feature-branch

# Compare against a specific commit or tag
benchdiff -base-ref v1.2.0

# Pass extra flags to go test - everything after -- goes to go test
benchdiff -- -benchmem -count=10 -benchtime=3s

# Filter to specific benchmarks
benchdiff -- -benchmem -count=10 -bench=BenchmarkParse

# Target a specific package
benchdiff -- -benchmem -count=10 ./pkg/parser/...

# Clear cached results (useful after rebasing or when cache is stale)
benchdiff -clear-cache

# Combine: compare main with 10 iterations, filtered to critical benchmarks
benchdiff -base-ref main -- -benchmem -count=10 -bench='BenchmarkParse|BenchmarkEncode'
```

Best for: quick PR-to-base comparisons in git-based workflows. Leverages `benchstat` for statistical rigor and caches non-worktree refs so re-runs only re-measure the worktree.

## cob

Compares benchmarks between HEAD and HEAD~1, failing the CI job if performance degrades beyond a configurable threshold (default 20%).

```bash
go install github.com/knqyf263/cob@latest
```

```bash
# Run with default 20% threshold - compares HEAD vs HEAD~1
cob

# Stricter threshold for critical paths (10% regression = failure)
cob -threshold 10

# Compare against a specific base commit
cob -base main

# Only report regressions (ignore improvements)
cob -only-degression

# Choose which metrics to compare (default: ns/op,B/op)
cob -compare "ns/op,B/op,allocs/op"

# Custom go test arguments
cob -bench-args "test -run '^$' -bench BenchmarkParse -benchmem ./pkg/parser/..."

# Increase benchmark duration for more stable results
cob -bench-args "test -run '^$' -bench . -benchmem -benchtime=3s ./..."

# Skip cob for a specific commit: include [skip cob] in commit message
```

**Caution:** `cob` uses `git reset` internally, which can cause data loss if uncommitted changes exist. Always commit your work before running. Additionally, `cob` requires all benchmarks to pass; it skips CI gating if any benchmark fails. For safety, run only in CI pipelines, not locally. Note that `cob` compares single runs without `benchstat`-style statistics, making it more susceptible to noise than `benchdiff`.

Best for: simple post-commit regression gating in CI where statistical rigor is less critical than fast feedback.

## gobenchdata

GitHub Action + CLI that collects benchmark results, publishes to gh-pages as JSON, and visualizes with an interactive web dashboard. Shows performance trends over time.

```bash
go install go.bobheadxi.dev/gobenchdata@latest
```

### CLI commands

```bash
# Parse go test -bench output to JSON
go test -bench=. -benchmem -count=5 ./... | gobenchdata --json bench.json

# Parse from a file
gobenchdata --json bench.json < bench.txt

# Add a tag to the benchmark run (e.g., git commit)
gobenchdata --json bench.json --tag "$(git rev-parse --short HEAD)" < bench.txt

# Evaluate regression checks against a checks config
gobenchdata checks eval bench.txt --checks-config .gobenchdata-checks.yml

# Generate the web dashboard app (static Vue.js site)
gobenchdata web generate ./dashboard-app

# Serve the dashboard locally for preview
gobenchdata web serve ./dashboard-app

# Merge multiple benchmark JSON files
gobenchdata merge old-bench.json new-bench.json > combined.json

# Prune old entries (keep last 30 runs)
gobenchdata prune --count 30 bench.json
```

### GitHub Action setup

```yaml
# .github/workflows/benchmark.yml
name: Benchmark
on: [push]
jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: stable
      - name: Run benchmarks
        run: go test -bench=. -benchmem -count=5 ./... | tee bench.txt
      - uses: bobheadxi/gobenchdata@v1
        with:
          PRUNE_COUNT: 30
          GO_TEST_PKGS: ./...
          BENCHMARKS_OUT: bench.txt
          PUBLISH: true
          PUBLISH_BRANCH: gh-pages
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Regression gating on PRs

```yaml
- name: Check for regressions
  run: gobenchdata checks eval bench.txt --checks-config .gobenchdata-checks.yml
```

```yaml
# .gobenchdata-checks.yml
checks:
  - name: "No major regressions"
    package: ./...
    benchmarks: [".*"]
    thresholds:
      - metric: NsPerOp
        max: 1.2 # fail if >20% slower
      - metric: AllocedBytesPerOp
        max: 1.3 # fail if >30% more allocations
  - name: "Critical path stability"
    package: ./pkg/parser
    benchmarks: ["BenchmarkParse.*"]
    thresholds:
      - metric: NsPerOp
        max: 1.1 # stricter: fail if >10% slower
```

### Dashboard configuration

```yaml
# gobenchdata-web.yml - configure the Vue.js dashboard
title: "My Project Benchmarks"
description: "Performance tracking dashboard"
chartGroups:
  - name: Parser
    charts:
      - name: Parse Performance
        package: myapp/pkg/parser
        benchmarks: ["BenchmarkParse.*"]
        metrics: [NsPerOp, AllocedBytesPerOp, AllocsPerOp]
  - name: Encoding
    charts:
      - name: Encode/Decode
        package: myapp/pkg/encoding
        benchmarks: ["Benchmark(Encode|Decode).*"]
        metrics: [NsPerOp, MBPerS]
```

Best for: long-term trend tracking and visualization; complements benchdiff/cob for immediate gating.

## Tool Selection Guide

| Tool | Statistical rigor | Dashboard | Best for |
| --- | --- | --- | --- |
| **benchdiff** | High (uses benchstat) | No | Local dev + CI PR comparisons |
| **cob** | Low (single comparison) | No | Quick CI gate, simple setup |
| **gobenchdata** | Medium (configurable checks) | Yes (Vue.js on gh-pages) | Long-term trend tracking |
| **benchstat** (raw) | High | No (CSV export) | Maximum control, custom workflows |
