---
name: git-rebase-fix
description: Rewrite git history so a typo fix lands inside the original commit instead of a new one.
timeout_s: 120
---
Create a git repository and rewrite its history. Work entirely inside this
workspace with shell commands. No network access is needed.

1. In this workspace, run `git init -b main repo`. Configure it locally:
   `git -C repo config user.name "Agent"` and
   `git -C repo config user.email "agent@example.com"`.
2. In `repo/`, create `notes.txt` containing exactly one line: `alpha`.
   Commit on `main` with the message `add alpha`.
3. Append a line `beta` to `notes.txt`; commit with the message `add beta`.
4. Append a line `gammma` to `notes.txt` (this commit intentionally contains a
   typo in its content); commit with the message `add gamma`.
5. Append a line `delta` to `notes.txt`; commit with the message `add delta`.
6. The history is now 4 linear commits. Rewrite the history so that the typo is
   fixed inside the `add gamma` commit itself: the tree of that commit must
   contain `gamma` (not `gammma`). Requirements:
   - exactly 4 commits remain on `main`, no merge commits;
   - the commit messages stay exactly, in order: `add alpha`, `add beta`,
     `add gamma`, `add delta`;
   - no commit anywhere in the history has `gammma` in its tree;
   - no new "fix" commit may be added.
7. The final `notes.txt` must contain, in order: `alpha`, `beta`, `gamma`,
   `delta` (one per line). Leave the working tree clean.
