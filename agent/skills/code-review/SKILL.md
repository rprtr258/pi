---
name: code-review
description: |
  Use when asked to review code: 'code review', 'run code review', 'run code review of MR' + MR link. The target may be a GitLab merge request, a GitHub pull request, or local git changes; any stack (Go, TS/JS, Python).
---

# Code Review

An AI code-review pipeline. One agent drives the run; role
prompts live in `references/` and are dispatched verbatim - nothing to assemble. Portable to
any harness (opencode skills/, Claude Code skills/, a plain subagent task) by copying this
directory.

**MR** below means the review target: a GitLab merge request, a GitHub pull request, or a set
of local changes.

## 1. Doctrine

Principle: **"checked it, did it, handed over the list - without thinking for the author"**.
Requirements come only from the target's description (MR/PR description; for local changes -
the user's task note); hypotheses without a requirement are noise.
Hard limit on inline comments: **<=10 (ideal 5, zero is fine)**; inline is for
must fix only. Everything else goes into one final review comment with collapsible sections:
must fix, nice to fix, a details tail for the rest, praise. Output requirement:
zero irrelevant noise in the code, maximum signal with minimal thinking for the author. The
pipeline gets its precision from verification against real code, not from brute-forcing search
passes. A run's top is one sample of the signal: the pipeline is repeatable as a search, not
as a top-N ranker - completeness needs consensus across runs or a raised posting threshold.
A machine-detectable finding class (linter rule, formatter, compiler/type-checker flag,
test-runner check) is fixed by adding the automated check, not by review vigilance alone:
the review reports the sample, the check owns the whole class. Delivery order is fixed: the
full review is shown in chat first; posting to the forge is a separate step that happens only
after the user explicitly approves it.

## 2. The 5-stage pipeline

One run = one review of one target (GitLab MR, GitHub PR, or local changes). Stages run
strictly in order, each with its own role prompt in references/. The search fans out by review
lens (one blind reviewer per batch x lens); precision comes from verification against real
code, not from brute-forcing search passes: only issue/medium gets verified (high - always).

```
0. Preparation (source details, worktree, metadata + diff artifacts)
1. Recon/slicing  (skip autogens, batches of 3-15 files)
2. Thorough search - P4-assertive reviewers per batch, one per lens
2b. P5 filter     - refute every finding against the diff, keep only the irrefutable
3. Verifier-aggregator - groups by file, verdict against the REAL code from the worktree,
   issue/medium ONLY, refuted -> drop BEFORE the filter, cross-dedup
4. Quiet filter   - "keep only what you're sure of", the rest goes to details
5. Publisher      - review shown in chat; posting (inline must_fix <=10 + one final
                     comment: must fix + nice to fix + details + praise) only after user approval
```

## 3. Stage 0. Preparation

Resolve the review target and collect the run's inputs. Duration ~10 minutes; reads and a clone
only, no external effects.

**Source resolution.** The target is one of:

- **GitLab MR** - an MR link: project_id + iid;
- **GitHub PR** - a PR link: owner/repo + PR number;
- **Local changes** - a repo path plus what to review: the working tree (staged + unstaged vs
  HEAD), a commit range, or a branch vs its merge-base with the main branch.

**Early exit (fail-fast).** The very first thing the pipeline does is check access: it tries to
read the target (forge API, or local git) and clone the repo into /tmp when the target is
remote. No access (no channel for the forge, the clone fails, no repo at the given path) -
EARLY RETURN with the answer "no access to the review target; you need any of: GitLab MCP /
glab / gh / a local repo - depending on your environment" and NO further stages. Fail fast
before slicing: without the target and a checkout, the pipeline does not start.

**Read and posting channels** - ANY one available in the user's environment: GitLab - GitLab MCP /
glab CLI / REST API; GitHub - gh CLI / GitHub MCP / REST API; local - git in the repo. The skill
ships no ready-made channels: at stage 0 the agent determines what is available and, if nothing
is, exits early.

**Run artifacts** (directory `<date>_<repo>-<target>/`, target = MR iid / PR number / `local`):

- `metadata.json` - details, files (statuses), diff_stats, autogen_hints, detected_stack;
- `description.md`, `files_list.txt`;
- `diff/mr.diff` - the full unified diff (<3MB goes into git; anything larger is excluded from the commit);
- `fanout/` - batch diffs (B01.diff, B02.diff, ...);
- `findings/`, `posts/` - written by the stage outputs.

