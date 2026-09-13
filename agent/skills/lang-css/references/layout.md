# CSS Layout Reference

## Decision Table

| Goal                                   | Use                                                | Avoid                                           |
| -------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| One-dimensional distribution           | Flexbox                                            | Grid just to align a row of items               |
| Two-dimensional layout                 | Grid                                               | Nested flex wrappers for rows and columns       |
| Align nested children to parent tracks | Subgrid                                            | Hard-coded heights or JS equalization           |
| Unknown number of responsive cards     | `repeat(auto-fit, minmax(min(...), 1fr))`          | Many breakpoint-specific column rules           |
| Overlay or pin inside a box            | Absolute positioning within a positioned container | Absolute positioning for normal document layout |
| Preserve media ratio                   | `aspect-ratio`                                     | Padding-bottom ratio hacks                      |

## Grid

Use Grid when both rows and columns matter.

```css
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
  gap: 1rem;
}
```

Use named areas for stable page regions:

```css
.shell {
  display: grid;
  grid-template:
    "header header" auto
    "nav main" 1fr / 16rem minmax(0, 1fr);
}
```

Use `minmax(0, 1fr)` when grid children may overflow because `auto` minimum size is too large:

```css
.main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20rem;
}
```

## Flexbox

Use Flexbox when one axis is primary.

```css
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.toolbar > .search {
  flex: 1 1 20rem;
  min-inline-size: 0;
}
```

Add `min-inline-size: 0` to flex/grid children that must shrink below content width.

## Subgrid

Use subgrid when repeated components need aligned internals.

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  grid-auto-rows: auto 1fr auto;
  gap: 1rem;
}

.card {
  grid-row: span 3;
  display: grid;
  grid-template-rows: subgrid;
  gap: 0.75rem;
}
```

This aligns card headers, bodies, and footers without fixed heights.

## Good / Bad

**Good:**

```css
.card-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
}
```

**Bad:**

```css
.card-list {
  display: flex;
  flex-wrap: wrap;
}

.card {
  width: 33.333%;
  height: 420px;
}
```

