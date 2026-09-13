---
name: engineer-prompt
description: >-
  Writes, refactors, and evaluates prompts for LLMs — optimized prompt templates,
  structured output schemas, evaluation rubrics, and test suites. Also analyzes raw
  coding-agent prompts and outputs a ready-to-paste optimized prompt. Advisory only
  — never executes the task itself. Use when designing system prompts, chain-of-thought
  or few-shot learning, personas and guardrails, function-calling schemas, or prompt
  evaluation; or when the user asks to optimize, improve, or rewrite a prompt.
  Not when the user wants the task executed directly ("just do it") or code/performance
  optimized — those are refactoring tasks.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  merged-from: prompt-optimizer v1.0.0 (YannJY02)
  version: "1.3.0"
  domain: data-ml
  triggers: prompt engineering, prompt optimization, rewrite this prompt, improve my prompt, chain-of-thought, few-shot learning, prompt testing, LLM prompts, prompt evaluation, system prompts, structured outputs, prompt design, context management, lost-in-the-middle, context degradation, token optimization, attention budget, ECC components
  role: expert
  scope: design
  output-format: document
  related-skills: test-master, rag-architect, debugging-wizard, skill-stocktake
---

# Prompt Engineer

Expert prompt engineer specializing in designing, optimizing, and evaluating prompts that maximize LLM performance across diverse use cases.

This skill has two modes:

- **Mode A — LLM prompt engineering** (default): design, optimize, and evaluate prompts as software artifacts for LLM applications.
- **Mode B — coding-agent prompt optimization**: the user hands you a raw task prompt (e.g. for Claude Code / ECC); analyze, critique, and return a ready-to-paste optimized prompt. Advisory only.

## When to Use This Skill

- Designing prompts for new LLM applications
- Optimizing existing prompts for better accuracy or efficiency
- Implementing chain-of-thought or few-shot learning
- Creating system prompts with personas and guardrails
- Building structured output schemas (JSON mode, function calling)
- Developing prompt evaluation and testing frameworks
- Debugging inconsistent or poor-quality LLM outputs
- Migrating prompts between different models or providers
- User asks to optimize, improve, rewrite, or give feedback on a prompt for a coding agent, or invokes `/prompt-optimize` (Mode B — see below)

### Do Not Use When

- User wants the task done directly ("just do it") — execute it as a normal task
- User says "optimize this code", "optimize performance" — refactoring/performance tasks, not prompt optimization
- User is asking about ECC configuration (use `configure-ecc` instead)
- User wants a skill inventory (use `skill-stocktake` instead)

## Mode A: Core Workflow — LLM Prompt Engineering

1. **Understand requirements** — Define task, success criteria, constraints, and edge cases
2. **Design initial prompt** — Choose pattern (zero-shot, few-shot, CoT), write clear instructions
3. **Test and evaluate** — Run diverse test cases, measure quality metrics
   - **Validation checkpoint:** If accuracy < 80% on the test set, identify failure patterns before iterating (e.g., ambiguous instructions, missing examples, edge case gaps)
4. **Iterate and optimize** — Make one change at a time; refine based on failures, reduce tokens, improve reliability
5. **Document and deploy** — Version prompts, document behavior, monitor production

## Mode B: Optimize a Raw Coding Prompt (Advisory)

Analyze a draft prompt, critique it, match it to ECC ecosystem components,
and output a complete optimized prompt the user can paste and run.

**Advisory only — do not execute the user's task.** Do NOT write code, create
files, run commands, or take any implementation action. Your ONLY output is an
analysis plus an optimized prompt. If the user says "just do it", tell them this
skill only produces optimized prompts and they should make a normal task request.

Run this 6-phase pipeline sequentially. Present results in the Mode B Output
Format defined in `references/mode-b.md`.

### Analysis Pipeline

### Phase 0: Project Detection

Before analyzing the prompt, detect the current project context:

1. Check if a `CLAUDE.md` exists in the working directory — read it for project conventions
2. Detect tech stack from project files:
   - `package.json` → Node.js / TypeScript / React / Next.js
   - `go.mod` → Go
   - `pyproject.toml` / `requirements.txt` → Python
   - `Cargo.toml` → Rust
   - `build.gradle` / `pom.xml` → Java / Kotlin / Spring Boot
   - `Package.swift` → Swift
   - `Gemfile` → Ruby
   - `composer.json` → PHP
   - `*.csproj` / `*.sln` → .NET
   - `Makefile` / `CMakeLists.txt` → C / C++
   - `cpanfile` / `Makefile.PL` → Perl
3. Note detected tech stack for use in Phase 3 and Phase 4

If no project files are found (e.g., the prompt is abstract or for a new project),
skip detection and flag "tech stack unknown" in Phase 4.

### Phase 1: Intent Detection

Classify the user's task into one or more categories:

| Category | Signal Words | Example |
|----------|-------------|---------|
| New Feature | build, create, add, implement | "Build a login page" |
| Bug Fix | fix, broken, not working, error | "Fix the auth flow" |
| Refactor | refactor, clean up, restructure | "Refactor the API layer" |
| Research | how to, what is, explore, investigate | "How to add SSO" |
| Testing | test, coverage, verify | "Add tests for the cart" |
| Review | review, audit, check | "Review my PR" |
| Documentation | document, update docs | "Update the API docs" |
| Infrastructure | deploy, CI, docker, database | "Set up CI/CD pipeline" |
| Design | design, architecture, plan | "Design the data model" |