The per-source metadata table, worktree mechanics, and the prompt live in
[references/preparer.md](references/preparer.md) (dispatch verbatim; fill `<<SOURCE>>` and the
source-specific ids).

## 4. Stage 1. Recon and batch slicing

Build a map of changed files from the diff and slice it into logical batches. Autogens are
always skipped - they never enter review; the full skip list and the slicing manifest live with
the scout prompt.

Prompt: [references/scout.md](references/scout.md) (dispatch verbatim; fill `<<MR_META>>`).

## 5. Stage 2. Thorough search (P4 reviewers, one per lens)

Each batch is reviewed by blind P4-assertive reviewers - one per lens. Core lenses L1
(correctness/concurrency), L2 (cleanliness/public API), L3 (tests) run for every batch;
conditional lenses (security, delivery, observability, performance, API contract, migrations/
codegen/concurrency, platform conventions) run only when their trigger subject is in the
batch's diff - in doubt, run them. One lens = one independent dispatch: lenses are not merged
into one reviewer, and lens results are not cross-populated. The lens catalog lives with the
reviewer prompt.

Batches run sequentially; within a stage - no more than 2-3 reviewers in parallel at a time
(protection against provider limits: a 429 storm costs more than it saves - two retries per
call, then move on; steady limit 3-4 heavy pipelines). An empty thorough result on a large
batch - recheck with one rerun: this is a known worker failure, and a rerun almost always
finds something (pilot rule, confirmed 3+ times).

The prompt is universal for any stack: the examples in the lens blocks may be adapted to the
MR's stack (`<<TECH_STACK>>`) without changing the thresholds, caps, or output format.

Prompt: [references/reviewer.md](references/reviewer.md) (dispatch verbatim once per batch x
lens; fill `<<MR_META>>`, `<<MR_DIFF>>`, `<<TECH_STACK>>`, `<<LENS>>`).

## 6. Stage 2b. Falsification filter (P5)

For each batch, a blind filter tries to REFUTE every finding against the diff; only the
irrefutable get keep. The "misreading" rules are language-agnostic: adapt the examples to the
MR's stack (`<<TECH_STACK>>`), never the thresholds or the output format.

**Check the `<<FINDINGS_JSON>>` substitution** before dispatch: an unfilled placeholder is a
known pipeline bug - the filter will honestly return `[]` and throw away all of the batch's
findings.

Prompt: [references/filter.md](references/filter.md) (dispatch verbatim; fill `<<MR_DIFF>>`,
`<<FINDINGS_JSON>>`).

## 7. Stage 3. Verifier-aggregator

The pipeline's core. Findings are grouped by file: one agent receives ALL findings for that
file (together with the filter's verdicts, if any) plus the file itself from the worktree, and
issues a verdict on each of them all at once, **against the REAL code** (not the diff!).
Overlapping duplicates from different batches collapse into a single element; `sources` keeps
every batch/source that found the topic.

Verification scope in the pipeline: **issue and medium only** (high - always; low/nitpick -
skipped, they go to details at stage 4 without code verification). `refuted` -> **dropped
BEFORE the quiet filter**, not after: filtered and refuted are separate buckets in the report.

If a topic is found independently in several batches or by several lens reviewers (consensus) -
that is a strengthened signal; it counts as verified immediately, but still show the verdict
against the code.

Order of consideration for the three must_fix questions: 1, then 2, then 3; findings of the
same substance from different batches get the same verdict. Sort nice_to_have by score,
descending. The full criticality classification (the three questions, the four industry
classes, anti-criteria, races, swallowed errors, inflation control) is single-sourced in the
verifier prompt.

Prompt: [references/verifier.md](references/verifier.md) (dispatch verbatim; fill
`<<REPO_PATH>>`, `<<MR_META>>`).

## 8. Stage 4. Quiet filter

One pass over the READY list (after the verifier), without restarting the search. Criterion:
**"keep only what you're sure of"**. Dubious items are not thrown away but demoted into the
details tail of the final comment. This is a publishing-confidence filter, not a search filter.
The quiet filter does not demote stage 3's must_fix (already verified-by-code by definition):
only non-must_fix and the detail contour go into details.

Prompt: [references/quiet.md](references/quiet.md) (dispatch verbatim).

## 9. Stage 5. Publisher

Runs at the end, when the list is finalized. First the full review is shown in chat (the
final-comment body plus the list of inline findings); posting to the forge happens only after
the user explicitly approves it. Then: inline comments carry must_fix only (limit <=10),
everything else goes into ONE final review comment with a fixed structure. Every gate is
mandatory: the hard-break counts (`grep -c '\\$'` for the final comment, exactly 2 breaks per
inline) run before any forge posting. The packaging canon, finding/inline formats, emoji
mapping, empty states, tone calibration, the forge `<details>` rules, and the per-source posting
channels (gitlab-mr / github-pr / local-report) are single-sourced in the
publisher prompt (pilot lesson included: 3 of 15 comments had a broken details collapse).

Prompt: [references/publisher.md](references/publisher.md) (dispatch verbatim; fill
`<<MR_META>>`).

## 10. Execution

The skill is executed by **ONE agent**, which drives the entire run itself (recon -> batches ->
search -> verification -> filter -> publishing). Two modes:

- **(a) the agent can spawn subagents** - it spawns workers by role, each receiving the full
  role prompt of the corresponding stage (from `references/<role>.md`) as the task text
  (`task(prompt=...)`).
  Concurrency limit: no more than 2-3 reviewers at a time in the search stage. All external
  writes (posting) go through the publisher itself / its tools; the other roles are read-only.
- **(b) the agent cannot spawn** - it plays the roles sequentially in one session: first the
  Preparer, then the Scout, then the Reviewer (repeat per batch and lens), then the Filter,
  then the Verifier-aggregator, then Quiet, then the Publisher. The pipeline works this way too - only
  search parallelism degrades, not filter quality.

**Blindness is mandatory in both cases**: no role reads other people's MR comments, discussions,
or other runs' findings. Each reviewer/filter judges only by its own input (metadata + the
batch diff / the findings JSON).

