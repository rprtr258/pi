# Setup & Authentication

Connector setup and authentication for Plans, linked from the skill.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and runs
auth/setup for the selected local client(s) in the same step (a one-time browser
sign-in at setup — this is intended), so the first tool call in that client does
not hit an OAuth wall:

```bash
npx @agent-native/core@latest skills add visual-plan
```

After that, `/visual-plan` and `/visual-recap` are the two installed slash
commands. The other planning modes (`create-ui-plan`, `create-prototype-plan`,
`create-plan-design`, `create-visual-questions`) are MCP tools reachable from
`/visual-plan`, not separate slash commands. Pass `--no-connect` to register
the connector without authenticating, then run
`npx @agent-native/core@latest connect https://plan.agent-native.com --client all`
whenever you are ready, or choose a narrower `--client`. Auth and MCP tool
loading are per client config/session.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns `needs auth`, `Unauthorized`, or `Session terminated`,
do not keep retrying the tool. Stop and give the user the reconnect step for the
client they are using: Codex/Codex Desktop should run
`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`
and start a new Codex session; Claude Code should run `/mcp` and choose
Authenticate/Reconnect for the plan connector, or run the reconnect command with
`--client claude-code` and restart Claude. To refresh every local client config
that already has the Plan entry, use `--client all`, then restart/reload each
client. Reconnect re-authenticates WITHOUT reinstalling and finds the entry by
URL regardless of connector name. Never reinstall from scratch just to fix auth.
Continue once the connector is available.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`. Do
not put shared secrets in skill files.
