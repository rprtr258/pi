#!/usr/bin/env bash
set -euo pipefail
jq -s '.[1] * .[0]' base.json patch.json > merged.json
