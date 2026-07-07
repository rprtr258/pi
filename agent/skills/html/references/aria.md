# HTML ARIA Reference

## First Rule of ARIA

> If you can use a native HTML element or attribute with the required semantics and behavior, use it instead of repurposing an element and adding ARIA.

Only reach for ARIA when:

- No native element covers the required role or state.
- The native element cannot be used due to template or styling constraints.
- A custom widget requires richer state communication than HTML alone provides.

## Decision Table

| Goal                              | Prefer                       | Avoid                                |
| --------------------------------- | ---------------------------- | ------------------------------------ |
| Clickable action                  | `<button>`                   | `<div role="button">`                |
| Navigation                        | `<a href="...">`             | `<span role="link">`                 |
| Required field                    | `<input required>`           | `aria-required="true"` alone         |
| Invalid field                     | `aria-invalid="true"`        | Only a CSS class                     |
| Label from visible text           | `aria-labelledby="id"`       | `aria-label` repeating visible text  |
| Label when no visible text exists | `aria-label="..."`           | Omitting a label entirely            |
| Describe with supplementary text  | `aria-describedby="id"`      | Inline title attribute only          |
| Announce dynamic content          | `aria-live="polite"`         | `aria-live="assertive"` (use rarely) |
| Hide from assistive technology    | `aria-hidden="true"`         | `visibility: hidden` alone           |
| Expanded/collapsed state          | `aria-expanded="true/false"` | Only CSS class                       |

## Labeling Hierarchy

Prefer the most direct labeling mechanism available:

1. Native `<label for="id">` → programmatic label
2. `aria-labelledby="id"` → references existing visible text
3. `aria-label="..."` → only when no visible text exists or wrapping is impractical

**Good:**

```html
<!-- Native label -->
<label for="project-name">Project name</label>
<input id="project-name" type="text" />

<!-- aria-labelledby referencing existing heading -->
<section aria-labelledby="ideas-heading">
  <h2 id="ideas-heading">Community ideas</h2>
  ...
</section>
```

**Bad:**

```html
<!-- aria-label duplicating visible text -->
<button aria-label="Submit">Submit</button>

<!-- Unlabelled input -->
<input type="text" placeholder="Project name" />
```

## Live Regions

Use `aria-live` for content that updates without a page reload.

```html
<!-- Low-priority: status messages, search results count -->
<p aria-live="polite" aria-atomic="true">Showing 12 results</p>

<!-- High-priority: only for urgent errors the user must act on -->
<p aria-live="assertive" role="alert">Session expired. Please log in again.</p>
```

- `aria-atomic="true"`: announces the full region on any change, not just the changed node.
- `role="alert"` is shorthand for `aria-live="assertive"` + `aria-atomic="true"`.
- `role="status"` is shorthand for `aria-live="polite"` + `aria-atomic="true"`.
- Inject live regions into the DOM early; content added dynamically after the element is announced.

## Focus Management

Browsers handle focus automatically for `<dialog showModal()>` and `popover`. For custom patterns:

- Move focus to the first interactive element inside a newly opened panel.
- Return focus to the trigger element when the panel closes.
- Use `autofocus` on the most logical first element in a dialog.

```html
<dialog id="edit-dialog">
  <h2>Edit idea</h2>
  <form method="dialog">
    <label for="idea-title">Title</label>
    <input id="idea-title" type="text" autofocus />
    <button type="submit">Save</button>
  </form>
</dialog>
```

## Common Custom Widget Roles

Only use these when no native element works:

| Widget           | Role                              | Required states / properties                              |
| ---------------- | --------------------------------- | --------------------------------------------------------- |
| Tab bar          | `role="tablist"`                  | Tabs: `role="tab"`, `aria-selected`, `aria-controls`      |
| Tab panel        | `role="tabpanel"`                 | `aria-labelledby` pointing to its tab                     |
| Combobox         | `role="combobox"`                 | `aria-expanded`, `aria-controls`, `aria-activedescendant` |
| Tree / tree item | `role="tree"` / `role="treeitem"` | `aria-expanded`, `aria-level`                             |
| Slider           | `role="slider"`                   | `aria-valuenow`, `aria-valuemin`, `aria-valuemax`         |

## `aria-hidden`

Use `aria-hidden="true"` to remove decorative or redundant elements from the accessibility tree.

```html
<!-- Decorative icon next to a labelled button -->
<button>
  <svg aria-hidden="true" focusable="false">...</svg>
  Save project
</button>
```

Never apply `aria-hidden="true"` to a focusable element — it hides the element from screen readers while leaving it reachable by keyboard, creating a confusing experience.
