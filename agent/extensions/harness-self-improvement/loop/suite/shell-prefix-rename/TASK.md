---
name: shell-prefix-rename
description: Rename files to zero-padded numbered names per a spec, preserving contents.
timeout_s: 120
---
Create files and rename them according to a spec. Work entirely inside this
workspace with shell commands. No network access is needed.

1. Create a directory `docs/` in this workspace containing exactly these three
   files with exactly these contents:
   - `b.txt` containing one line: `content B`
   - `a.txt` containing one line: `content A`
   - `c.txt` containing one line: `content C`

2. Rename the files inside `docs/` so that they are numbered by their original
   name in ascending order, zero-padded to two digits, keeping the `.txt`
   extension. The result must be exactly:
   - `docs/01-a.txt` containing one line: `content A`
   - `docs/02-b.txt` containing one line: `content B`
   - `docs/03-c.txt` containing one line: `content C`

   The old names (`a.txt`, `b.txt`, `c.txt`) must no longer exist in `docs/`,
   and file contents must be unchanged.
3. Create nothing else; leave `docs/` containing only the three renamed files.
