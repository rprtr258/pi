#!/usr/bin/env bash
set -euo pipefail
awk '{count[$1]++} END {for (s in count) print s, count[s]}' events.log | sort
