# CSS Forms Reference

## Decision Table

| Goal                                        | Use                              | Notes                                      |
| ------------------------------------------- | -------------------------------- | ------------------------------------------ |
| Style invalid field wrapper                 | `.field:has(:invalid)`           | Prefer wrapper state over JS class toggles |
| Style focused field wrapper                 | `.field:has(:focus-visible)`     | Preserve visible focus                     |
| Theme checkbox/radio/range accent           | `accent-color`                   | Native, simple, accessible                 |
| Hide native appearance only when rebuilding | `appearance: none`               | Must restore focus, size, states           |
| Communicate state                           | ARIA/data attributes + selectors | CSS must not be the only signal            |

## Field Wrapper State

```css
.field {
  display: grid;
  gap: 0.375rem;
}

.field:has(:focus-visible) {
  outline: 2px solid var(--color-focus);
  outline-offset: 0.25rem;
}

.field:has(:invalid:not(:placeholder-shown)) .field__error {
  display: block;
}
```

## Native Accent Color

```css
input[type="checkbox"],
input[type="radio"],
input[type="range"] {
  accent-color: var(--color-accent);
}
```

## Accessible Focus

Do not remove outlines without a replacement.

**Good:**

```css
.button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}
```

**Bad:**

```css
button:focus {
  outline: none;
}
```

## Form Layout

Use grid for label/control/error alignment:

```css
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
  gap: 1rem;
}
```

