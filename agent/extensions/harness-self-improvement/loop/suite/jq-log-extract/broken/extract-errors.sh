#!/usr/bin/env bash
set -euo pipefail
jq -r 'fromjson? | select(.level == "ERROR") | .msg' app.log
