# CSS Container Queries Reference

## Decision Table

| Goal                                       | Use                                          | Notes                                         |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------- |
| Component changes based on available width | `container-type: inline-size` + `@container` | Default choice for reusable components        |
| Page shell changes based on viewport       | `@media`                                     | Keep viewport queries for app/page layout     |
| Query a specific ancestor                  | Named container                              | Use only when nearest container is not enough |
| Fluid sizing based on container            | Container query units (`cqi`, `cqw`, etc.)   | Use with `clamp()` for guardrails             |
| Progressive enhancement                    | `@supports (container-type: inline-size)`    | Keep usable default styles outside            |

## Basic Pattern

```css
.card-region {
  container-type: inline-size;
}

.card {
  display: grid;
  gap: 1rem;
}

@container (min-width: 32rem) {
  .card {
    grid-template-columns: 12rem minmax(0, 1fr);
  }
}
```

Put default narrow styles outside the query. Add wider enhancements inside.

## Named Containers

Use names when a component may be inside several containers and must query a specific one.

```css
.sidebar {
  container: sidebar / inline-size;
}

@container sidebar (min-width: 24rem) {
  .filter-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
```

## Container Units

Use `cqi` for inline-axis sizing. Guard with `clamp()`.

```css
.card-title {
  font-size: clamp(1rem, 6cqi, 1.75rem);
}
```

Common units: `cqw`, `cqh`, `cqi`, `cqb`, `cqmin`, `cqmax`.

## Good / Bad

**Good:** component adapts wherever it is placed.

```css
.project-card-list {
  container-type: inline-size;
}

@container (min-width: 40rem) {
  .project-card {
    grid-template-columns: 16rem minmax(0, 1fr);
  }
}
```

**Bad:** reusable card depends on viewport only.

```css
@media (min-width: 64rem) {
  .project-card {
    grid-template-columns: 16rem 1fr;
  }
}
```

## Pitfalls

- You cannot style the container itself from its own `@container` query; style descendants.
- `container-type: size` contains both axes and can affect layout more than `inline-size`; prefer `inline-size` unless height queries are required.
- Avoid sprinkling container declarations everywhere. Add containers at component boundaries.

