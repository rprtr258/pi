---
name: architecture
description: Find deepening opportunities in a codebase. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled or shallow modules, clarify seams, or make a codebase more testable and AI-navigable.
---

# Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Core Rules

- Use the architecture vocabulary exactly: **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, and **locality**. Full definitions live in [language](references/language.md).
- Use the deletion test on suspected shallow modules: if deleting it makes complexity vanish, it was probably a pass-through; if complexity reappears across callers, it was earning its keep.
- Let the existing code and project language guide good seams. Do not invent pattern-shaped architecture that hides nothing.
- Do not propose interfaces in the report. Present candidates first, then ask which one to explore.

## Workflow

### 1. Explore

Explore the codebase organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow. A useful module concentrates complexity. A shallow module mostly moves complexity around.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` or `%TEMP%`, and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user and tell them the absolute path.

Use [HTML report format](references/html-report.md). The report uses Tailwind via CDN for layout and Mermaid via CDN for diagrams where graph-shaped relationships help. Mix Mermaid with hand-crafted CSS/SVG visuals. Each candidate gets a before/after visualisation.

For each candidate, render one card:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality, leverage, and how tests improve
- **Before / After diagram** — side-by-side, illustrating shallowness and deepening
- **Recommendation strength** — `Strong`, `Worth exploring`, or `Speculative`

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

Use the project's domain vocabulary when it is available, and [language](references/language.md) vocabulary for architecture. If the project clearly calls a concept `Order`, talk about the `Order` intake module — not a generic pattern name unless that is truly the project term.

After the file is written, ask: **"Which of these would you like to explore?"**

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them: constraints, dependencies, the shape of the deepened module, what sits behind the seam, and what tests survive.

Use these questions without turning the conversation into a checklist:

- Is this a real seam with more than one adapter/caller, or a speculative one?
- Is the proposed name project language, or a technical pattern name?
- Does this deepen a module, or merely move code sideways?
- Will tests become simpler through the public interface?

If the user wants to explore alternative interfaces for the deepened module, use [interface design](references/interface-design.md).

## References

Read the reference that matches the current task:

| Topic            | When to Read                                                        | Reference                                          |
| ---------------- | ------------------------------------------------------------------- | -------------------------------------------------- |
| language         | Before making architecture suggestions                              | [language](references/language.md)                 |
| deepening        | When evaluating dependencies and test strategy for a candidate      | [deepening](references/deepening.md)               |
| HTML report      | Before writing the candidate report                                 | [HTML report format](references/html-report.md)    |
| interface design | After the user chooses a candidate and wants interface alternatives | [interface design](references/interface-design.md) |
