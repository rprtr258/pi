# Language and Contexts

## Ubiquitous Language

A ubiquitous language is the shared vocabulary used by domain experts and developers in conversation, code, tests, docs, and events.

Use it this way:

- Listen for business nouns and verbs during scenario walkthroughs.
- Name classes after domain concepts: `LoanApplication`, `PolicyRenewalNotice`.
- Name methods after business operations: `policy.underwrite(application)`, `claim.deny(reason)`.
- Name events as past-tense facts: `ClaimSubmitted`, `PaymentReceived`.
- Rename code when the language changes.
- Treat `Manager`, `Helper`, `Processor`, `Data`, and `Service` as naming smells unless there is a clear domain meaning.

**Good:**

```ruby
claim.adjudicate_by(adjuster)
policy.renew(effective_on: date)
```

**Bad:**

```ruby
claim_processor.process(claim_data)
policy_service.update_status(policy, 3)
```

## Bounded Contexts

A bounded context is a boundary where a model and language are internally consistent. The same word may mean different things in different contexts.

Boundary signals:

- The same term means different things to different teams.
- Teams must translate terms in conversation.
- Different processes, regulations, or consistency needs apply.
- Different teams own the work or change at different rates.

A bounded context can be a module inside a monolith. Do not create a distributed service just because a model boundary exists.

## Context Mapping Patterns

Use these most often:

| Pattern | Use When | Rule of Thumb |
| --- | --- | --- |
| Anti-Corruption Layer | External, legacy, or upstream model would pollute your domain | Translate at the boundary; never leak foreign names inward. |
| Open Host Service / Published Language | Other contexts need a stable API from you | Publish clear contracts in your terms. |
| Customer-Supplier | One team consumes another team's model/API | Make dependency and influence explicit. |
| Conformist | You cannot influence upstream and translation is not worth it | Accept the upstream model locally; keep it away from core domain if possible. |
| Shared Kernel | Two teams truly share a small model subset | Keep it tiny, governed, and tested by both teams. |

Avoid a Shared Kernel for entities and aggregates; value objects like `Money` or `DateRange` are safer.
