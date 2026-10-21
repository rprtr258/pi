#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: backup.sh SRC_DIR DEST_DIR" >&2
  exit 2
fi

SRC_DIR="$1"
DEST_DIR="$2"

if [ ! -d "$SRC_DIR" ]; then
  echo "backup.sh: source directory does not exist: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
tar -czf "$DEST_DIR/backup.tar.gz" -C "$SRC_DIR" .
