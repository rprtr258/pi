# CSS Browser Support Reference

## Rules

- Check support before relying on newer CSS in production-critical paths.
- Prefer progressive enhancement: usable default first, enhanced feature inside `@supports`.
- Use Baseline/MDN compatibility data for general support checks.
- Avoid user-agent sniffing for CSS feature support.
- Newer features are acceptable when unsupported browsers still get a usable layout/state.

## `@supports`

```css
.card {
  display: block;
}

@supports (container-type: inline-size) {
  .card-list {
    container-type: inline-size;
  }

  @container (min-width: 36rem) {
    .card {
      display: grid;
      grid-template-columns: 12rem 1fr;
    }
  }
}
```

## Selector Support

```css
.field.is-invalid {
  border-color: var(--color-danger);
}

@supports selector(.field:has(:invalid)) {
  .field.is-invalid {
    border-color: initial;
  }

  .field:has(:invalid) {
    border-color: var(--color-danger);
  }
}
```

Use `@supports selector(...)` for selector features such as `:has()`.

## Color Support

```css
:root {
  --accent: #315eea;
}

@supports (color: oklch(60% 0.2 250)) {
  :root {
    --accent: oklch(62% 0.18 250);
  }
}
```

## Support Checklist

Before finishing CSS with modern features:

- Is the default CSS usable without the new feature?
- Is the feature guarded with `@supports` when support is uncertain?
- Does the unsupported path preserve content access and core actions?
- Are motion enhancements disabled or reduced with `prefers-reduced-motion`?
- Did you check MDN/Baseline/caniuse for required target browsers?

