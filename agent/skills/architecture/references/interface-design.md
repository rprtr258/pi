# Interface Design

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this parallel subagent pattern. Based on "Design It Twice": your first idea is unlikely to be the best.

Uses the vocabulary in [language](language.md): **module**, **interface**, **seam**, **adapter**, and **leverage**.

## Process

### 1. Frame the Problem Space

Before spawning subagents, write a user-facing explanation of the problem space for the chosen candidate:

- the constraints any new interface must satisfy;
- the dependencies it relies on, and which category they fall into from [deepening](deepening.md);
- a rough illustrative code sketch to ground the constraints — not a proposal, just enough to make constraints concrete.

Show this to the user, then proceed to Step 2. The user reads while the subagents work in parallel.

### 2. Spawn Subagents

Spawn three or more subagents in parallel. Each must produce a radically different interface for the deepened module.

Prompt each subagent with a separate technical brief: file paths, coupling details, dependency category from [deepening](deepening.md), and what sits behind the seam. Give each agent a different design constraint:

- Agent 1: minimize the interface — aim for 1–3 entry points and maximum leverage per entry point.
- Agent 2: maximize flexibility — support many use cases and extension.
- Agent 3: optimize for the most common caller — make the default case trivial.
- Agent 4, when applicable: design around adapters for cross-seam dependencies.

Include [language](language.md) vocabulary and project vocabulary in the brief so each subagent names things consistently.

Each subagent outputs:

1. Interface: methods, params, invariants, ordering, and error modes.
2. Usage example showing how callers use it.
3. What the implementation hides behind the seam.
4. Dependency strategy and adapters.
5. Trade-offs: where leverage is high, where it is thin.

### 3. Present and Compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by:

- **depth** — leverage at the interface;
- **locality** — where change concentrates;
- **seam placement** — what callers and tests cross.

After comparing, give your own recommendation. If elements from different designs combine well, propose a hybrid. Be opinionated — the user wants a strong read, not a menu.
