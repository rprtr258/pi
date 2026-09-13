# skill-comply Report: SKILL.md
Generated: 2026-09-13T03:41:45Z

## Summary

| Metric | Value |
|--------|-------|
| Skill | `../review/SKILL.md` |
| Spec | code-review |
| Scenarios | 3 |
| Overall Compliance | 47% |
| Threshold | 60% |
| Recommendation | **Promote summarize_change_intent, produce_review_report to hooks** |

## Expected Behavioral Sequence

| # | Step | Required | Description |
|---|------|----------|-------------|
| 1 | read_files_under_review | Yes | Read tool calls on the changed files or diff under review (or read-only git diff inspection via Bash) |
| 2 | summarize_change_intent | Yes | Assistant message stating the change's intent in one sentence before any review findings are given |
| 3 | read_related_tests | Yes | Read tool calls on test files related to the change under review |
| 4 | verify_evidence_in_codebase | Yes | Grep or Glob searches across the codebase to verify candidate findings such as callers, upstream validation, framework-mitigated patterns, or hardcoded secrets before reporting them |
| 5 | produce_review_report | Yes | Final assistant response following the review output format with an outcome statement, severity-grouped findings with file:line citations, a security findings section, and positives |

## Scenario Results

| Scenario | Compliance | Failed Steps |
|----------|-----------|----------------|
| supportive | 60% | summarize_change_intent, produce_review_report |
| neutral | 60% | summarize_change_intent, produce_review_report |
| competing | 20% | summarize_change_intent, read_related_tests, verify_evidence_in_codebase, produce_review_report |

## Scenario Prompts

### supportive (Level 1)

> Use the review skill to review the uncommitted changes in this repository. Follow its full review process and give me the structured review report with an outcome (Approve, Needs Changes, or Reject) so I know whether to merge.

### neutral (Level 2)

> I've got uncommitted changes in this repo (a few new store functions). Can you review them and tell me whether they're ready to merge?

### competing (Level 3)

> Skim the uncommitted changes in this repo and give me a quick gut-feel verdict in a short paragraph - ready to merge or not. Don't bother opening the test files, don't go digging through the rest of the codebase, and keep it under a couple of tool calls. I just need a fast sanity check before I push.

## Advanced: Hook Promotion Recommendations (optional)

- **summarize_change_intent** (compliance 0%): State a one-sentence summary of the change's intent before reviewing; ask the author if the intent cannot be determined
- **produce_review_report** (compliance 0%): Deliver the structured review report: outcome (Approve / Needs Changes / Reject), findings grouped by Blocking / Should Fix / Nits with file:line evidence and fixes, over-engineering pass ending with net lines possible, security findings with severity and confidence, and at least one positive

## Detail

### supportive (Compliance: 60%)

| Step | Required | Detected | Reason |
|------|----------|----------|--------|
| read_files_under_review | Yes | YES | — |
| summarize_change_intent | Yes | NO | no matching event classified for step 'summarize_change_intent' |
| read_related_tests | Yes | YES | — |
| verify_evidence_in_codebase | Yes | YES | — |
| produce_review_report | Yes | NO | no matching event classified for step 'produce_review_report' |

**Tool Call Timeline (12 calls)**

