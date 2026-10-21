#!/usr/bin/env bash
set -euo pipefail
tail -n +2 users.csv | jq -Rn '[
  inputs
  | select(length > 0)
  | split(",")
  | {id: (.[0] | tonumber), name: .[1], age: (.[2] | tonumber), active: (.[3] == "yes")}
]' > users.json
