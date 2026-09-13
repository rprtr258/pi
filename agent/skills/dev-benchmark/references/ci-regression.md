# CI Benchmark Regression Detection

> **Run benchmarks in CI only, not on local machines.** Local benchmark results are noisy due to background processes, thermal throttling, and inconsistent CPU frequency - regressions detected locally are unreliable and waste developer time. Even shared CI runners can produce significant variance (5-10%); use statistical methods with multiple iterations and relative comparisons to filter noise, or invest in dedicated benchmark runners for critical paths.

## Gating Strategies

Two complementary approaches:

- **PR gating** - run base and head benchmarks in the same CI job, compare statistically, and fail the PR when a regression threshold is exceeded. Catches regressions before merge.
- **Trend tracking** - publish benchmark results after every merge to a dashboard to watch long-term drift. Complements gating because small per-PR regressions accumulate invisibly.

Set thresholds relative to your runner noise (see Noisy Neighbor Mitigation below). Apply stricter thresholds only to critical-path benchmarks.

Tool implementations are language-specific - for Go, see [Go CI Benchmark Tools](./go-ci-tools.md).

## Noisy Neighbor Mitigation

Cloud CI environments share hardware with other jobs. Expect 5-10% variance even on quiet machines.

### Why CI benchmarks are noisy

- **Shared CPU/memory** - other CI jobs compete for resources
- **Thermal throttling** - sustained load reduces clock speed
- **Different hardware across runs** - CI runners may have different specs
- **Kernel scheduling** - context switches add unpredictable latency
- **Disk I/O contention** - shared storage affects I/O-bound benchmarks

### Strategies

**Statistical rigor** - collect enough samples and compare statistically (see [Benchmark Methodology](./methodology.md)). A single run is meaningless. Statistical tests filter out noise-induced false positives.

**Relative comparison in same job** - run both base and head benchmarks in the same CI job on the same machine, rather than comparing against historical absolute values. This cancels out machine-to-machine variation. Have the CI job check out both refs and measure both versions in one run.

**Dedicated benchmark runners** - for critical path benchmarks, use self-hosted CI runners with no other workloads. This eliminates noisy neighbors entirely but costs more infrastructure.

**Conservative thresholds** - set regression thresholds higher on shared CI (20%+) than on dedicated runners (10%). Tight thresholds on noisy environments produce false positives that erode trust. GitHub-hosted runners show ~2-3% coefficient of variation in the best case; to guarantee <1% false positive rate, you need a 7%+ performance gate.

**Never "retry until pass"** - rerunning benchmarks until they pass introduces selection bias. If a benchmark is flaky, fix the noise source (more iterations, dedicated runner, wider threshold) rather than retrying.

## System Tuning for Self-Hosted Runners

> **WARNING: These commands modify kernel and CPU settings. Apply them ONLY on dedicated CI runners, NEVER on developer machines or shared servers.**

When you control the CI hardware, these settings dramatically reduce benchmark variance by eliminating the main sources of non-determinism.

### Disable CPU frequency scaling

Variable CPU frequency makes benchmark times meaningless - the same code runs at different speeds depending on load and thermals:

```bash
# Set all CPUs to "performance" governor (fixed maximum frequency)
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
```

### Disable Turbo Boost

Turbo Boost temporarily increases clock speed but throttles under sustained load, creating variance between the start and end of a benchmark run:

```bash
# Intel
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo

# AMD
echo 0 | sudo tee /sys/devices/system/cpu/cpufreq/boost
```

### Pin benchmarks to specific CPU cores

Prevents the OS from migrating the benchmark process across cores, which causes cache thrashing (L1/L2 caches are per-core):

```bash
# Pin to cores 2 and 3 (leave cores 0-1 for OS and other processes)
taskset -c 2,3 <your benchmark command>
```

### Disable SMT (Hyper-Threading)

SMT shares execution units between logical cores on the same physical core, causing unpredictable contention:

```bash
# Disable SMT system-wide
echo off | sudo tee /sys/devices/system/cpu/smt/control

# Or disable individual sibling cores (check /sys/devices/system/cpu/cpu*/topology/thread_siblings_list)
echo 0 | sudo tee /sys/devices/system/cpu/cpu1/online  # if cpu0 and cpu1 are siblings
```

### Combined CI setup script

```bash
#!/bin/bash
# benchmark-setup.sh - run on self-hosted CI runner before benchmarks
set -euo pipefail

echo "=== Configuring CPU for stable benchmarks ==="
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
echo 1 | sudo tee /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || true
echo off | sudo tee /sys/devices/system/cpu/smt/control 2>/dev/null || true

echo "=== Running benchmarks on isolated cores ==="
taskset -c 2,3 <your benchmark command> | tee bench.txt
```
