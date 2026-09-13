# Events and Persistence

## Domain Events

A domain event is an immutable fact that happened in the domain and matters to domain experts.

Rules:

- Name events in past tense: `OrderPlaced`, `InvoicePaid`, `PolicyRenewed`.
- Do not name commands as events: `PlaceOrder` is a command, not an event.
- Publish events for meaningful business occurrences, not technical changes like `RowInserted`.
- Domain events stay within a bounded context; integration events cross context boundaries.
- Include enough payload for consumers to react without synchronous callback when practical.

Event fields usually include:

| Field | Purpose |
| --- | --- |
| `event_id` | Unique event occurrence. |
| `occurred_at` | When the fact happened. |
| `aggregate_id` | Source aggregate identity. |
| `event_type` | Stable event name. |
| `payload` | Business data consumers need. |
| `metadata` | Correlation, causation, actor, trace data. |

## Repositories

A repository gives domain code the illusion of an in-memory collection of aggregates while hiding persistence details.

Rules:

- Define repository interfaces near the domain model when the domain needs the abstraction.
- Implement repositories in infrastructure.
- Use domain language in query methods: `find_overdue_invoices`, not `get_by_status_code(3)`.
- Repositories load and save aggregate roots, not arbitrary internal children.
- Do not leak SQL, ORM query objects, or external schemas into domain objects.

## Factories

Use a factory when creation has meaningful rules, multiple steps, or conditional assembly.

Use a constructor when creation is simple.

**Good factory use:**

- Creating an `Order` from a `Quote` while validating pricing and eligibility.
- Reconstituting an aggregate from persisted records.
- Choosing a subtype/strategy based on domain rules.

**Bad factory use:**

- `MoneyFactory.create(amount, currency)` when `Money.new(amount, currency)` is enough.

## Specifications

A specification is a named domain predicate, useful when query criteria or business rules need reuse.

Examples:

- `OverdueInvoiceSpecification`
- `EligibleForRenewalSpecification`
- `HighRiskApplicationSpecification`
