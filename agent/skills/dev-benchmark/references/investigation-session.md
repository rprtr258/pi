# Investigation Session Setup

Tools and techniques for **temporary deep-dive performance investigation** - not everyday monitoring. These are things you enable for hours or days while debugging a specific issue, then disable.

## Setting Up a Session

Before diving into profiles, set up the environment to collect high-resolution data:

1. **Reduce Prometheus scrape interval** to <=10s on the target instance (normally 15-30s). More data points during a short investigation window reveal patterns that 30s intervals miss. Revert after investigation.

2. **Enable pprof** via environment variable - no recompile needed:

   ```bash
   kubectl set env deployment/my-service PPROF_ENABLED=true
   kubectl rollout restart deployment/my-service
   ```

3. **Enable continuous profiling** on the target instance only - not fleet-wide. Pyroscope/Parca on a single instance is manageable; on 50 replicas it overwhelms the backend.

   ```bash
   kubectl set env deployment/my-service PYROSCOPE_ENABLED=true
   kubectl rollout restart deployment/my-service
   ```

4. **Enable debug logging** via env var if needed - but only on the target instance. Debug logging has significant throughput impact:

   ```bash
   kubectl set env deployment/my-service LOG_LEVEL=debug
   kubectl rollout restart deployment/my-service
   ```

**Key principle:** all costly debug features (pprof HTTP, continuous profiling, debug log level, trace collection) SHOULD be configurable via environment variables. This allows instant toggle without recompile. Design your application to support this from day one.

## Runtime Metrics Queries

For runtime metrics to collect during the session, see [prometheus-go-metrics.md](./prometheus-go-metrics.md) - it covers the exhaustive Go runtime metric reference, deep-dive PromQL queries with interpretation, and example alerting rules.

## Host-Level Correlation

Go runtime metrics alone don't show the full picture. Host-level metrics reveal whether the problem is in your application or the infrastructure.

- **`node_exporter`** - host CPU, memory, disk I/O, network. Correlate with app metrics: high `node_cpu_seconds_total` with low `process_cpu_seconds_total` = noisy neighbor, not your app.
- **`process-exporter`** - per-process metrics on Linux. Useful when multiple services share a host.

## Cost Warnings

**Profiles and traces are expensive to collect.** Keep them short-term and localized:

- **pprof CPU profiling** - CPU-intensive during the capture window. Don't run 30s profiles back-to-back in production. Space them out.
- **Pyroscope continuous profiling** - ~2-5% CPU overhead **per instance, always-on**. At scale (hundreds of instances), this adds up in compute cost and backend storage. Enable on a subset of instances or on-demand via environment variable.
- **Execution traces** - generate large files quickly (MB/s). Capture 5-10s max. Longer traces are unwieldy and slow to analyze.
- **Debug log level** - significant throughput impact due to allocation and I/O overhead. Never leave on permanently.
- **All costly features** SHOULD be toggleable via environment variables for instant on/off without recompile. Design for this from day one.
