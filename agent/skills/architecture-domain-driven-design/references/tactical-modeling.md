# Tactical Modeling

## Entity vs Value Object

Use this test:

| Type | Identity Question | Design Rule |
| --- | --- | --- |
| Entity | Is it the same thing even if attributes change? | Identity is stable; behavior lives on the entity. |
| Value Object | Is it defined only by its attributes? | Immutable, self-validating, equality by value. |

Prefer value objects when possible: `Money`, `EmailAddress`, `DateRange`, `Address`, `Quantity`.

**Good value object:** validates itself, has no setters, returns new values for operations.

**Bad value object:** wraps primitives but allows invalid state or mutation.

## Aggregates

An aggregate is a consistency boundary. One aggregate root controls all changes inside the boundary.

Rules:

- External code talks only to the aggregate root.
- Objects inside the aggregate can be strongly consistent together.
- Objects outside the aggregate are eventually consistent.
- Keep aggregates small; large aggregates cause lock contention, slow loading, and tangled rules.
- Reference other aggregates by ID.

**Good:**

```text
Order aggregate:
- Order root
- OrderLine value/entity children
- ShippingAddress value object
- customer_id reference to Customer aggregate
```

**Bad:**

```text
Order aggregate directly contains Customer, Inventory, Payment, Shipment, and Invoice.
```

## Domain Services

Use a domain service only when an operation is truly domain logic but does not naturally belong to one entity or value object.

Good domain service examples:

- `CurrencyExchangeService.convert(amount, target_currency)`
- `FraudAssessment.assess(order, customer_history)`

Avoid services that merely coordinate CRUD or hide anemic models.

## Invariants

Put invariants where they can never be bypassed:

- Value object constructor/factory for value validity.
- Aggregate root methods for aggregate consistency.
- Database constraints for last-line protection.
- Domain events for eventual consistency across aggregate boundaries.
