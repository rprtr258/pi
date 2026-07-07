# JSON Schemas

JSON structures used by the skill-creator eval workflow.

## evals.json

Defines test cases for a skill. Located in the workspace at `evals/evals.json`.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "name": "descriptive-name",
      "prompt": "User's example prompt",
      "expected_output": "Description of expected result",
      "files": ["path/to/input-file.csv"],
      "assertions": [
        "The output includes X",
        "The skill used script Y",
        "The file contains at least 10 rows"
      ]
    }
  ]
}
```

| Field                     | Required | Description                                                 |
| ------------------------- | -------- | ----------------------------------------------------------- |
| `skill_name`              | yes      | Name matching the skill's frontmatter                       |
| `evals[].id`              | yes      | Unique integer identifier                                   |
| `evals[].name`            | yes      | Descriptive name for the test case (used as directory name) |
| `evals[].prompt`          | yes      | The task to execute                                         |
| `evals[].expected_output` | yes      | Human-readable description of success                       |
| `evals[].files`           | no       | Input file paths (relative to workspace)                    |
| `evals[].assertions`      | no       | Verifiable statements to grade against                      |

## eval_metadata.json

Metadata for a single eval run. Located at `iteration-N/eval-<name>/eval_metadata.json`.

```json
{
  "eval_id": 1,
  "eval_name": "descriptive-name",
  "prompt": "The user's task prompt",
  "assertions": ["The output includes X", "The file contains at least 10 rows"]
}
```

## grading.json

Output from the grader. Located at `<run-dir>/grading.json`.

```json
{
  "assertions": [
    {
      "text": "The output includes the name 'John Smith'",
      "passed": true,
      "evidence": "Found in output line 3: 'Contact: John Smith'"
    },
    {
      "text": "The spreadsheet has a SUM formula in cell B10",
      "passed": false,
      "evidence": "No spreadsheet was created. The output was a text file."
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 1,
    "total": 2,
    "pass_rate": 0.5
  }
}
```

| Field                   | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `assertions[].text`     | The original assertion text                          |
| `assertions[].passed`   | Boolean — true if assertion passes                   |
| `assertions[].evidence` | Specific quote or description supporting the verdict |
| `summary.passed`        | Count of passed assertions                           |
| `summary.failed`        | Count of failed assertions                           |
| `summary.total`         | Total assertions evaluated                           |
| `summary.pass_rate`     | Fraction passed (0.0 to 1.0)                         |

The grader may also include optional fields:

- `claims` — extracted and verified claims from the output
- `eval_feedback.suggestions` — improvement suggestions for the assertions themselves

## trigger-eval.json

Trigger evaluation queries for description optimization.

```json
[
  {
    "query": "realistic user prompt",
    "should_trigger": true
  },
  {
    "query": "another realistic prompt",
    "should_trigger": false
  }
]
```

| Field            | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `query`          | A realistic user prompt                              |
| `should_trigger` | Whether this query should cause the skill to trigger |
