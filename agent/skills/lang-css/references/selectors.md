# CSS Selectors Reference

## Decision Table

| Goal                                           | Use                 | Notes                                     |
| ---------------------------------------------- | ------------------- | ----------------------------------------- |
| Style parent based on child/state              | `:has()`            | Keep scoped and narrow                    |
| Group alternatives without raising specificity | `:where()`          | Specificity is zero                       |
| Group alternatives with normal specificity     | `:is()`             | Specificity equals most specific argument |
| Exclude conditions                             | `:not()`            | Can combine with `:is()`/`:where()`       |
| Style based on ARIA/data state                 | Attribute selectors | Prefer semantic state attributes          |

## `:has()` Patterns

Form state:

```css
.field:has(:invalid) {
  border-color: var(--color-danger);
}

.field:has(:focus-visible) {
  outline: 2px solid var(--color-focus);
}
```

Conditional component layout:

```css
.card:has(> img:first-child) {
  padding-block-start: 0;
}
```

Sibling state:

```css
.step:has(+ .step[aria-current="step"]) {
  color: var(--color-muted);
}
```

Quantity-like condition:

```css
.grid:has(> :nth-child(5)) {
  --grid-min: 14rem;
}
```

## Scope Selectors

Prefer component-scoped selectors:

```css
.filter-panel:has([aria-expanded="true"]) .filter-panel__summary {
  font-weight: 600;
}
```

Avoid broad document queries unless necessary:

```css
body:has(.modal[open]) {
  overflow: hidden;
}
```

This is acceptable for document-level state, but should be intentional.

## `:where()` for Low Specificity

```css
.prose :where(h1, h2, h3, p, ul, ol) {
  margin-block: 0;
}
```

## Good / Bad

**Good:**

```css
.card:has(> .card__media) {
  grid-template-rows: auto 1fr;
}
```

**Bad:**

```css
body main section div:has(img) {
  display: grid;
}
```

