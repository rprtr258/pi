#!/usr/bin/env bash
set -euo pipefail
# Deterministically broken: '200' count is off by one and '301' is never printed.
awk '{count[$1]++} END {print "200", count["200"] + 1; print "404", count["404"]; print "500", count["500"]}' events.log
