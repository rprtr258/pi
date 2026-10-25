#!/usr/bin/env bash
set -euo pipefail
jq -rR 'fromjson? | select(.level == "ERROR") | [.ts, .msg] | @tsv' app.log | sort | cut -f2
