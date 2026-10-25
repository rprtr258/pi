---
name: shell-robust-backup
description: Write a robust bash backup script with argument validation and error handling.
timeout_s: 120
---
Write a robust bash backup script. Work entirely inside this workspace with
shell commands. No network access is needed.

Create `backup.sh` in this workspace and make it executable. It must be a bash
script with this exact command-line behavior:

Usage: `backup.sh SRC_DIR DEST_DIR`

1. If the argument count is not exactly 2, print a usage line containing the
   word `Usage` to stderr and exit with status 2.
2. If `SRC_DIR` does not exist or is not a directory, print an error message to
   stderr and exit with status 1.
3. If `DEST_DIR` does not exist, create it (including any missing parent
   directories). If it already exists, leave it in place.
4. Create an archive at `DEST_DIR/backup.tar.gz` containing the CONTENTS of
   `SRC_DIR` (so `tar -tzf DEST_DIR/backup.tar.gz` lists the files inside the
   source directory, not a leading directory wrapper). Overwrite any existing
   archive.
5. Exit 0 on success. Use `set -euo pipefail` in the script and quote all
   variable expansions so paths with spaces work.
6. The archive name must be exactly `backup.tar.gz` — no timestamps or other
   variation. Do not use the network or anything outside the two arguments.

Example: after `mkdir -p src && echo hi > src/a.txt && ./backup.sh src out`,
the file `out/backup.tar.gz` exists and `tar -tzf out/backup.tar.gz` lists
`./a.txt` (or `a.txt`).
