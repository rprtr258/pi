#!/usr/bin/env bash
# Prepares a materialized workspace copy for git-merge-conflict:
# the fixture stores the repo's git database as git-dir/ (the outer harness
# repo cannot track a nested .git), so activate it as .git before checking.
set -euo pipefail
mv "$1/repo/git-dir" "$1/repo/.git"
