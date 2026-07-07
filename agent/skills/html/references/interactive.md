# HTML Interactive Patterns Reference

## Decision Table

| Goal                                      | Use                                                          | Notes                                          |
| ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| Modal requiring focus trap and page inert | `<dialog>` + `showModal()`                                   | Esc closes; backdrop blocks background         |
| Non-modal overlay: menu, tooltip, toast   | `popover` attribute                                          | Light-dismiss; no focus trap; no inherent role |
| Disclosure widget / accordion             | `<details>` + `<summary>`                                    | Native keyboard support; no JS needed          |
| Trigger action on current page            | `<button>`                                                   | Not `<a>`, not `<div>`                         |
| Navigate to a URL                         | `<a href="...">`                                             | Not `<button>`                                 |
| Open dialog declaratively                 | `commandfor` + `command="show-modal"`                        | Invoker Commands API; Baseline 2025            |
| Toggle popover declaratively              | `popovertarget` or `commandfor` + `command="toggle-popover"` | No JS needed                                   |
| Exclusive accordion (one open at a time)  | `<details name="group">`                                     | Name groups details elements; browser manages  |

## `<dialog>` — Modal

Use `<dialog>` when the user must respond before continuing (confirmation, form, alert).

```html
<button commandfor="confirm-dialog" command="show-modal">Delete project</button>

<dialog id="confirm-dialog" aria-labelledby="confirm-title">
  <h2 id="confirm-title">Delete project?</h2>
  <p>This action cannot be undone.</p>
  <form method="dialog">
    <button value="cancel" autofocus>Cancel</button>
    <button value="confirm">Delete</button>
  </form>
</dialog>
```

- `aria-labelledby` points to the heading so screen readers announce the title on open.
- `autofocus` on the safe action (Cancel) prevents accidental destructive clicks.
- `<form method="dialog">` closes the dialog on submit and sets `dialog.returnValue` to the button's `value` — no JS needed.
- Use `::backdrop` to style the dimmed background.

When JS control is required:

```js
const dialog = document.getElementById("confirm-dialog");
dialog.showModal(); // opens as modal
dialog.close("confirm"); // closes with returnValue
```

## `popover` — Non-Modal Overlay

Use `popover` for UI that appears above the page without blocking interaction: menus, tooltips, toasts, command palettes.

```html
<button popovertarget="user-menu">Account</button>

<div id="user-menu" popover role="menu">
  <a href="/profile" role="menuitem">Profile</a>
  <a href="/settings" role="menuitem">Settings</a>
</div>
```

- `popover` adds top-layer behavior and light-dismiss but **no semantic role** — always add an appropriate `role`.
- `popover="auto"` (default): closes on click-outside or Esc; only one open at a time in the same stack.
- `popover="manual"`: stays open until explicitly closed; useful for persistent toasts or stacked layers.

Common roles for popover content:

| Content type | Role to add      |
| ------------ | ---------------- |
| Menu         | `role="menu"`    |
| Tooltip      | `role="tooltip"` |
| Dialog-like  | `role="dialog"`  |
| Listbox      | `role="listbox"` |

## Invoker Commands

Prefer declarative `commandfor`/`command` over JavaScript event listeners for common open/close actions.

```html
<!-- Open as modal -->
<button commandfor="my-dialog" command="show-modal">Open</button>

<!-- Toggle popover -->
<button commandfor="my-popover" command="toggle-popover">Toggle</button>

<!-- Close from inside -->
<button commandfor="my-dialog" command="close">Close</button>
```

Fall back to `popovertarget` when Invoker Commands are not yet supported:

```html
<button popovertarget="my-popover">Toggle</button>
```

## `<details>` / `<summary>` — Disclosure

Use for accordions, FAQ items, and show-more patterns without any JavaScript.

```html
<details>
  <summary>What happens after I submit?</summary>
  <p>
    Your idea will appear on the project map and community members can vote on
    it.
  </p>
</details>
```

Exclusive accordion using `name`:

```html
<details name="faq">
  <summary>How do I vote?</summary>
  <p>...</p>
</details>
<details name="faq">
  <summary>Who can submit ideas?</summary>
  <p>...</p>
</details>
```

Do not place interactive elements (`<a>`, `<button>`) inside `<summary>` — the entire summary is already a toggle button.

If the summary acts as a section title, a heading is permitted inside it:

```html
<details>
  <summary><h3>Submission guidelines</h3></summary>
  <p>...</p>
</details>
```

## `<button>` vs `<a>`

| Use case                       | Element                   |
| ------------------------------ | ------------------------- |
| Submit a form                  | `<button type="submit">`  |
| Trigger an action (JS, dialog) | `<button type="button">`  |
| Navigate to a URL              | `<a href="...">`          |
| Download a file                | `<a href="..." download>` |

**Good:**

```html
<button type="button" id="open-map">Show on map</button>
<a href="/projects/riverside">View project</a>
```

**Bad:**

```html
<div onclick="openMap()">Show on map</div>
<a href="#" onclick="navigate()">View project</a>
```
