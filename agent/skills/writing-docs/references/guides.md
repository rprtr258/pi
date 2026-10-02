# Guides and tutorials

A guide takes a reader from a starting state to a working result. The reader wants to finish the task, not understand the system; explanation is a by-product.

## Pick one type per page

| Type | Reader | Shape |
| --- | --- | --- |
| Tutorial | Learning the tool, tolerant of a narrow path | One guided path, no choices, ending in a visible result |
| How-to | Solving a known problem, wants the shortest route | Prerequisites, steps for that one problem, verification |
| Explanation | Wants to understand why | Concepts and trade-offs, no steps |

Do not mix them on one page. A page that teaches, explains, and lists options at once is a page the reader has to sift.

## Structure

1. **What you will achieve** — one paragraph, with the end state shown.
2. **Prerequisites** — versions, accounts, prior guides, time.
3. **Steps** — numbered, one action each, with the result the reader should see before continuing.
4. **Verify** — how the reader confirms the whole thing works.
5. **Troubleshooting** — the failures readers actually hit: symptom, then cause, then fix.
6. **Next** — the next task or the reference.

## Rules

- Keep one path through the page. Branching, alternatives, and options go in a table or a separate page.
- Test the whole guide end to end, in order, in a clean environment. A step that only works because of an earlier undocumented step breaks the reader.
- State the version every command was verified against.
- Show the expected output after each command that has one; a silent success is indistinguishable from a failure.
- Give every step a reason where the reader might deviate. A command with no stated rationale gets edited, and then fails.
- Leave no placeholder (`<your-key>`, `TODO`, `example.com`) in a step the reader must run — or say explicitly that it is a placeholder and where the real value comes from.
- Source troubleshooting entries from reported problems, not imagined ones.
