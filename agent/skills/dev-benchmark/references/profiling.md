# Profiling & Tracing Concepts

Language-agnostic profiling knowledge. Profile before optimizing - every optimization should be preceded by data that validates the root cause. Do not apply automated fixes (`--fix` flags and similar): interpret the data, apply targeted changes manually, and re-measure.

For the Go tooling that implements these concepts (pprof, execution tracer), see [golang.md](../golang.md) and its references.

## Match the Data Type to the Symptom

Before capturing anything, decide which kind of data can answer your question:

| Symptom / question | Data type |
| --- | --- |
| Where does CPU time go? | CPU sampling profile |
| Why so many allocations (GC pressure)? | Allocation tracking (churn) |
| Why does memory keep growing? | Live-memory snapshots, diffed over time |
| CPU mostly idle but requests slow | Wait analysis: lock contention, blocking, I/O |
| What happens when, on a timeline? | Execution tracing |
| How do concurrent tasks interact / block each other? | Tracing or contention profiles |

## Sampling Profiler vs Tracing

- **Sampling profilers** (pprof-style) periodically capture what is running. Low overhead, statistical view; answer "where" time and memory go. Start here.
- **Tracers** record every state transition (when things start, block, resume, finish). Higher overhead and data volume; answer "when" and "why is nothing running". Use when the sampler shows low utilization but latency is high, or you need a wall-clock timeline of concurrent operations.

Rule of thumb: start with the sampler (cheaper, simpler output). Escalate to tracing when "where" is answered but "when/why" is not.

## Reading Hierarchical Profiles

Profiles are usually presented as call trees with two cost dimensions:

- **Self time** (flat) - spent in the function itself, excluding callees.
- **Cumulative time** (cum) - self plus everything it calls.

Interpretation rules:

- **High self time** - the function's own code is expensive. Optimize the algorithm, data structure, or implementation directly.
- **High cumulative, low self** - a coordinator or dispatcher; the cost is in the callees. Drill into callees, or reduce how often it is called.
- **Framework/runtime/library frames dominating** - these are symptoms, not causes. Follow the cumulative dimension upward to find which of *your* functions triggers them; that is the optimization target.
- **Drill to line level** once the function is identified - most profilers can annotate source lines with per-line cost and show callers/callees for a one-hop neighborhood of the call graph.

## Recurring Patterns

Learn to recognize these shapes - they tell you what class of problem you're dealing with before you start fixing.

- **Allocation churn** - many short-lived allocations: each is cheap individually, but the aggregate volume drives GC pressure. Look for allocation-heavy constructs in hot paths (error wrapping, boxing, conversions, growing collections without capacity).
- **Memory leak** - live memory growing over time under constant load. Take two snapshots minutes apart and diff them: the objects that grew reveal the leak source. Unbounded caches and forgotten references are typical causes.
- **Contention hot, CPU idle** - work is serialized on a lock or single resource rather than computed. Shrink critical sections, shard the resource, or remove the single point.
- **Many waiters on one resource** - serialization bottleneck; the throughput ceiling is the speed of that single point. Fan the work out to parallel queues/shards.

## Capture Overhead

Profiling and tracing are not free:

- Profiling consumes CPU during the capture window and can skew the very measurements you take. Don't run captures back-to-back in production; space them out.
- Traces generate data at MB/s. Keep capture windows short (seconds, not minutes).
- Continuous profiling in production has an always-on per-instance overhead cost - enable on a subset of instances or on demand.
