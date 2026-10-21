#!/usr/bin/env bash
set -euo pipefail
jq -s '.[0] * .[1]' base.json patch.json > merged.json
