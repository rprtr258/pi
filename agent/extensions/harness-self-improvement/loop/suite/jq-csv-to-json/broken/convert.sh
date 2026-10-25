#!/usr/bin/env bash
set -euo pipefail
{
  echo '['
  tail -n +2 users.csv | awk -F, '{printf "%s{\"id\": \"%s\", \"name\": \"%s\", \"age\": \"%s\", \"active\": \"%s\"}", (NR>1 ? ",\n" : ""), $1, $2, $3, $4}'
  echo ''
  echo ']'
} > users.json
