---
name: testing-tdd
description: Test-driven development with red-green-refactor loop. Use when writing new features, fixing bugs, refactoring code, or adding API endpoints/components; when user wants TDD, mentions "red-green-refactor", wants unit/integration/E2E tests with 80%+ coverage, or asks for test-first development.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

See [tests.md](tests.md) for examples, [mocking.md](mocking.md) for mocking guidelines, and [patterns.md](patterns.md) for framework-specific test patterns, file organization, and coverage setup.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

Before writing any code:

- [ ] Confirm with user what interface changes are needed
- [ ] Confirm with user which behaviors to test (prioritize)
- [ ] Capture user journeys ("As a [role], I want to [action], so that [benefit]") and derive the behaviors to test from them
- [ ] Identify opportunities for [deep modules](deep-modules.md) (small interface, deep implementation)
- [ ] Design interfaces for [testability](interface-design.md)
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

**You can't test everything.** Confirm with the user exactly which behaviors matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### RED Gate

A valid RED state must be confirmed before modifying any production code:

- **Runtime RED** (preferred): the relevant test target compiles, the new test is actually executed, and it fails.
- **Compile-time RED**: acceptable when the new test exercises the missing/buggy code path and the compile failure is itself the intended signal.
- Either way, the failure must be caused by the intended missing behavior - not by unrelated syntax errors, broken test setup, missing dependencies, or unrelated regressions.
- A test that was written but never compiled and executed does **not** count as RED.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](refactoring.md):

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Test Types

Cover the behaviors in scope at the level that gives the most signal:

- **Unit** - individual functions, utilities, component logic. Fast (<50ms each).
- **Integration** - API endpoints, database operations, service interactions.
- **E2E** - critical user flows end-to-end (e.g. Playwright), only for flows that matter. See [patterns.md](patterns.md).

## Coverage

- Minimum 80% coverage (branches/functions/lines/statements) across unit + integration + E2E, verified with the coverage runner after the loop (see [patterns.md](patterns.md)).
- Edge cases, error scenarios, and boundary conditions of the behaviors in scope must be tested, not just happy paths.

Planning decides which behaviors get the deepest coverage (you can't test everything); the coverage gate catches what slipped.

## Git Checkpoints

If the repository is under Git, create a checkpoint commit after each validated TDD stage. Do not squash or rewrite checkpoint commits until the workflow is complete.

- Preferred compact sequence:
  - `test: add reproducer for <feature or bug>` - failing test added and RED validated
  - `fix: <feature or bug>` - minimal fix applied and GREEN validated (stage the fix before running tests, commit only after GREEN)
  - `refactor: clean up after <feature or bug> implementation` - optional, after refactor completes with tests green
- Separate evidence-only commits are not required when the test commit clearly corresponds to RED and the fix commit clearly corresponds to GREEN.
- Count only commits created on the current active branch for the current task. Before treating a checkpoint as satisfied, verify it is reachable from `HEAD` and belongs to the current task sequence - not commits from other branches, earlier unrelated work, or distant branch history.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
[ ] Test is independent - sets up its own data, no ordering dependency
```

After the loop, verify the [coverage](#coverage) gate and [success metrics](patterns.md) are met.
