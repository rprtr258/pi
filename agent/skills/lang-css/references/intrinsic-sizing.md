# CSS Intrinsic Sizing Reference

## Decision Table

| Goal                            | Use                                         | Avoid                            |
| ------------------------------- | ------------------------------------------- | -------------------------------- |
| Fluid value with min/max bounds | `clamp(min, preferred, max)`                | Many near-identical breakpoints  |
| Choose smaller/larger of values | `min()` / `max()`                           | Calc-heavy media query overrides |
| Responsive grid tracks          | `minmax()` + `auto-fit`                     | Fixed percentage columns         |
| Content-based width             | `fit-content`, `max-content`, `min-content` | Hard-coded widths                |
| Prevent media distortion        | `aspect-ratio`                              | Padding ratio hacks              |
| Allow grid/flex item shrinking  | `min-inline-size: 0`                        | Hidden overflow hacks first      |

## Fluid Containers

```css
.prose {
  inline-size: min(100% - 2rem, 70ch);
  margin-inline: auto;
}
```

## Responsive Grid

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
  gap: clamp(0.75rem, 2vw, 1.5rem);
}
```

`min(18rem, 100%)` prevents overflow in narrow containers.

## Fluid Type and Space

```css
:root {
  --step-0: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
  --step-2: clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem);
  --space-m: clamp(1rem, 0.75rem + 1vw, 1.5rem);
}
```

## Aspect Ratio

```css
.media {
  aspect-ratio: 16 / 9;
  object-fit: cover;
  inline-size: 100%;
}
```

## Overflow Fixes

Grid and flex children often need `min-inline-size: 0` before text truncation or wrapping works.

```css
.card__body {
  min-inline-size: 0;
}

.card__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

