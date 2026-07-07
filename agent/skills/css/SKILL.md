---
name: css
description: Plain CSS patterns, properties, browser quirks, and modern CSS feature guidance. Use when writing, refactoring, debugging, or reviewing CSS, including CSS inside components or templates.
---

# CSS

Technical guidance for writing robust plain CSS and choosing modern native CSS features over older hacks.

## When to Use This Skill

- Writing, refactoring, debugging, or reviewing CSS
- Choosing layout, responsive, selector, cascade, color, motion, or browser-support patterns
- Replacing JavaScript/class toggling, utility sprawl, or legacy layout hacks with native CSS

## Core Rules

- Prefer modern native CSS over JavaScript/class toggling when state is representable with selectors, queries, attributes, or HTML semantics.
- Prefer container queries for reusable component responsiveness; use media queries for viewport-level page/app layout.
- Prefer logical properties (`margin-inline`, `padding-block`, `inline-size`) unless physical direction is intentional.
- Prefer Grid for two-dimensional layout and Flexbox for one-dimensional distribution.
- Prefer intrinsic sizing (`min()`, `max()`, `clamp()`, `minmax()`, `fit-content`) over magic widths and breakpoint-heavy CSS.
- Prefer `:has()` for parent/sibling/state styling, but keep selectors narrow and scoped.
- Prefer cascade layers and low-specificity selectors over specificity escalation, selector soup, or `!important`.
- Prefer custom properties for themeable values and component APIs.
- Prefer `aspect-ratio` over padding hacks.
- Prefer `color-mix()`, `oklch()`, and relative color syntax for derived colors when browser support permits.
- Use `@supports` for progressive enhancement around newer or partially supported features.
- Prefer `@apply` to manually translating Tailwind utilities into CSS values when using Tailwind in the project.

## Workflow

1. Identify the CSS concern: layout, responsive behavior, cascade, selectors, color, motion, forms, lists, or support.
2. Read the matching reference(s) before writing or changing CSS.
3. Choose the simplest native CSS feature that fits the state/layout/support constraints.
4. Validate in relevant viewport sizes and component contexts; check reduced-motion and browser support for newer features.
5. Remove obsolete hacks, duplicated utilities, and unnecessary JavaScript state once CSS handles the behavior.

## References

Use the focused reference that matches the CSS concern:

| Topic                 | Description                                                                                    | Reference                                              |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| layout                | Grid, Flexbox, subgrid, layout choice, and alignment patterns                                  | [layout](references/layout.md)                         |
| responsive components | Container queries, container units, component breakpoints, and viewport media query boundaries | [container-queries](references/container-queries.md)   |
| cascade               | Cascade layers, specificity control, selector shape, and `!important` avoidance                | [cascade-layers](references/cascade-layers.md)         |
| selectors             | `:has()`, `:is()`, `:where()`, `:not()`, parent/sibling state, and scoped selector patterns    | [selectors](references/selectors.md)                   |
| sizing                | Intrinsic sizing, fluid type/space, `clamp()`, `minmax()`, `fit-content`, and `aspect-ratio`   | [intrinsic-sizing](references/intrinsic-sizing.md)     |
| logical properties    | Writing-mode-safe spacing, sizing, borders, and positioning                                    | [logical-properties](references/logical-properties.md) |
| custom properties     | CSS variables as design tokens, component APIs, inheritance, and fallbacks                     | [custom-properties](references/custom-properties.md)   |
| colors                | OKLCH, `color-mix()`, relative colors, contrast, and progressive enhancement                   | [colors](references/colors.md)                         |
| motion                | Transitions, transforms, `@starting-style`, scroll-driven animation, and reduced motion        | [motion](references/motion.md)                         |
| anchors and popovers  | CSS anchor positioning, popovers, tooltips, menus, and fallbacks                               | [anchor-positioning](references/anchor-positioning.md) |
| forms                 | Native form states, validation selectors, accent colors, field layout, and accessible styling  | [forms](references/forms.md)                           |
| lists                 | Styling bullets, numbering, markers, counters, and custom `::before` marker patterns           | [lists](references/lists.md)                           |
| support               | `@supports`, Baseline checks, browser compatibility, and progressive enhancement               | [browser-support](references/browser-support.md)       |