### Phase 2: Scope Assessment

If Phase 0 detected a project, use codebase size as a signal. Otherwise, estimate
from the prompt description alone and mark the estimate as uncertain.

| Scope | Heuristic | Orchestration |
|-------|-----------|---------------|
| TRIVIAL | Single file, < 50 lines | Direct execution |
| LOW | Single component or module | Single command or skill |
| MEDIUM | Multiple components, same domain | Command chain + /verify |
| HIGH | Cross-domain, 5+ files | /plan first, then phased execution |
| EPIC | Multi-session, multi-PR, architectural shift | Use blueprint skill for multi-session plan |

### Phase 3: ECC Component Matching

Map intent + scope + tech stack (from Phase 0) to ECC commands, skills, and
agents using the matching tables in `references/mode-b.md`. Recommend only
components detected on the user's system; if a match isn't installed, say so
and recommend installing it instead of pretending it ran.

### Phase 4: Missing Context Detection

Scan the prompt for missing critical information. Check each item and mark
whether Phase 0 auto-detected it or the user must supply it:

- [ ] **Tech stack** — Detected in Phase 0, or must user specify?
- [ ] **Target scope** — Files, directories, or modules mentioned?
- [ ] **Acceptance criteria** — How to know the task is done?
- [ ] **Error handling** — Edge cases and failure modes addressed?
- [ ] **Security requirements** — Auth, input validation, secrets?
- [ ] **Testing expectations** — Unit, integration, E2E?
- [ ] **Performance constraints** — Load, latency, resource limits?
- [ ] **UI/UX requirements** — Design specs, responsive, a11y? (if frontend)
- [ ] **Database changes** — Schema, migrations, indexes? (if data layer)
- [ ] **Existing patterns** — Reference files or conventions to follow?
- [ ] **Scope boundaries** — What NOT to do?

**If 3+ critical items are missing**, ask the user up to 3 clarification
questions before generating the optimized prompt. Then incorporate the
answers into the optimized prompt.

### Phase 5: Workflow & Model Recommendation

Determine where this prompt sits in the development lifecycle:

```
Research → Plan → Implement (TDD) → Review → Verify → Commit
```

For MEDIUM+ tasks, always start with /plan. For EPIC tasks, use blueprint skill.

**Model recommendation** and **multi-prompt splitting** guidance for HIGH/EPIC
tasks: load `references/mode-b.md` (§ Model Recommendation & Multi-Prompt
Splitting) and include both in the output.
### Mode B Output Format & Examples

Load `references/mode-b.md` for the required 5-section + footer output format,
the ECC component matching tables, model recommendation, multi-prompt
splitting, and three worked examples (login page, Go API, microservices
migration).

### Related Components

| Component | When to Reference |
|-----------|------------------|
| `configure-ecc` | User hasn't set up ECC yet |
| `skill-stocktake` | Audit which components are installed (use instead of hardcoded catalog) |
| `search-first` | Research phase in optimized prompts |
| `blueprint` | EPIC-scope optimized prompts (invoke as skill, not command) |
| `strategic-compact` | Long session context management |
| `cost-aware-llm-pipeline` | Token optimization recommendations |

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Prompt Patterns | `references/prompt-patterns.md` | Zero-shot, few-shot, chain-of-thought, ReAct |
| Optimization | `references/prompt-optimization.md` | Iterative refinement, A/B testing, token reduction |
| Evaluation | `references/evaluation-frameworks.md` | Metrics, test suites, automated evaluation |
| Structured Outputs | `references/structured-outputs.md` | JSON mode, function calling, schema design |
| System Prompts | `references/system-prompts.md` | Persona design, guardrails, injection defense |
| Context Management | `references/context-management.md` | Attention budget, degradation patterns, context optimization |
| Mode B (coding-agent prompts) | `references/mode-b.md` | Running Mode B: output format, component tables, model recs, examples |

## Constraints

### MUST DO
- Test prompts with diverse, realistic inputs including edge cases
- Measure performance with quantitative metrics (accuracy, consistency)
- Version prompts and track changes systematically
- Document expected behavior and known limitations
- Use few-shot examples that match target distribution
- Validate structured outputs against schemas
- Consider token costs and latency in design
- Test across model versions before production deployment

### MUST NOT DO
- Deploy prompts without systematic evaluation on test cases
- Use few-shot examples that contradict instructions
- Ignore model-specific capabilities and limitations
- Skip edge case testing (empty inputs, unusual formats)
- Make multiple changes simultaneously when debugging
- Hardcode sensitive data in prompts or examples
- Assume prompts transfer perfectly between models
- Neglect monitoring for prompt degradation in production

## Output Templates

When delivering Mode A (LLM prompt engineering) work, provide:
1. Final prompt with clear sections (role, task, constraints, format)
2. Test cases and evaluation results
3. Usage instructions (temperature, max tokens, model version)
4. Performance metrics and comparison with baselines
5. Known limitations and edge cases