The leading agent itself does not review code during the run - it either spawns the roles or
plays them.

## 11. Posting rules

Posting mechanics are source-specific (gitlab-mr / github-pr / local-report; see
references/publisher.md). The rules below are common to all sources:

- **Chat first, post only on approval.** Before anything is posted, the full review (the
  final-comment body + the list of inline findings) is shown to the user in chat. Posting to
  the forge (inline + the final comment) happens only after the user explicitly approves it
  in the current run. Launching the skill with an MR link is NOT consent, and silence is not
  consent either; a re-post after edits needs a fresh approval.
- **Inline limit <=10, and must_fix only** (one per finding). Nice to fix and everything else -
  only in the final comment.
- **Batches of posts - one at a time, not in parallel**: parallel posts on a shared token lose
  attribution.
- **Check that the post was actually created before retrying**: a "stale refresh" / network
  failure may mean the post was already created. Double posting is the classic bug; clean it up
  by deleting the duplicate.
- **Parse the exit codes of responses**: some CLIs return exit 0 on a server jsonrpc error (no
  post created, yet exit code 0). Verify by the fact of post creation (reading the MR / the
  appearance of a note_id), not by the exit code.
- **Extract the comment id from the response/response tail immediately, before retrying** -
  otherwise you lose the post's address (GitLab note_id / GitHub review-comment id; local: the
  report path).
- **Line anchoring - by worktree (head_sha)**: only added (present in the new version) lines
  (GitLab new_line; GitHub side RIGHT with commit_id). HTTP 400/422 on a context line - map the
  finding to the nearest semantically equivalent added line of the same hunk; as a last resort
  - file-level.
- After the run: the posts manifest must contain the FULL body of the final comment (not a
  link) - in case of an interruption and recovery.

## 12. Guardrails

- Requirements come only from the target's description (MR/PR description; for local changes -
  the user's task note); security hypotheses and "what if it's wrong"
  attach only to requirements explicitly written there. "Inventing a requirement based on the
  code" is the main source of noise (pilot lesson).
- The driver does not review itself: every batch and every lens goes through a dispatched (or
  role-played) reviewer - no analyzing lenses in the driver's head, no merging lenses into one
  dispatch.
- Do not inflate severity: on pre-existing issues, on "no test", on a deliberate trade-off, on
  a scary-but-narrow mechanism. Grade by the diff's culpability, not the mechanism's scariness.
- Never take a reviewer's word or carry over its line numbers without cross-checking against
  the code; never pull conclusions from memory instead of reading the worktree.
- Keep pre-existing findings distinguishable from diff-introduced ones end to end - the author
  is not guilty of the former.
- Do not economize on lenses or reading for a large diff.
- The review is always shown in chat in full first; findings are posted only at the end,
  when the list is finalized AND the user approved posting - nothing is promised or posted
  during the search.
