# CSS Colors Reference

## Decision Table

| Goal                   | Use                                 | Notes                                         |
| ---------------------- | ----------------------------------- | --------------------------------------------- |
| Perceptual color token | `oklch()`                           | Better lightness/chroma control than HSL      |
| Derived states         | `color-mix()`                       | Good for hover, soft backgrounds, borders     |
| Adjust a base color    | Relative color syntax               | Check support and use `@supports` when needed |
| Theme switch           | Custom properties on theme scope    | Keep semantic names                           |
| Guaranteed contrast    | Test computed foreground/background | Do not assume derived colors pass             |

## Semantic Tokens

```css
:root {
  --color-bg: oklch(99% 0.01 250);
  --color-fg: oklch(22% 0.03 250);
  --color-accent: oklch(62% 0.18 250);
  --color-accent-soft: color-mix(in oklch, var(--color-accent), white 85%);
  --color-accent-strong: color-mix(in oklch, var(--color-accent), black 20%);
}
```

Prefer semantic names (`--color-danger`, `--color-surface`) over presentational names (`--blue-500`) at component boundaries.

## `color-mix()`

```css
.button {
  background: var(--color-accent);
  border-color: color-mix(in oklch, var(--color-accent), black 12%);
}

.button:hover {
  background: color-mix(in oklch, var(--color-accent), black 8%);
}
```

## Progressive Enhancement

```css
:root {
  --color-accent: #315eea;
  --color-accent-soft: #eef2ff;
}

@supports (color: oklch(50% 0.1 250)) {
  :root {
    --color-accent: oklch(62% 0.18 250);
    --color-accent-soft: color-mix(in oklch, var(--color-accent), white 85%);
  }
}
```

## Contrast

Always verify contrast for text and icons. Derived colors are not automatically accessible.

Avoid using opacity for text color because it compounds with parent/background colors. Prefer an explicit color token.

