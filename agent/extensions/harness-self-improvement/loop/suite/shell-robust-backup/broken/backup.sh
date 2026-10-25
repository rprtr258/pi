#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$1"
DEST_DIR="$2"

if [ ! -d "$SRC_DIR" ]; then
  echo "backup.sh: missing source" >&2
  exit 1
fi

tar -czf "$DEST_DIR/backup.tar.gz" -C "$SRC_DIR" .
