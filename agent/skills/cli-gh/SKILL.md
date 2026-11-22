---
name: cli-gh
description: "Interact with GitHub using the `gh` CLI. Supports issues, PRs, CI runs, fork-aware PR creation, upstream sync, dependabot bulk merge, and automated PR+CI+merge workflows. Use when working with GitHub issues, PRs, or CI runs via the gh CLI."
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Pull Requests

Check CI status on a pull request:

```bash
gh pr checks <pr-number> --repo owner/repo
```

List recent workflow runs:

```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:

```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:

```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## Issues

**Never pass issue/PR bodies inline** (`--body "..."` or `--body '...'`): backticks, `$`, and parens get command-substituted by the shell, silently mangling the body. Always write the body to a file (write tool, not a shell heredoc) and pass it with `--body-file`:

```bash
# create
gh issue create --repo owner/repo --title "..." --label compiler --body-file /tmp/issue.md
# update existing body
gh issue edit 123 --repo owner/repo --body-file /tmp/issue.md
```

On `gh issue create/edit` and `gh pr create/edit`, `-F` is an alias for `--body-file` (a bare path), not the `gh api` field syntax — `-F body=@file` fails with a misleading `open body=@file: no such file or directory` because the whole `body=@...` string is taken as the path. The `key=@file` form is only valid for `gh api -F`.

Formal blocking relationships between issues (newer gh):

```bash
gh issue edit 123 --repo owner/repo --add-blocked-by 456   # or --add-blocking
```

If `add-blocked-by` errors with "Target issue has already been taken", the relationship already exists — don't retry.

## Create a PR

```bash
gh pr create --title "Title" --body "Description"
gh pr create --fill  # Auto-fill from commits
```

## Merge a PR

Wait for CI to pass on a pull request, then squash merge it:

```bash
# Get target repo (handles forks)
repo=$(gh repo view --json isFork,parent,nameWithOwner --jq 'if .isFork then .parent.owner.login + "/" + .parent.name else .nameWithOwner end')

# Wait for CI, then squash merge
gh pr checks <pr-number> --repo "$repo" --watch --fail-fast && gh pr merge <pr-number> --repo "$repo" --squash
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get pull request with specific fields:

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output. Use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```
