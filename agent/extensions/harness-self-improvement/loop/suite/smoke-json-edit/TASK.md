---
name: smoke-json-edit
description: Smoke check — add the key "enabled": true to a small JSON config
timeout_s: 60
---
Create a file named `config.json` in your current working directory with
exactly this content:

```json
{"name": "demo", "version": 1}
```

Then edit it (with any tool you like) to add one key: `"enabled"` with the
boolean value `true`. The final `config.json` must be valid JSON containing
all three keys: `name` (string "demo"), `version` (number 1) and `enabled`
(boolean true). Then finish.
