# Quality Checks and Feedback Handling

Companion to si-skill-creator Scenario C.

## Validation and audits (manual)

- **Structural:** `python3 <path>/scripts/quick_validate.py <skill-dir>` — frontmatter, name/description constraints, token count.
- **Token audit:** anything in SKILL.md that could move to a reference file should; compare body cost vs. Scenario B benefit.
- **Description spot-check:** would a fresh agent reading only name+description know exactly when to read this — and when not to? Could it trigger on the near-miss negatives you wrote?
- **Rationalization coverage:** every rationalization observed during RED/REFACTOR has a table row or explicit counter.
- **Re-benchmark triggers:** after description changes, after any behavioral change, and when a user reports the skill firing or not firing when it shouldn't/should.

## Improving from feedback

When the user requests changes:

- **Generalize** from each message: would future agents with this skill benefit from this guidance?
- **Keep the skill lean**: the request is context for how to work better, not a transcript to paste.
- **Explain why** behind changes so agents can extrapolate to new situations.
- **Look for repeated work**: anything done more than once in this conversation is a candidate to encode.
