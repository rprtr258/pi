# CSS Logical Properties Reference

## Rule

Prefer logical properties so CSS follows writing mode and text direction. Use physical properties only when physical placement is intentional.

## Mapping

| Physical                | Logical                            |
| ----------------------- | ---------------------------------- |
| `width`                 | `inline-size`                      |
| `height`                | `block-size`                       |
| `min-width`             | `min-inline-size`                  |
| `max-width`             | `max-inline-size`                  |
| `margin-left/right`     | `margin-inline-start/end`          |
| `margin-top/bottom`     | `margin-block-start/end`           |
| `padding-left/right`    | `padding-inline-start/end`         |
| `padding-top/bottom`    | `padding-block-start/end`          |
| `border-left/right`     | `border-inline-start/end`          |
| `top/bottom/left/right` | `inset-block-*` / `inset-inline-*` |

## Common Patterns

Center a container:

```css
.wrapper {
  max-inline-size: 72rem;
  margin-inline: auto;
  padding-inline: 1rem;
}
```

Directional accent border:

```css
.callout {
  border-inline-start: 0.25rem solid var(--color-accent);
  padding-inline-start: 1rem;
}
```

Position an action in the inline end corner:

```css
.close-button {
  position: absolute;
  inset-block-start: 0.5rem;
  inset-inline-end: 0.5rem;
}
```

## Good / Bad

**Good:**

```css
.card {
  padding-block: 1rem;
  padding-inline: 1.25rem;
}
```

**Bad:**

```css
.card {
  padding-top: 1rem;
  padding-right: 1.25rem;
  padding-bottom: 1rem;
  padding-left: 1.25rem;
}
```

