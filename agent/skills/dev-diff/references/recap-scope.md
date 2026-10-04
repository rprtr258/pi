# Recap The Whole Work Unit

Full scope rules for visual recaps, linked from the skill.

When `/visual-recap` is invoked in a chat thread after work has already
happened, the default scope is the whole current work unit/thread, not only the
most recent user message, tool action, or follow-up fix. Gather thread-owned
changes across the conversation: original implementation, later bug fixes, UI
follow-ups, tests, changesets, skill/instruction updates, generated plan/source
artifacts, and any local import/linking fixes needed to make the recap open.

Use the current diff plus conversation context to separate thread-owned changes
from unrelated dirty work; exclude unrelated pre-existing edits. If scope is
genuinely ambiguous, state the assumption or ask a concise question before
publishing.

When updating a recap after feedback, revise it so it still covers the whole
work unit plus the new correction — never narrow it to only the latest feedback
unless the user explicitly asks.
