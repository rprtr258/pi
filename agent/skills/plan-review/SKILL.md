---
name: plan-review
description: Use when asked to compare, cross-review, merge, judge, choose, or arbitrate competing plans from multiple agents such as Codex and Claude Code; when given two or more proposed plans, session IDs, transcripts, plan documents, PR descriptions, or pasted strategies; when the user wants one recommended execution plan after agents review each other's proposals; or when the user explicitly invokes Crit (/crit) to review a plan or plan decision.
---

# Plan Arbiter

Turn competing plans into one executable direction. Preserve the best ideas,
reject weak assumptions, and produce a clear handoff instead of a blended mush.

## Workflow

1. Collect the source plans.
2. Normalize each plan into comparable claims.
3. Cross-review the plans against each other and the real repository or task
   context.
4. Choose a winner, merge a better hybrid, or send the plans back for revision.
5. Produce one execution handoff with verification gates and rejected
   alternatives.
6. Present the decision memo for human review with Crit and loop on feedback
   until approved (see "Present Result with Crit").

Planning is read-only unless the user explicitly asks you to implement after the
decision.

## Collect Source Plans

Accept plans as pasted text, local files, session IDs, transcript paths, pull requests,
comments, visual-plan links, or chat history. Resolve the original artifacts
when possible so you can see prompt changes and assumptions that may be missing
from a final summary.

If a plan is still being written and the user asked you to wait, monitor it
until it is done or blocked. If a plan cannot be resolved, continue with the
available plan text and mark the missing source as a risk.

## Normalize

For each plan, extract:

- Objective and scope.
- Key assumptions and unresolved questions.
- Proposed files, modules, APIs, data shapes, UI states, or workflows.
- Implementation sequence.
- Validation strategy.
- Rollback or migration concerns.
- Cost, complexity, and expected executor fit.

Do not reward verbosity. Prefer plans that are concrete, grounded in real code,
and honest about tradeoffs.

## Cross-Review

Review each plan as if another capable agent wrote it:

- Check whether it satisfies the user's actual request.
- Verify claims against the repository, docs, tests, screenshots, or external systems
  when those are relevant and available.
- Identify hidden dependencies, missing tests, risky sequencing, vague steps,
  unnecessary scope, and hard-to-reverse decisions.
- Notice complementary strengths: one plan may have the better architecture
  while another has the better migration or validation path.
- Separate plan quality from executor preference. A cheaper/faster executor can
  be the right choice for implementation even when another model produced the
  best critique.

Use subagents for independent review when the plans are large, the repository is
wide, or the decision would benefit from separate technical and product passes.

## Decide

Choose one of three outcomes:

- **Adopt:** pick one plan mostly as written.
- **Hybrid:** combine specific pieces into a stronger execution plan.
- **Revise first:** request another planning pass because both plans miss a
  key constraint or depend on an unresolved decision.

Use this tie-break order:

1. Correctness and fit to the user's request.
2. Grounding in real files, APIs, tests, data, and UI behavior.
3. Simpler first implementation that does not block the intended future.
4. Better validation and rollback story.
5. Lower token/time cost for execution once quality is acceptable.

## Handoff

Return a compact decision memo:

```md
Decision
- Adopt Plan A / Hybrid / Revise first.

Why
- The deciding evidence and tradeoffs.

Execution Plan
- Ordered steps with files or surfaces to touch.

Borrowed From Other Plans
- Useful pieces kept from non-winning plans.

Rejected
- Ideas intentionally not taking, with reasons.

Verification
- Tests, browser checks, screenshots, CI, review, or deploy checks needed.

Executor Recommendation
- Which agent/model should implement and why.
```

When the user already asked for execution and the chosen path is clear, proceed
with the selected plan after reporting the decision briefly. Otherwise stop at
the handoff and ask for approval.

## Present Result with Crit

Crit is the result-presenting tool for the review loop: after the handoff, the
decision memo (and the plan files it came from) go in front of the human as
inline comments in the browser, and you revise in a loop until approved.

Run it when the user wants to review or refine the decision, or explicitly
invokes Crit (`/crit`). A generic review request does not count. If the `crit`
CLI is unavailable, skip and hand back the memo file path instead.

### Loop

1. Write the decision memo to a file (e.g. under `plans/`) and run
   `crit <file>` in the foreground. Starting fresh, crit spawns its daemon,
   opens the browser, and blocks until the user clicks "Finish Review". If a
   crit server from earlier in the conversation is running, `crit` connects to
   it and signals round-complete first.
2. Relay the URL crit prints verbatim: "Crit is open at
   http://localhost:<port>. Leave inline comments, then click Finish Review."
3. **Do NOT proceed until `crit` completes.** Do not read the review file
   early — the blocking foreground command is how you know the human is done.
4. When it completes, read **stdout** and follow its instructions; check
   **stderr** for `approved: true` / `approved: false`.
   - `quote`: the text the reviewer selected — focus changes on it, not the
     whole line range.
   - `anchor`: current position of the content; line numbers may be stale
     after edits.
   - `drifted: true`: original content removed/rewritten; positions are
     approximate.
5. For each unresolved comment: understand it, apply suggestion blocks,
   revise the memo or the plan/code file it targets (editing triggers Crit's
   live reload), then reply with what you did:
   `crit comment --reply-to <id> --author 'Pi' '<what you did>'`.
   **Do not pass `--resolve`** — resolving is the reviewer's call.
6. Re-run the command from crit's finish prompt to start the next round, and
   tell the user: "Changes applied. Review the diff in your browser and click
   Finish Review when ready." A finish with zero comments means approved —
   stop the loop.

Bulk replies to several comments in one call:

```bash
crit comment --json --file /tmp/replies.json --author 'Pi'
```

Fallback for headless or mid-round re-entry: `crit comments` /
`crit comments --json`; use `crit comments --plan <slug>` for plan-mode
reviews.

### Sharing

`crit share <file>` prints a shareable URL — always relay the full output
verbatim, don't make the user dig through tool output. `crit unpublish
[file...]` removes it.

To open the review from another device (e.g. a phone over Tailscale), keep
crit on loopback and reverse-proxy in:

```bash
crit --public-url "https://<machine>.ts.net" --allow-unauthenticated-network --no-open <file>
tailscale serve --bg --https=443 http://127.0.0.1:<port>
```

`--public-url` only changes the printed URL — it does not expose the server.
`--allow-unauthenticated-network` is required with `--public-url` (even on
loopback) and with any non-loopback `--host`. Crit has no auth: anyone who can
reach the URL can read the repo and post comments that may trigger agents.
Confirm the user wants that blast radius. Never bind `--host` to a
Tailscale/LAN IP — proxy with `tailscale serve` or an SSH tunnel.
