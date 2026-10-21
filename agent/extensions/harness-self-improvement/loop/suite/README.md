# Task suite — the harness objective function

Each task is a small, fully-specified coding exercise given to a probe coding
agent. A deterministic checker scores the probe's final workspace state.
The suite is what later harness steps run probes against and diff over.

## Layout

```
loop/suite/<task-name>/
  TASK.md     YAML frontmatter + prompt body (see below)
  check.ts    TypeScript checker; argv[2] = workspace path; exit 0 = pass, non-zero = fail
  ref/        pre-built FINAL workspace state the checker must pass on
  broken/     known-broken FINAL workspace state the checker must fail on
  setup.sh    OPTIONAL; prepared by the runner before the checker (see below)
```

Task names are kebab-case and category-prefixed (`git-`, `jq-`, `ts-`,
`shell-`); the category is the name prefix. Task names must never use the
`smoke-` prefix — that is reserved for a later step.

## TASK.md contract

Frontmatter is YAML with exactly these fields:

- `name` — kebab-case, must equal the directory name.
- `description` — one-line summary.
- `timeout_s` — positive integer, the probe task budget (must be ≤ 120).

The body after the frontmatter is the EXACT prompt handed to the probe coding
agent. It must be self-contained: a competent coding agent with shell access
solves it from the body alone. Tasks are offline (no network), deterministic,
and solvable in under 2 minutes. The probe creates all files it needs inside
its workspace; there are no preinstalled fixtures beyond what the prompt
instructs the probe to create. Probes work in their own subdirectory (e.g.
`repo/`) or use unambiguous file names; checkers never assert on the whole
workspace root so unrelated files cannot break them.

## check.ts contract

- Executable TypeScript run directly via a `#!/usr/bin/env bun` shebang (the
  runner spawns the file itself, no shell involved). Receives the task
  workspace path as its first CLI argument (`process.argv[2]`) and treats it
  as READ-ONLY: the checker may read the workspace and any files the probe
  created inside it, and must never create, delete, or modify anything inside
  it. The runner snapshots checksums before and after and fails the task if
  the tree changed.
- Prints human-readable findings to stdout (and diagnostics to stderr).
- Exits 0 on pass, non-zero on fail.
- Pure and deterministic: no network, no timestamps, no shared `/tmp` state.
  If the checker needs scratch space (e.g. to exercise a script with its own
  fixtures) it must create a private temp dir (`fs.mkdtempSync`) and clean it
  up.
- Must finish within 30 seconds (the runner kills and fails the task beyond
  that). Checkers should be robust to trailing whitespace and ordering where
  semantics allow (e.g. compare key-sorted JSON, sort before diff), and strict
  only where the prompt pins exact output.

## Fixture semantics (validation)

`validate` (see `loop/lib/suite.ts`) checks every task:

1. Shape: frontmatter parses with all three fields valid; `check.ts` exists
   and is executable; `ref/` and `broken/` are non-empty.
2. Checker behavior: the runner materializes the fixture into a temp copy of
   `ref/` (resp. `broken/`), runs `setup.sh` if present, then runs
   `check.ts <workspace>`:
   - against `ref/` the checker MUST exit 0;
   - against `broken/` the checker MUST exit non-zero.
   A checker that mutates the workspace, times out, or exits the wrong way
   fails validation.

## setup.sh (optional)

Some final states are awkward to store verbatim in git-managed fixtures —
e.g. a git repository's final state contains a `.git` directory, which the
outer repo cannot commit (it would be treated as an embedded repo). Such
fixtures store the git database as `git-dir/` next to the worktree, and
`setup.sh` activates it:

```bash
#!/usr/bin/env bash
set -euo pipefail
mv "$1/repo/git-dir" "$1/repo/.git"
```

The runner runs `bash <task>/setup.sh <workspace>` with cwd set to the
materialized workspace copy, after copying the fixture and before snapshot +
checker. `setup.sh` may mutate the workspace copy freely (it runs before the
no-mutation snapshot); the checker still must not mutate anything.

## Adding a task

1. `mkdir loop/suite/<category>-<name>`, write `TASK.md` (frontmatter + full
   prompt), `check.ts` (chmod +x, `#!/usr/bin/env bun` shebang), `ref/`,
   `broken/`, and `setup.sh` if the fixture needs activation.
2. Run `bun run loop/lib/suite.ts validate` — the task must PASS on `ref/`
   and FAIL on `broken/`.
