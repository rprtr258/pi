---
name: subagents
description: Delegate work to subagent Pi instances using a tmux + bash CLI. Use when fanning out tasks to background agents, running an existing agent template against a task, forking the current session into a subagent, or waiting on and collecting subagent output. A minimalist alternative to pi-subagents.
---

# Subagents

`subagents` launches subagent Pi instances in a private tmux server and
collects their output. Fire-and-forget by default; opt into blocking with
`--wait`. Each run is headless (`pi --mode json -p`): it streams a live event
feed you can watch with `attach`/`inspect`, then auto-closes its pane on finish.
The raw stream persists to `events.jsonl` and the clean final answer to `out`.

Script: `~/.pi/agent/skills/subagents/subagents`

```bash
sa=~/.pi/agent/skills/subagents/subagents
```

## Two layers

- `spawn` — low-level. Explicit pi-like flags, no template knowledge.
- `template <agent> "<task>"` — sugar. Reads `~/.pi/agent/agents/<agent>.md`
  frontmatter and maps it to `spawn` flags. Use this to reuse existing agents.
  Requires `yq`; `spawn` itself needs `tmux`, `pi`, and `jq`.

## Watching a run

A run streams live, so `attach <id>` (or `inspect <id>` while live) shows the
subagent's thinking, tool calls, and answer as they happen. To watch from the
start, `spawn`/`template` without `--wait`, then `attach` while it is live.
You cannot type into a headless run; interrupt it with `kill <id>` (or Ctrl-C
in an attached pane).

## Workflow

Fan out, keep working, collect later:

```bash
$sa template researcher "compare X and Y" --parent-session <id|path>
$sa list                      # id, agent, status (live|done|failed), task
$sa wait <id>                 # block, print the answer, exit with its code
```

Block inline when you need the result now:

```bash
$sa template scout "map the auth module" --wait
```

## Commands

| command                                            | behavior                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn "<task>" [flags]`                           | launch from explicit flags; prints id, out path, attach hint                                                                                 |
| `template <agent> "<task>" [spawn-flag overrides]` | launch from an agent template; any spawn flag overrides the frontmatter                                                                      |
| `wait <id> [--timeout <s>]`                        | block until finished, print `out`, exit with the subagent's code (default timeout 600s; on timeout the run stays alive and `wait` exits 124) |
| `list`                                             | all runs: id, agent, status, task snippet                                                                                                    |
| `inspect <id>`                                     | finished → print output; live → capture the pane                                                                                             |
| `attach <id>`                                      | attach to the live tmux session (human-facing)                                                                                               |
| `kill <id>`                                        | kill a live run                                                                                                                              |
| `clean <id\|--all>`                                | remove finished run dirs (refuses live runs)                                                                                                 |

`<id>` accepts an exact id or any unique prefix.

## spawn flags

```
--model <provider/id>          --thinking <off|minimal|low|medium|high|xhigh>
--tools <list>                 --skill <path>   (repeatable, EXPLICIT paths)
--system-prompt <text|@file>   --append-system-prompt <text|@file>
--no-skills                    --no-context-files
--parent-session <path|id>     fork the parent session (path must exist, else error)
--name <hint>                  --cwd <dir>      --wait
```

- `--parent-session` present and resolvable → `pi --fork` (subagent inherits
  parent context). A path that does not exist is a hard error. Absent → fresh
  session.
- `--skill` takes explicit paths, not names. Name resolution happens only in
  `template`.

## Overriding a template

`template` accepts any spawn flag and forwards it after the frontmatter-derived
flags. spawn keeps the last value for scalars, so the CLI wins:

```bash
$sa template researcher "summarize X" --model anthropic/claude-sonnet-4-6 --thinking low
```

- Scalars (`--model`, `--thinking`, `--tools`, `--system-prompt`, `--cwd`, …)
  replace the frontmatter value.
- `--skill` is additive — it loads alongside the template's skills.
- `--parent-session`, `--name`, `--wait` work here too.
- `--append-system-prompt`/`--system-prompt` replace the body-derived prompt
  (spawn holds a single system prompt), they do not stack onto it.

## template field mapping

`template` looks up `~/.pi/agent/agents/<agent>.md` and maps frontmatter:

| frontmatter                    | mapping                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `model`                        | `--model` (empty/absent → omit, inherit caller default)                            |
| `thinking`                     | `--thinking`                                                                       |
| `tools`                        | `--tools`, runtime-only entries (e.g. `intercom`) stripped                         |
| `skills`                       | comma names → `--skill ~/.pi/agent/skills/<name>` each                             |
| body + `systemPromptMode`      | `replace` (default) → `--system-prompt`; `append` → `--append-system-prompt`       |
| `inheritProjectContext: false` | `--no-context-files`                                                               |
| `inheritSkills`                | anything but explicit `true` → `--no-skills` (explicit `--skill` paths still load) |

Templates are reused as-is. Fields with no pi CLI equivalent are ignored.
Contradictions (e.g. a missing skill or parent path) fail loud. Any field can
be overridden per-call (see Overriding a template).

## Where things live

- Run artifacts: `~/.cache/pi-subagents/runs/<id>/` — `out` (clean answer),
  `events.jsonl` (raw event stream), `err`, `exit`, `task`, `agent`, `cwd`,
  `session-loc`, the `session/` dir, and `run.sh` (the exact command/record).
- Private tmux server: `~/.cache/pi-subagents/tmux.sock` (never the user's
  personal tmux).
- Cleanup is explicit (`clean`); there is no auto-prune.

Override locations with `SUBAGENTS_HOME`, `SUBAGENTS_AGENTS_DIR`,
`SUBAGENTS_SKILLS_DIR`.
