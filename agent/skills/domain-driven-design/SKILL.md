---
name: domain-driven-design
description: Model software around business domains using ubiquitous language, bounded contexts, aggregates, and domain events. Use when designing or reviewing domain models, splitting monoliths, defining service/module boundaries, naming domain concepts, or discussing DDD terms like aggregate root, value object, bounded context, anti-corruption layer, context map, or domain event.
---

# Domain-Driven Design

Use DDD to make code reflect how the business actually works.

## When to Use This Skill

- Modeling a complex business domain or untangling business rules.
- Reviewing names, objects, services, modules, or boundaries for domain fit.
- Deciding whether a concept is an entity, value object, aggregate, repository, factory, or event.
- Splitting a monolith into clearer modules or services.
- Protecting a core domain from external systems, legacy schemas, or generic infrastructure.

## Core Rules

- Prefer domain language over technical language: `ClaimAdjudicator`, not `DataProcessor`.
- Treat naming friction as a modeling signal; if it is hard to name, the concept may be wrong.
- A bounded context is a model/language boundary, not automatically a microservice.
- Keep aggregates small; enforce immediate consistency only inside an aggregate boundary.
- Reference other aggregates by ID, not direct object references.
- Use immutable value objects for concepts defined by attributes.
- Put business behavior in domain objects; avoid data bags plus god services.
- Raise domain events only for facts domain experts care about.
- Add anti-corruption layers wherever foreign models cross into the domain.
- Spend deep modeling effort on the core domain, not on generic plumbing.

## Workflow

1. Identify the domain question: language, boundaries, model objects, events, persistence, or strategy.
2. Read the matching reference below.
3. Ask what a domain expert would call each concept and operation.
4. Sketch the model in terms of contexts, aggregates, value objects, repositories, and events.
5. Check for common smells: technical names, giant aggregates, anemic models, foreign schema leakage, and overbuilt generic subdomains.
6. Recommend the smallest design change that improves business alignment.

## Quick Diagnostic

| Question                                                      | Smell                           | Action                                                |
| ------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Can domain experts understand class, method, and event names? | Technical jargon or vague names | Rename using ubiquitous language.                     |
| Does the same word mean different things to different teams?  | Hidden model conflict           | Split or clarify bounded contexts.                    |
| Is one object responsible for too many consistency rules?     | Giant aggregate                 | Split aggregates and coordinate with events.          |
| Are objects mostly getters and setters?                       | Anemic model                    | Move rules and state transitions into domain objects. |
| Do external schemas appear in the core model?                 | Foreign model leakage           | Add an anti-corruption layer.                         |
| Is every part modeled with equal rigor?                       | Misallocated effort             | Classify core, supporting, and generic subdomains.    |

## References

Use the focused reference that matches the task:

| Topic                  | Usage                                                                             | Reference                                                      |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Language and contexts  | Naming concepts, finding boundaries, context maps, anti-corruption layers         | [language-and-contexts](references/language-and-contexts.md)   |
| Tactical modeling      | Choosing entities, value objects, aggregates, services, and invariants            | [tactical-modeling](references/tactical-modeling.md)           |
| Events and persistence | Domain events, repositories, factories, specifications, event boundaries          | [events-and-persistence](references/events-and-persistence.md) |
| Strategic design       | Core/supporting/generic subdomains, build-vs-buy, where to invest modeling effort | [strategic-design](references/strategic-design.md)             |
