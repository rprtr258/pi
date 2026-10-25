#!/usr/bin/env bash
set -euo pipefail
# BROKEN fixture: sorts descending instead of ascending. Must fail the checker
# deterministically on every awk (unsorted output alone only fails on awks whose
# `for (s in ...)` order isn't already sorted — e.g. gawk).
awk '{count[$1]++} END {for (s in count) print s, count[s]}' events.log | sort -r