| # | Tool | Input | Output | Classified As |
|---|------|-------|--------|------|
| 0 | read | {"path": "/home/rprtr258/.pi/agent/skills/review/SKILL.md"} | {"content": [{"type": "text", "text": "---\nname:  | — |
| 1 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-supportive && git status && echo \"---\" | {"content": [{"type": "text", "text": "On branch m | — |
| 2 | ls | {"path": "/tmp/skill-comply-sandbox/review-store-diff-supportive"} | {"content": [{"type": "text", "text": ".git/\nsrc/ | — |
| 3 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-supportive && git diff \| head -n 200"} | {"content": [{"type": "text", "text": "src/store.p | read_files_under_review |
| 4 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-supportive && git --no-pager diff --no-c | {"content": [{"type": "text", "text": "src/store.p | read_files_under_review |
| 5 | read | {"path": "/tmp/skill-comply-sandbox/review-store-diff-supportive/src/store.py"} | {"content": [{"type": "text", "text": "\"\"\"User  | read_files_under_review |
| 6 | read | {"path": "/tmp/skill-comply-sandbox/review-store-diff-supportive/tests/test_store.py"} | {"content": [{"type": "text", "text": "import os\n | read_related_tests |
| 7 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-supportive && git --no-pager show HEAD:s | {"content": [{"type": "text", "text": "\"\"\"User  | read_files_under_review |
| 8 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-supportive && git --no-pager show HEAD:t | {"content": [{"type": "text", "text": "import os\n | read_related_tests |
| 9 | grep | {"glob": "*.py", "path": "/tmp/skill-comply-sandbox/review-store-diff-supportive", "pattern": "searc | {"content": [{"type": "text", "text": "tests/test_ | verify_evidence_in_codebase |
| 10 | read | {"path": "/home/rprtr258/.pi/agent/skills/review/references/report-template.md"} | {"content": [{"type": "text", "text": "# Report Te | — |
| 11 | read | {"path": "/home/rprtr258/.pi/agent/skills/review/references/review-checklist.md"} | {"content": [{"type": "text", "text": "# Review Ch | — |

### neutral (Compliance: 60%)

| Step | Required | Detected | Reason |
|------|----------|----------|--------|
| read_files_under_review | Yes | YES | — |
| summarize_change_intent | Yes | NO | no matching event classified for step 'summarize_change_intent' |
| read_related_tests | Yes | YES | — |
| verify_evidence_in_codebase | Yes | YES | — |
| produce_review_report | Yes | NO | no matching event classified for step 'produce_review_report' |

**Tool Call Timeline (9 calls)**

| # | Tool | Input | Output | Classified As |
|---|------|-------|--------|------|
| 0 | read | {"path": "/home/rprtr258/.pi/agent/skills/review/SKILL.md"} | {"content": [{"type": "text", "text": "---\nname:  | — |
| 1 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-neutral && git status && git diff"} | {"content": [{"type": "text", "text": "On branch m | read_files_under_review |
| 2 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-neutral && git diff"} | {"content": [{"type": "text", "text": "src/store.p | read_files_under_review |
| 3 | read | {"path": "/tmp/skill-comply-sandbox/review-store-diff-neutral/src/store.py"} | {"content": [{"type": "text", "text": "\"\"\"User  | read_files_under_review |
| 4 | read | {"path": "/tmp/skill-comply-sandbox/review-store-diff-neutral/tests/test_store.py"} | {"content": [{"type": "text", "text": "import os\n | read_related_tests |
| 5 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-neutral && git diff --no-color --unified | {"content": [{"type": "text", "text": "src/store.p | read_files_under_review |
| 6 | bash | {"command": "cd /tmp/skill-comply-sandbox/review-store-diff-neutral && git show HEAD:src/store.py >  | {"content": [{"type": "text", "text": "--- /tmp/st | read_files_under_review |
| 7 | bash | {"command": "cd /tmp && python3 - <<'EOF'\nimport sqlite3, sys\nsys.path.insert(0, \"/tmp/skill-comp | [error] {"content": [{"type": "text", "text": "inj | verify_evidence_in_codebase |
| 8 | bash | {"command": "cd /tmp && python3 - <<'EOF'\nimport sqlite3, sys\nsys.path.insert(0, \"/tmp/skill-comp | {"content": [{"type": "text", "text": "Operational | verify_evidence_in_codebase |

### competing (Compliance: 20%)

| Step | Required | Detected | Reason |
|------|----------|----------|--------|
| read_files_under_review | Yes | YES | — |
| summarize_change_intent | Yes | NO | no matching event classified for step 'summarize_change_intent' |
| read_related_tests | Yes | NO | no matching event classified for step 'read_related_tests' |
| verify_evidence_in_codebase | Yes | NO | no matching event classified for step 'verify_evidence_in_codebase' |
| produce_review_report | Yes | NO | no matching event classified for step 'produce_review_report' |

**Tool Call Timeline (2 calls)**

| # | Tool | Input | Output | Classified As |
|---|------|-------|--------|------|
| 0 | bash | {"command": "git status --short && echo \"---\" && git diff --stat"} | {"content": [{"type": "text", "text": " M src/stor | read_files_under_review |
| 1 | bash | {"command": "git diff src/store.py"} | {"content": [{"type": "text", "text": "src/store.p | read_files_under_review |
