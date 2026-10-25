---
name: jq-csv-to-json
description: Convert a CSV file to typed JSON with a jq-based script.
timeout_s: 120
---
Create a CSV file and a jq-based converter script. Work entirely inside this
workspace with shell commands. No network access is needed.

1. Create `users.csv` in this workspace with exactly this content:

   id,name,age,active
   1,Alice,30,yes
   2,Bob,25,no
   3,Cara,41,yes
   4,Dan,19,yes

2. Create `convert.sh` in this workspace, an executable bash script that:
   - takes no arguments, reads `users.csv` from the current directory;
   - uses `jq` to do the conversion;
   - writes `users.json` in the current directory: a JSON array of objects,
     one per data row, each with the keys `id`, `name`, `age`, `active`;
   - types the values: `id` and `age` must be JSON numbers, `active` must be a
     JSON boolean (`yes` -> true, `no` -> false); `name` stays a string;
   - orders the array by `id` ascending;
   - creates no other files.
3. Make `convert.sh` executable.
