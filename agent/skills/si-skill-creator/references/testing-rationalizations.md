# Rationalizations That Skip Testing

Reference for the si-skill-creator Iron Law. When you catch yourself using one of these rationalizations, stop and test.

| Rationalization | Reality |
|---|---|
| "The skill is small, it obviously works" | Small skills fail small — a one-page skill that doesn't trigger or gets skimmed is dead weight. Test it. |
| "Manual review is enough" | Manual review doesn't measure triggering or subagent behavior. If triggering matters, run the eval. |
| "I'll test after deployment" | Post-deployment bugs burn user trust on every bad trigger. The Iron Law has no phase 2. |
| "The user is waiting, testing adds latency" | A tested skill shipped 10 minutes late beats an untested skill that misfires forever. |
| "It's just a description change" | Description changes silently move triggering. Re-run the trigger eval. |
| "Existing skill already worked, my edit is isolated" | Edits shift rationalization surfaces. Re-run the scenarios that passed before. |

## Red flags — stop and start over

- Writing the SKILL.md before running any baseline scenario
- Scenarios that pass both with and without the skill (skill does nothing measurable — cut or sharpen it)
- Description that summarizes the workflow steps
- Body over 500 lines with detail that belongs in references
- Relying on a single benchmark prompt as "proof"

Full testing methodology: [testing-skills-with-subagents.md](testing-skills-with-subagents.md).
