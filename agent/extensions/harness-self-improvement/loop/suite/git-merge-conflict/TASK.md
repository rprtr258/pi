---
name: git-merge-conflict
description: Resolve a git merge conflict between two branches and commit the merge.
timeout_s: 120
---
Create a git repository and resolve a merge conflict. Work entirely inside this
workspace; do all steps with shell commands. No network access is needed.

1. In this workspace, run `git init -b main repo`, creating a repository in the
   subdirectory `repo/`. Configure it locally:
   `git -C repo config user.name "Agent"` and
   `git -C repo config user.email "agent@example.com"`.
2. In `repo/`, create `app.conf` with exactly this content (including the blank
   line between sections):

   ```
   [server]
   port=8080

   [billing]
   discount=0.1
   ```

   Commit it on `main` with the message `initial config`.
3. Create and switch to a branch `feature/tax`. Change `discount=0.1` to
   `discount=0.2` and add a new line `vat=0.05` immediately after the discount
   line (inside the `[billing]` section). Commit with the message `tax update`.
4. Switch back to `main`. Change `discount=0.1` to `discount=0.15`. Commit with
   the message `adjust discount`.
5. Merge `feature/tax` into `main`. Git will report a conflict in `app.conf`.
6. Resolve the conflict so that the `[billing]` section ends up as:

   ```
   [billing]
   discount=0.2
   vat=0.05
   ```

   The `[server]` section must stay unchanged. Stage the file and commit the
   merge with the message exactly `Merge branch 'feature/tax'`.
7. Leave the repository with a clean working tree (nothing staged or modified).
