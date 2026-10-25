#!/usr/bin/env bash
# Prepares a materialized workspace copy for git-branch-recovery.
# The fixture stores the repo's git database as git-dir/ (see loop/suite/README.md).
set -euo pipefail
mv "$1/repo/git-dir" "$1/repo/.git"
