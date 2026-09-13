# Strategic Design

## Subdomain Types

Classify subdomains before deciding how much design effort they deserve.

| Type | Meaning | Investment |
| --- | --- | --- |
| Core Domain | The business differentiator; where competitive advantage lives | Put best people here; use deep modeling. |
| Supporting Subdomain | Necessary and business-specific, but not differentiating | Build simply; avoid over-engineering. |
| Generic Subdomain | Commodity capability many businesses need | Buy, use open source, or keep as thin plumbing. |

Examples:

- Insurance company: risk assessment may be core; document generation supporting; email delivery generic.
- E-commerce company: marketplace matching may be core; inventory admin supporting; authentication generic.
- SaaS product: product workflow may be core; tenant billing supporting; file storage generic.

## Core Domain Tests

Ask:

- Would this capability meaningfully differentiate the business?
- Would outsourcing it weaken the business strategy?
- Do domain experts spend significant time refining its rules?
- Does it change as business strategy changes?
- Would better modeling here create measurable advantage?

If mostly yes, treat it as core.

## Build vs Buy

- Build core domain capabilities when they encode strategic advantage.
- Build supporting subdomains only as much as the business requires.
- Buy or adopt generic subdomains unless they have become core in this business.

## Distillation

When a codebase is muddy:

1. Name the core domain in one sentence.
2. Identify supporting and generic subdomains around it.
3. Move generic infrastructure behind adapters.
4. Protect core concepts with clear modules and anti-corruption layers.
5. Keep the highlighted core small enough for the team to understand deeply.
