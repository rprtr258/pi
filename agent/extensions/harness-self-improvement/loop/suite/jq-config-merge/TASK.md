---
name: jq-config-merge
description: Deep-merge two JSON config files with jq, patch values winning.
timeout_s: 120
---
Create two JSON config files and a jq-based deep-merge script. Work entirely
inside this workspace with shell commands. No network access is needed.

1. Create `base.json` in this workspace with exactly this content:

```json
{
  "server": {"host": "localhost", "port": 8080, "tls": false},
  "tags": ["a", "b"],
  "feature": {"cache": {"ttl": 60}}
}
```

2. Create `patch.json` in this workspace with exactly this content:

```json
{
  "server": {"port": 9090},
  "tags": ["x"],
  "feature": {"cache": {"ttl": 120}, "beta": true}
}
```

3. Create `merge.sh` in this workspace, an executable bash script that:
   - takes no arguments, reads `base.json` and `patch.json` from the current
     directory;
   - uses `jq` to deep-merge them into `merged.json` in the current directory;
   - merge semantics: keys from `patch.json` override `base.json` recursively;
     objects merge key-by-key, arrays and scalars are replaced (not
     concatenated);
   - creates no other files.
4. Make `merge.sh` executable.

The expected result of the merge is:

```json
{
  "server": {"host": "localhost", "port": 9090, "tls": false},
  "tags": ["x"],
  "feature": {"cache": {"ttl": 120}, "beta": true}
}
```
