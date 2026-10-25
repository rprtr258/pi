---
name: git-branch-recovery
description: Recover a lost git commit (branch was reset) and restore its changes on main.
timeout_s: 120
---
Recover lost work from a git repository. Work entirely inside this workspace
with shell commands. No network access is needed.

1. In this workspace, run `git init -b main repo`. Configure it locally:
   `git -C repo config user.name "Agent"` and
   `git -C repo config user.email "agent@example.com"`.
2. In `repo/`, create `README.md` containing exactly one line: `project`.
   Commit on `main` with the message `init`.
3. Create `notes.txt` containing exactly one line: `gold=42`. Commit with the
   message `important fix`.
4. Now lose the commit: run `git reset --hard HEAD~1` on `main`, so `notes.txt`
   is gone from the working tree and `important fix` is reachable only through
   the reflog.
5. Recover the lost commit: bring its changes back so that `main` ends with a
   single new commit whose message is exactly `important fix`, whose tree
   contains `notes.txt` with the line `gold=42`, and whose parent is the `init`
   commit. Use the reflog (e.g. `git reflog`) to find the lost commit; either
   cherry-pick it or otherwise restore its content as described. The final
   history must be exactly 2 commits: `init`, then `important fix`.
6. Leave the working tree clean.
