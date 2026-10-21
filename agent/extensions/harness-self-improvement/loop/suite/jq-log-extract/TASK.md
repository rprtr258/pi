---
name: jq-log-extract
description: Extract ERROR messages from a JSON-lines log with jq, sorted by timestamp.
timeout_s: 120
---
Create a JSON-lines log and a jq-based extraction script. Work entirely inside
this workspace with shell commands. No network access is needed.

1. Create `app.log` in this workspace with exactly these 10 lines (one JSON
   object per line; one line is intentionally not valid JSON):

   {"ts":"2024-03-01T10:00:00Z","level":"INFO","msg":"boot"}
   {"ts":"2024-03-01T10:00:05Z","level":"ERROR","msg":"db connection refused"}
   {"ts":"2024-03-01T10:00:10Z","level":"WARN","msg":"retry 1"}
   {"ts":"2024-03-01T10:00:15Z","level":"INFO","msg":"db connected"}
   {"ts":"2024-03-01T10:01:00Z","level":"ERROR","msg":"timeout on /api/users"}
   {"ts":"2024-03-01T10:01:30Z","level":"ERROR","msg":"cache miss storm"}
   not-json-at-all
   {"ts":"2024-03-01T10:02:00Z","level":"WARN","msg":"slow query"}
   {"ts":"2024-03-01T10:02:30Z","level":"INFO","msg":"shutdown"}
   {"ts":"2024-03-01T09:59:00Z","level":"ERROR","msg":"clock skew detected"}

2. Create `extract-errors.sh` in this workspace, an executable bash script that:
   - takes no arguments and reads `app.log` from the current directory;
   - uses `jq` to process the log;
   - prints the `msg` value of every entry whose `level` is `ERROR`, one per
     line, sorted by `ts` ascending;
   - silently skips lines that are not valid JSON;
   - writes nothing to the workspace — output goes to stdout only.
3. Make `extract-errors.sh` executable.
