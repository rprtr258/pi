---
name: prd
description: Turns current conversation context and codebase understanding into a PRD for the project issue tracker. Use when the user wants to create or publish a product requirements document from existing context.
---

# PRD

Synthesize the current conversation and codebase understanding into a product requirements document. Do not interview the user; work from what is already known unless a blocking ambiguity prevents progress.

## When to Use This Skill

- The user wants a PRD from the current conversation context.
- The user wants product requirements published to an issue tracker.
- The user wants implementation and testing decisions captured before issue breakdown.

## Core Rules

- Use the project’s domain glossary vocabulary throughout.
- Respect ADRs in the area being changed.
- Actively look for deep modules that encapsulate behavior behind simple, testable interfaces.
- Do not ask the user for confirmation before publishing. Use your best judgment for modules and test coverage based on the conversation context. The user will review your work.
- Do not include specific file paths or code snippets unless a prototype snippet captures a decision more precisely than prose.
- Preserve referenced assets such as screenshots, mockups, diagrams, prototypes, recordings, or uploaded files so downstream issues can link back to them.

## Workflow

1. Explore the repo if needed to understand current implementation, domain language, and relevant ADRs.
2. Collect any assets supplied in the conversation: screenshots, mockups, diagrams, prototypes, recordings, uploaded files, or URLs.
3. Identify the major modules to build or modify, including any deep-module opportunities.
4. Determine test coverage based on conversation context and codebase patterns.
5. Write the PRD using the template below, including an **Assets** section when assets exist.
6. Publish it to the documented PRD home. If no such documented home can be found, request guidance from the user.

## PRD Template

```md
## Problem Statement

The problem the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A long numbered list of user stories:

1. As an <actor>, I want a <feature>, so that <benefit>

## Implementation Decisions

A list of implementation decisions, such as modules to build or modify, interfaces to change, technical clarifications, architectural decisions, schema changes, API contracts, and specific interactions.

## Testing Decisions

A list of testing decisions, including what makes a good test, which modules will be tested, and prior art for similar tests in the codebase.

## Assets

Links or attachments for design screenshots, mockups, or other source material. Include a short note explaining what each asset shows and which user stories or decisions it informs. Omit this section if there are no assets.

## Out of Scope

Things explicitly outside this PRD.

## Further Notes

Any further notes about the feature.
```
