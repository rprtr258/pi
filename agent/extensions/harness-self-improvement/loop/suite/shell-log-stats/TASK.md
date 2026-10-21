---
name: shell-log-stats
description: Aggregate status-code counts from a log file with a bash script.
timeout_s: 120
---
Create a log file and an aggregation script. Work entirely inside this
workspace with shell commands. No network access is needed.

1. Create `events.log` in this workspace with exactly these 8 lines (format:
   `<STATUS> <path>`):

   200 /home
   404 /missing
   200 /about
   500 /broken
   200 /home
   404 /missing
   301 /old
   200 /contact

2. Create `stats.sh` in this workspace, an executable bash script that:
   - takes no arguments and reads `events.log` from the current directory;
   - prints one line per distinct status code in the file, formatted
     `<STATUS> <COUNT>` (single space between them);
   - sorts the output by status code ascending (lexicographic order);
   - writes nothing to the workspace — output goes to stdout only.
3. Make `stats.sh` executable.
