# Benchmark Methodology

Language-agnostic statistical rigor for before/after performance comparisons. A single benchmark run tells you nothing about variance - it cannot distinguish a real change from noise. Never draw conclusions from one run.

Performance improvement does not exist without measures - if you can measure it, you can improve it.

## The A/B Workflow

1. **Measure baseline** on the unmodified code. Save the results.
2. **Make the change.**
3. **Measure again** with identical settings: same benchmark, same flags, same sample count, same machine, same load conditions.
4. **Compare statistically.** Report the median difference with a confidence interval, not two single numbers.

Anything that differs between the two runs (machine, background load, sample count, environment) becomes noise you cannot separate from the effect you are measuring.

## Sample Counts

Each run produces one data point. You need enough samples to compute a meaningful confidence interval:

| Scenario | Minimum samples | Why |
| --- | --- | --- |
| Quick local check | 6 | Enough for a rough confidence interval; fast feedback loop |
| Pre-merge comparison | 10 | Standard for detecting moderate (>5%) changes with confidence |
| Detecting small changes (<5%) | 20-30 | More samples narrow the CI; needed when signal is small relative to noise |
| Noisy CI environment | 20+ | Shared CI runners have higher variance; more runs compensate |

## Reading the Comparison

- **Median**, not mean - outliers from OS jitter don't skew the central value.
- **± N%** - half-width of the confidence interval. Low (≤2%) = stable measurement. High (>5%) = noisy; investigate noise sources before trusting any delta.
- **p-value** - probability that the observed difference is noise. Below your threshold (typically 0.05) = statistically significant.
- **"No significant difference"** - the change might be exactly zero. Never report it as an improvement. Options: increase the sample count once, reduce noise sources, or accept that the change has no measurable effect.

## Never Retry Until Significant

Rerunning a comparison until the result flips to "improvement" is selection bias (p-hacking) - you are cherry-picking runs. At a 0.05 threshold, expect ~5% of comparisons to randomly report significance with no real change (false positives). Don't chase them. Increase the sample count **once** and accept the result.

## Reducing Systematic Bias

Sequential runs (all baseline, then all change) are vulnerable to systematic bias: thermal throttling builds up over time, background processes come and go, CPU frequency scaling adapts.

- **Alternate A and B** across iterations instead of running all of one, then all of the other.
- **Measure steady-state execution only.** Exclude compilation, setup, and warm-up from the timed portion.
- **Same machine, same conditions, both runs.** Comparing across machines or days gives incomparable baselines.

## Common Pitfalls

| Pitfall | Why it's wrong | Fix |
| --- | --- | --- |
| Single run | No variance information; no way to compute confidence | Always ≥6 samples, prefer ≥10 |
| Laptop on battery | CPU throttles to save power; variance explodes | Plug in, disable power saving, or use a desktop/server |
| Browser/IDE open | Background processes steal CPU cycles; adds noise | Close unnecessary applications, or accept wider intervals |
| Rerunning until significant | Selection bias - cherry-picking runs that showed improvement | Run once with a high sample count, accept the result |
| Comparing across machines | Different CPUs, memory, OS = incomparable baselines | Same machine, same conditions, both runs |
| Not alternating A/B | Systematic bias from thermal throttling, background load drift | Alternate runs between versions |
| Timing build/setup work | Compilation and startup overhead vary and contaminate results | Measure only steady-state execution |
| Ignoring wide intervals (± >5%) | Results look significant but variance is too high to be trustworthy | Fix the noise first, then compare; or increase sample count |
| Unequal sample sizes | Biases the comparison | Use the same sample count for all inputs |
