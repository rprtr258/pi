# Local-Files Privacy Mode

Full rules for local-files privacy mode, linked from the skill. Read this whenever the mode trigger in SKILL.md applies.

## Local-Files Privacy Mode Exception

Use local-files privacy mode when the user explicitly asks for no DB writes,
no hosted Plan database writes, no Plan MCP publish, fully local files, offline/private
recaps, or when `AGENT_NATIVE_PLANS_MODE=local-files` is set. This is the only
exception to the hosted publish rule below.

In local-files mode:

- Read the diff/stat/source context from local files and shell commands only.
  The existing `npx @agent-native/core@latest recap collect-diff`, `scan`, and
  `build-prompt --local-files` helpers are safe to use because they operate on
  local files and do not write to the Plan database.
- Fetch/read the block catalog before writing structured MDX. Use
  `npx @agent-native/core@latest plan blocks --out plan-blocks.md` when the Plan
  MCP connector is not registered; it calls the public no-auth
  `get-plan-blocks` route and sends no recap content. If network access is
  unavailable, use the bundled references and validate with
  `plan local check` / `plan local serve`. For `checklist` and `question-form`,
  copy the catalog examples verbatim: checklist items need `id` and `label`;
  question-form questions need `id`, `title`, and `mode`; and each option needs
  `id` and `label`. `plan local check` validates these required fields against
  the renderer schema.
- Write the recap as a local MDX folder: use `plans/<slug>/` when the user
  wants the artifact checked into the repo, or use a repo-ignored/temporary
  folder such as `.agent-native/plans/<slug>/` or `/tmp/agent-native-plans/<slug>/`
  when it should not be checked in. The folder contains `plan.mdx`, optional
  `canvas.mdx`, optional `prototype.mdx`, and optional `.plan-state.json`. Set
  `kind: "recap"` and `localOnly: true` in frontmatter/state when authoring
  the source.
- Run `npx @agent-native/core@latest plan local check --dir plans/<slug>`
  before serving, then run
  `npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind recap --open`.
  Report the returned local bridge URL from stdout or `plans/<slug>/.plan-url`.
  Treat `.plan-url` as a local token file and do not commit it. The URL opens
  the hosted Plan UI but reads from the localhost bridge on this machine, so it
  is not shareable across machines. On macOS, `--open` prefers Chromium browsers;
  if Safari opens, switch to Chrome/Chromium because Safari can block the hosted
  HTTPS page from fetching the HTTP localhost bridge. If the Plan app itself is
  running locally with the same `PLAN_LOCAL_DIR`, the `/local-plans/<slug>` route
  is also valid.
- For headless verification, run
  `npx @agent-native/core@latest plan local verify --dir plans/<slug> --kind recap`.
  It starts the bridge, checks the private-network preflight and JSON payload,
  prints diagnostics, and exits. If the browser hangs on "Loading plan", fetch
  the `bridgeUrl` from the verify/serve JSON to read the concrete validation
  error.
- Do **not** call `create-visual-recap`, `create-visual-plan`,
  `import-visual-plan-source`, `update-visual-plan`,
  `patch-visual-plan-source`, `get-plan-feedback`, `export-visual-plan`,
  `set-resource-visibility`, or any hosted Plan tool for that recap except the
  schema-only block catalog lookup above.
- Treat review feedback as file or chat feedback: update the MDX files directly,
  rerun the local bridge command, and summarize the new local bridge URL.
  Hosted comments, sharing, screenshots, usage attachment, and PR sticky comment
  publishing are unavailable until the user explicitly opts into publishing.

Local-files mode prevents recap content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.
