---
name: dev-using-git-worktrees
description: Use when starting feature work that needs isolation from the current workspace, before executing implementation plans, or when asked to open a new worktree/workspace, work in a separate tree, compare a worktree to main, create a PR from a worktree, or delete a worktree - creates isolated jj workspaces in mktemp directories with baseline verification
---

# Using jj Workspaces

## Overview

jj workspaces create isolated working copies under the same repo, each with its own `@` commit — the jj equivalent of git worktrees. Creating them in `mktemp -d` directories means: no directory-selection questions, no .gitignore verification, zero risk of polluting the repo.

**Core principle:** mktemp location + auto-detected setup + verified baseline.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Create a Workspace

```bash
ws_name="<short-kebab-name>"          # e.g. auth-refactor
ws_dir="$(mktemp -d)/$ws_name"
jj workspace add "$ws_dir"
cd "$ws_dir"
```

Options:

- `-r <revset>` — base the new working-copy commit on another revision (e.g. `-r main`). Default: a fresh commit on the parent(s) of the current workspace's `@`, leaving your in-progress work untouched.
- `-m "description"` — set the initial change description.
- The workspace name defaults to the basename of the destination (so `.../auth-refactor` → `auth-refactor`). Name→path mappings: `jj workspace list`.

Pure git repo (no `.jj/`)? Either run `jj git init --colocate` first, or fall back to `git worktree add "$(mktemp -d)/$ws_name" -b <branch>`.

## Where Things Live

- Workspaces are under `/tmp` (mktemp). They survive reboots on most Linux systems, but systemd-tmpfiles may purge `/tmp` — describe and push changes regularly; never leave unpushed work only in a /tmp workspace.
- If a directory gets purged while still tracked, `jj workspace forget <name>` cleans up the stale entry.
- If the repo warns about a stale workspace, `jj workspace update-stale`.

## After Creation

### 1. Run Project Setup

Auto-detect and run appropriate setup:

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

### 2. Verify Clean Baseline

Run tests to ensure the workspace starts clean:

```bash
# Examples - use project-appropriate command
npm test
cargo test
pytest
go test ./...
```

**If tests fail:** Report failures, ask whether to proceed or investigate.

**If tests pass:** Report ready.

### 3. Report Location

```
Workspace ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| Create isolated workspace | `jj workspace add "$(mktemp -d)/<name>"` |
| Base on main instead of current @ | add `-r main` |
| Find a workspace's path | `jj workspace list` |
| Repo warns workspace is stale | `jj workspace update-stale` |
| Directory purged by tmp cleanup | `jj workspace forget <name>` |
| Tests fail during baseline | Report failures + ask |
| Pure git repo (no .jj/) | `jj git init --colocate` or git worktree fallback |
| No package.json/Cargo.toml | Skip dependency install |

## Common Mistakes

### Assuming @ is shared

- **Problem:** Expecting work in one workspace to appear in the other
- **Fix:** Each workspace has its own working-copy commit; `jj log` shows them as `<workspace-name>@`

### Leaving work only in /tmp

- **Problem:** tmpfiles cleanup can purge the directory
- **Fix:** `jj describe` + `jj git push` (or `jj abandon` for throwaways) before walking away

### Destroying with live work

- **Problem:** `jj workspace forget` abandons that workspace's working-copy commit
- **Fix:** Describe + `jj new` any work worth keeping before forgetting

### Proceeding with failing tests

- **Problem:** Can't distinguish new bugs from pre-existing issues
- **Fix:** Report failures, get explicit permission to proceed

### Hardcoding setup commands

- **Problem:** Breaks on projects using different tools
- **Fix:** Auto-detect from project files (package.json, etc.)

## Example Workflow

```
You: I'm using the using-git-worktrees skill to set up an isolated workspace.

[Create: jj workspace add "$(mktemp -d)/auth-refactor"]
[cd into the new workspace; jj log confirms a fresh commit on the same parent]
[Run npm install]
[Run npm test - 47 passing]

Workspace ready at /tmp/tmp.Xk3f2/auth-refactor
Tests passing (47 tests, 0 failures)
Ready to implement auth feature
```

## Red Flags

**Never:**
- Work only inside /tmp without describing/pushing regularly
- Destroy a workspace with undescribed work on @
- Skip baseline test verification
- Proceed with failing tests without asking

**Always:**
- Create in a mktemp directory (never inside the repo — no .gitignore juggling needed)
- Auto-detect and run project setup
- Verify clean test baseline

## Notes for Agents

- When asked to create a PR: describe the change, push, then use the `gh` skill. Colocated repos push with `jj git push`.
- When asked to integrate directly into main, rebase onto main (squash if desired) — a deliberate workflow, not an accidental fast-forward.
- **`FIX:` comments**: Hans may leave `# FIX: ...` comments directly in source files while reviewing a diff. Always grep for these before starting work: `grep -r "FIX:" .` — address each one, then remove the comment.

## Integration

**Called by:**
- **requirements** (Phase 4) - REQUIRED when design is approved and implementation follows
- **subagent-driven-development** - REQUIRED before executing any tasks
- Any skill needing isolated workspace
