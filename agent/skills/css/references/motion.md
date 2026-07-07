# CSS Motion Reference

## Decision Table

| Goal                                 | Use                                       | Avoid                                    |
| ------------------------------------ | ----------------------------------------- | ---------------------------------------- |
| Cheap UI transitions                 | `opacity`, `translate`, `scale`, `rotate` | Animating layout/paint-heavy properties  |
| Entry transition from initial render | `@starting-style`                         | JS timeout class toggles                 |
| Scroll-linked progress               | Scroll-driven animations                  | Scroll event handlers for simple effects |
| Respect user preference              | `prefers-reduced-motion`                  | Forced parallax or large movement        |
| Component state motion               | Attribute/class state + transition        | Inline styles for every state            |

## Performant Properties

Prefer individual transform properties for readability:

```css
.toast {
  opacity: 0;
  translate: 0 0.5rem;
  transition:
    opacity 160ms ease,
    translate 160ms ease;
}

.toast[data-open="true"] {
  opacity: 1;
  translate: 0 0;
}
```

## `@starting-style`

```css
.dialog[open] {
  opacity: 1;
  scale: 1;
  transition:
    opacity 160ms ease,
    scale 160ms ease;

  @starting-style {
    opacity: 0;
    scale: 0.98;
  }
}
```

## Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
  }

  .animated {
    animation: none;
    transition-duration: 1ms;
  }
}
```

Prefer removing large movement while keeping useful instant state changes.

## Scroll-Driven Animation

Use as progressive enhancement:

```css
@supports (animation-timeline: scroll()) {
  .reading-progress {
    transform-origin: left;
    animation: grow linear both;
    animation-timeline: scroll();
  }

  @keyframes grow {
    from {
      scale: 0 1;
    }
    to {
      scale: 1 1;
    }
  }
}
```

