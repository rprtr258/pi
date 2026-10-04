# Stage 0 — Preparer

Read when stage 0 begins. Dispatch the prompt below verbatim as the subagent task; fill
`<<SOURCE>>` (gitlab-mr | github-pr | local) and the source-specific ids before dispatch — the
preparer assembles the rest of `<<MR_META>>`.

## Source metadata (fill the `<<MR_META>>` block)

- **GitLab MR** (`<<SOURCE>>=gitlab-mr`, ids: `<<PROJECT_ID>>`, `<<IID>>`): project_id, iid,
  web_url, title, description, author, source -> target branches, state (opened / merged — if
  merged, stage 5 runs post factum, in the "findings for the next iteration" format),
  base_sha/head_sha (diff_refs: head = tip of the source branch, base = merge-base(target, source)).
- **GitHub PR** (`<<SOURCE>>=github-pr`, ids: `<<OWNER_REPO>>`, `<<PR_NUMBER>>`): owner/repo,
  number, web_url, title, body, author, head/base branches, base.sha / head.sha, state
  (open / merged / closed).
- **Local changes** (`<<SOURCE>>=local`, ids: `<<REPO_PATH>>`, `<<BASE_RANGE>>`): repo path,
  base..head range (working tree = HEAD vs working copy; a commit range; or a branch vs its
  merge-base with main), shortlog + `git status` summary as the description substitute.

## Branch worktree (a checkout of the reviewed head)

- remote targets (GitLab/GitHub): the clone/checkout is done in /tmp (e.g.
  `<tmp>/<date>_<repo>-<target>`) and cleans itself up after the run; do not litter the user's
  working directories (~/multirepo and the like) - only if the repo already lives there;
  familiar repo: `git worktree add <path> <head_sha>` (detached HEAD = head_sha, read-only
  during the run); unfamiliar repo: `git clone --depth 1 --branch <source> <path>` +
  `git checkout <head_sha>`; verify `git rev-parse HEAD == head_sha`.
- local target: review in place — the user's tree is the worktree; read-only during the run
  (never commit/stash/checkout); the diff comes from `git diff [<base_range>]` (working tree =
  vs HEAD).
- Stage-3 verification against real code reads from exactly this checkout.

## Prompt

```
You are the code-review preparer for a review target: a GitLab MR (source=gitlab-mr), a GitHub
PR (source=github-pr), or local git changes (source=local). Collect the run's inputs, publish
nothing.
Tasks:
1. Source details via your read channel (GitLab: MCP gitlab / glab / REST with
   project_id=<<PROJECT_ID>>, iid=<<IID>>; GitHub: gh / GitHub MCP / REST with
   owner/repo=<<OWNER_REPO>>, PR <<PR_NUMBER>>; local: git in <<REPO_PATH>> over
   <<BASE_RANGE>>). Extract title, description, author, source->target branches, state,
   web_url, base_sha/head_sha (or take them from the ready-made <<MR_META>>).
2. Prepare the worktree at head_sha: remote - clone/checkout the source branch, verify
   git rev-parse HEAD == head_sha; local - work in place, read-only, diff = git diff
   [<base_range>]. Path: <<REPO_PATH>>.
3. Assemble the diff into diff/mr.diff, files_list.txt, description.md, metadata.json.
4. Read and clone only. You do not review code and do not slice batches. Return: <<MR_META>>,
   <<REPO_PATH>>, artifact paths, detected_stack.
```
