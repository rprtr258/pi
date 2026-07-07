# Eval Guide

How to test skill effectiveness using test prompts, subagent runs, grading, and description optimization.

## Table of Contents

- [When to Use Evals](#when-to-use-evals)
- [Creating Test Cases](#creating-test-cases)
- [Running Test Cases](#running-test-cases)
- [Grading Results](#grading-results)
- [The Improvement Loop](#the-improvement-loop)
- [Description Optimization](#description-optimization)

## When to Use Evals

Use evals when the skill has objectively verifiable outputs — file transforms, data extraction, code generation, fixed workflow steps. Skip evals for skills with purely subjective outputs (writing style, design aesthetics) — use qualitative human review instead.

Even for subjective skills, running 2–3 test prompts and reviewing outputs is valuable. Skip only the formal grading step.

## Creating Test Cases

Write 2–3 realistic test prompts that represent what a real user would say. Good test prompts are:

- **Concrete and specific** — include file paths, column names, personal context
- **Varied in phrasing** — some formal, some casual, some with typos
- **Covering edge cases** — not just the happy path

**Good test prompt:**

```
I have a CSV at ~/data/q4-sales.csv with columns: date, region, revenue, costs.
Add a profit_margin column as a percentage. Skip rows where costs is zero.
```

**Bad test prompt:**

```
Process some data.
```

### evals.json Format

Save test cases to a workspace directory (sibling to the skill, e.g., `<skill-name>-workspace/evals/evals.json`):

```json
{
  "skill_name": "my-skill",
  "evals": [
    {
      "id": 1,
      "name": "descriptive-name",
      "prompt": "The realistic user prompt",
      "expected_output": "Human-readable description of what success looks like",
      "files": [],
      "assertions": [
        "The output file exists and is non-empty",
        "The profit_margin column contains percentage values",
        "Rows with zero costs are excluded"
      ]
    }
  ]
}
```

See [schemas.md](schemas.md) for the full schema.

### Writing Assertions

Good assertions are:

- **Objectively verifiable** — can be checked by reading the output
- **Discriminating** — pass when the skill genuinely succeeds, fail when it doesn't
- **Descriptive** — read clearly so someone glancing at results understands what each checks

Bad assertions:

- Check surface compliance but not substance (file exists but might be empty)
- Pass regardless of skill quality (trivially satisfied)
- Require human judgment (subjective quality)

Write assertions after the test prompts but before seeing results, to avoid bias.

## Running Test Cases

For each test case, spawn two subagent runs:

### With-Skill Run

Spawn a subagent with the skill loaded:

```
Execute this task:
- Skill path: <path-to-skill>
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
```

### Baseline Run

Spawn a subagent with the same prompt but **no skill**:

```
Execute this task:
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/without_skill/outputs/
```

**When improving an existing skill:** the baseline is the old skill version. Snapshot it before editing (`cp -r <skill-path> <workspace>/skill-snapshot/`).

### Workspace Layout

```
<skill-name>-workspace/
├── evals/
│   └── evals.json
├── iteration-1/
│   ├── eval-1-descriptive-name/
│   │   ├── eval_metadata.json
│   │   ├── with_skill/
│   │   │   └── outputs/
│   │   └── without_skill/
│   │       └── outputs/
│   └── eval-2-another-name/
│       └── ...
└── iteration-2/
    └── ...
```

Each eval directory gets an `eval_metadata.json`:

```json
{
  "eval_id": 1,
  "eval_name": "descriptive-name",
  "prompt": "The user's task prompt",
  "assertions": [
    "The output file exists and is non-empty",
    "The profit_margin column contains percentage values"
  ]
}
```

### Parallel Execution

Launch with-skill and baseline runs simultaneously for each test case. Don't wait for one batch to finish before starting the other.

## Grading Results

After runs complete, grade each output against its assertions.

### Automated Grading

For assertions that can be checked programmatically (file existence, content patterns, command exit codes), write and run a script. Scripts are faster, more reliable, and reusable across iterations.

### Subagent Grading

For assertions requiring judgment, spawn a grader subagent using the instructions in [agents/grader.md](../agents/grader.md). The grader reads the outputs, evaluates each assertion, and produces a `grading.json` with pass/fail verdicts and evidence.

### Presenting Results

After grading:

1. Show the user each test case with its prompt, the with-skill output, and the baseline output side by side
2. Show assertion pass/fail results
3. Ask for qualitative feedback: "How does this look? Anything you'd change?"

Empty feedback means it looked fine. Focus improvements on cases with specific complaints.

## The Improvement Loop

After collecting feedback:

1. **Generalize** from feedback — don't overfit to the 2–3 test cases
2. **Revise** the skill based on patterns, not individual fixes
3. **Rerun** all test cases into a new `iteration-<N+1>/` directory
4. **Re-grade** and present new results
5. **Repeat** until:
   - The user says they're happy
   - Feedback is all empty
   - You're not making meaningful progress

### Improvement Principles

- **Remove before adding.** Read transcripts — if the skill makes the agent waste time on unproductive steps, cut those instructions.
- **Bundle repeated work.** If every test run independently wrote the same helper script, put it in `scripts/`.
- **Generalize from specifics.** A fix for one test case should help all similar cases, not just the exact scenario.
- **Explain the why.** If you're tempted to write a rigid MUST rule, explain the reasoning instead so the agent can apply it flexibly.

## Description Optimization

The frontmatter `description` determines whether the agent reads the skill. A bad description means the skill never fires or fires for wrong things.

### Step 1: Generate Trigger Eval Queries

Create 16–20 queries — a mix of should-trigger (8–10) and should-not-trigger (8–10).

```json
[
  {
    "query": "realistic user prompt that should trigger this skill",
    "should_trigger": true
  },
  {
    "query": "realistic prompt that should NOT trigger this skill",
    "should_trigger": false
  }
]
```

**For should-trigger queries:** vary phrasing (formal, casual, abbreviated). Include cases where the user doesn't name the skill explicitly but clearly needs it.

**For should-not-trigger queries:** focus on near-misses — queries that share keywords but need something different. Don't use obviously irrelevant queries.

**Bad:** `"Write a fibonacci function"` as a negative for a PDF skill (too easy).
**Good:** `"Read this PDF and summarize the key points"` as a negative for a PDF-form-filling skill (shares "PDF" keyword but is a different task).

### Step 2: Review with User

Present the eval set and let the user adjust queries, toggle should-trigger, add or remove entries.

### Step 3: Test Triggering

For each query, ask a subagent to process the query and observe whether it reads the skill. Record trigger/no-trigger for each query across 2–3 runs (LLM behavior is non-deterministic).

Calculate:

- **Trigger rate** per query (e.g., triggered 2/3 runs)
- **Pass/fail** per query (should-trigger queries need trigger rate ≥ 50%; shouldn't-trigger queries need trigger rate < 50%)
- **Overall accuracy** across all queries

### Step 4: Improve Description

Based on failures:

- Queries that should trigger but didn't → add intent coverage to description
- Queries that shouldn't trigger but did → add distinguishing context

Keep the description under 1024 characters. Avoid listing specific queries — generalize to broader categories of user intent.

### Step 5: Retest and Iterate

Rerun the trigger eval with the improved description. Repeat until accuracy is satisfactory (aim for >85% across all queries).
