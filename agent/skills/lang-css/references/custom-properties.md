# CSS Custom Properties Reference

## Decision Table

| Goal                                 | Use                                       | Notes                                             |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------- |
| Themeable design token               | Custom property on `:root` or theme scope | E.g. colors, radii, spacing                       |
| Component API                        | Custom property on component              | Document expected value/type                      |
| Local derived value                  | Custom property near use                  | Keeps calculations readable                       |
| Fallback value                       | `var(--name, fallback)`                   | Fallback only used if variable is invalid/missing |
| Type-safe animatable custom property | `@property`                               | Progressive enhancement                           |

## Tokens

```css
:root {
  --color-surface: white;
  --color-text: oklch(20% 0.02 260);
  --radius-card: 0.75rem;
  --space-card: 1rem;
}
```

## Component APIs

```css
.badge {
  --badge-bg: var(--color-accent-soft);
  --badge-fg: var(--color-accent-strong);

  background: var(--badge-bg);
  color: var(--badge-fg);
  border-radius: 999px;
  padding-inline: 0.625em;
}
```

Consumers can override:

```css
.badge[data-tone="danger"] {
  --badge-bg: var(--color-danger-soft);
  --badge-fg: var(--color-danger-strong);
}
```

## Derived Values

```css
.card {
  --card-padding: clamp(1rem, 3cqi, 1.5rem);
  --card-gap: calc(var(--card-padding) / 2);

  padding: var(--card-padding);
  gap: var(--card-gap);
}
```

## `@property`

Use when a custom property needs syntax, inheritance control, or smooth animation.

```css
@property --progress {
  syntax: "<percentage>";
  inherits: false;
  initial-value: 0%;
}

.meter {
  --progress: 40%;
  background: linear-gradient(
    90deg,
    currentColor var(--progress),
    transparent 0
  );
}
```

## Pitfalls

- Custom properties inherit. Set local defaults on components when inheritance would surprise consumers.
- Invalid values can invalidate the whole declaration at computed-value time.
- Avoid global variables for one-off component internals.

