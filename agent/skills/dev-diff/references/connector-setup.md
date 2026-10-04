# Connector Setup And Publishing

Full publish/restore rules for visual recaps, linked from the skill.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan, created with the
`create-visual-recap` tool on the Plan MCP connector. The connector is usually
exposed as the `plan` server, but older installed agents may expose the same
hosted connector as `agent-native-plans`; both names are valid. NEVER hand the
recap to the user as inline chat content — not Markdown prose, not an ASCII
sketch, not a table, not a fenced "wireframe", not a "here's the recap" summary.
A recap's entire value is the hosted, interactive, annotatable plan; an inline
summary is not a recap, it is the thing a recap replaces. The only supported
output is to publish the plan and return its absolute URL.

Except for the explicit local-files privacy mode, if neither the `plan`
nor legacy `agent-native-plans` Plan MCP tools are available, do NOT improvise an
inline recap as a fallback. Do not report the connector as disconnected just
because it is named `agent-native-plans` instead of `plan`. The usual cause is a
connector that did not finish connecting this session (it registers zero tools),
NOT necessarily an auth problem — so do not assume the user must authenticate.

## Restoring The Connector

Stop and tell the user how to restore it for their current client: in
Codex/Codex Desktop, run
`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex`
and start a new Codex session; in Claude Code, run `/mcp` and choose
Authenticate/Reconnect, or run the reconnect command with `--client claude-code`
and restart Claude. Auth is stored per client config/session; `--client all`
refreshes every local client config that already has the Plan entry, but each
running client still has to reload its MCP tools. Reconnect re-authenticates
WITHOUT reinstalling and finds the entry by URL regardless of connector name.
Never reinstall from scratch just to fix auth. Then publish once the tool is
reachable. Falling back to inline content is a defect, not a degraded mode.
