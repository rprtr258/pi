# Reporting The Recap URL

Full URL/origin/reporting rules for visual recaps, linked from the skill.

## Local-Files Mode Reporting

In local-files privacy mode, run `plan local check` first, then report the local
bridge URL from
`npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind recap --open`
or from `plans/<slug>/.plan-url`. It opens the hosted Plan UI but reads from the
localhost bridge on this machine, so it is not shareable across machines. If the
Plan app itself is running locally with the same `PLAN_LOCAL_DIR`, the
`/local-plans/<slug>` route is also valid. Do not invent a hosted database URL
and do not publish just to get an absolute Plan link.

## Report The Absolute URL

After creating the recap, link the reviewer to the rendered plan with an
**absolute URL on the origin whose database actually holds the plan**. That
origin is the Plan MCP server you just created the recap through — NOT whatever
dev server you happen to know is running. The create tool returns the correct
link; report THAT. Never make the primary link a local `plan.mdx` file, a local
mirror directory, or a relative path such as `/plans/<id>`.

## Origin And Access Rules

When the recap is posted to a pull request for a private repository, the plan link is not a
public URL. Make the pull request comment/handoff copy explicit: reviewers may need to
sign in to Agent-Native Plans with an account that has access to the owning
organization before the link loads. Use wording like: "Private repository recap:
sign in with access to this org if the plan does not open." Do not imply the
link is broken or public when access is gated by repository/org visibility.

A recap lives only in the database of the MCP that created it. A separately
running local dev server (e.g. `http://localhost:8081`) has its OWN database and
will NOT contain a recap created through the hosted MCP, so a hand-built
`localhost` link returns "Plan not found". This is the most common recap
mistake — do not guess an origin you have not confirmed shares the MCP's data.

Resolve the URL in this order:

1. Use the absolute URL the create tool RETURNS — `openLink.webUrl`, else the
   `visualUrl` in the returned `plan.mdx` frontmatter, else `url`/`path`
   resolved against the MCP server's own origin (for the hosted MCP that is
   `https://plan.agent-native.com`). This always points at the database that has
   the plan.
2. Use a `localhost`/dev origin ONLY when the recap was created through a Plan
   MCP bound to that same origin — i.e. that MCP's url is
   `http://localhost:<port>/_agent-native/mcp`. Creating through the hosted MCP
   and linking to localhost is the exact mismatch that 404s.
3. If only a plan id is available, build the MCP origin's absolute URL
   (hosted: `https://plan.agent-native.com/plans/<id>`) and say it was inferred.

## Localhost And Codex Opening

If the user wants to review on localhost but the recap was created through the
hosted MCP, say so plainly: the local dev server cannot see it. To view a recap
on localhost (e.g. to exercise un-deployed local renderer changes), they must
connect a LOCAL Plan MCP (`http://localhost:<port>/_agent-native/mcp`) and
re-create the recap through it so it lands in the local database; offer to do
that rather than handing over a localhost URL that will not resolve.

When running in Codex and the Browser/in-app side browser tools are available,
open the returned absolute recap URL there automatically after creation. Still
include the same absolute URL in the final response. Local mirror files like
`plans/<slug>/plan.mdx` may be mentioned only as secondary source-control
artifacts, not as the main way to open the recap.
