# CSS Cascade Layers Reference

## Decision Table

| Goal                                      | Use                            | Avoid                                    |
| ----------------------------------------- | ------------------------------ | ---------------------------------------- |
| Control override order across CSS sources | `@layer`                       | Selector specificity wars                |
| Override vendor/reset CSS safely          | Put vendor/reset in low layers | `!important` overrides                   |
| Keep utilities strongest                  | Put utilities last             | Component selectors that fight utilities |
| Lower specificity inside selectors        | `:where()`                     | Repeating classes or IDs                 |

## Layer Order

Declare order once, low priority to high priority:

```css
@layer reset, base, components, utilities;
```

Then place styles in layers:

```css
@layer reset {
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
}

@layer base {
  body {
    font-family: system-ui, sans-serif;
  }
}

@layer components {
  .button {
    border-radius: 0.5rem;
  }
}

@layer utilities {
  .hidden {
    display: none;
  }
}
```

Later layers beat earlier layers regardless of selector specificity.

## Important Cascade Detail

Unlayered author styles beat normal layered author styles. If using layers, intentionally decide whether a file should be layered or unlayered.

## Specificity Control

Use `:where()` to keep component defaults easy to override:

```css
@layer components {
  .card :where(h2, p) {
    margin-block: 0;
  }
}
```

Use `:is()` for grouping when specificity should match the most specific selector inside.

## Good / Bad

**Good:**

```css
@layer vendor, base, components, overrides;

@import url("vendor.css") layer(vendor);

@layer components {
  .dialog {
    padding: 1rem;
  }
}
```

**Bad:**

```css
body .page main .dialog.dialog.dialog {
  padding: 1rem !important;
}
```

## When `!important` Is Acceptable

Use rarely:

- Accessibility utilities that must win, such as visually-hidden helpers.
- Intentional utility contracts where important utilities are part of the system.
- Overriding hostile third-party inline styles when no better integration exists.

