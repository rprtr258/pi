# HTML Browser Support Reference

## Rules

- Check Baseline status before using newer HTML elements or attributes in production.
- Prefer progressive enhancement: functional markup first, enhanced feature layered on top.
- Detect feature support in JavaScript when behaviour depends on the feature being present.
- Avoid polyfilling native HTML elements; prefer a simpler fallback instead.

## Baseline Status (as of 2026)

| Feature                            | Baseline status  | Notes                                           |
| ---------------------------------- | ---------------- | ----------------------------------------------- |
| `<dialog>`                         | Widely Available | Use freely                                      |
| `popover` attribute                | Widely Available | Use freely; add `role` manually                 |
| `<details name="...">` (exclusive) | Newly Available  | Guard with JS feature detection if needed       |
| `<search>`                         | Newly Available  | Safe to use; `<form role="search">` as fallback |
| Invoker Commands (`commandfor`)    | Newly Available  | Fallback to `popovertarget` or JS               |
| `fetchpriority` on `<img>`         | Widely Available | Use freely for LCP images                       |
| `loading="lazy"` on `<img>`        | Widely Available | Use freely                                      |

## Feature Detection

Detect `<dialog>` support:

```js
if (typeof HTMLDialogElement === "undefined") {
  // dialog not supported; show fallback or load a polyfill
}
```

Detect `popover` support:

```js
if (!HTMLElement.prototype.hasOwnProperty("popover")) {
  // popover not supported; fall back to JS-managed visibility
}
```

Detect Invoker Commands:

```js
if (!("command" in HTMLButtonElement.prototype)) {
  // commandfor/command not supported; wire up click listeners manually
}
```

## Progressive Enhancement Patterns

### `<dialog>` with fallback

```html
<dialog id="confirm">
  <form method="dialog">
    <p>Delete this project?</p>
    <button value="cancel">Cancel</button>
    <button value="confirm">Delete</button>
  </form>
</dialog>
```

```js
const dialog = document.getElementById("confirm");
if (dialog.showModal) {
  dialog.showModal();
} else {
  // Fallback: inline confirmation or alert()
  if (confirm("Delete this project?")) handleDelete();
}
```

### Invoker Commands with `popovertarget` fallback

```html
<!-- Preferred: Invoker Commands -->
<button commandfor="menu" command="toggle-popover">Menu</button>

<!-- Fallback via popovertarget (Widely Available) -->
<button popovertarget="menu">Menu</button>

<div id="menu" popover role="menu">...</div>
```

Use Invoker Commands when you need `command="show-modal"` for dialogs; `popovertarget` covers popover toggling in all Widely Available browsers.

### `<search>` with fallback

```html
<search>
  <label for="q">Search</label>
  <input type="search" id="q" name="q" />
  <button type="submit">Go</button>
</search>
```

`<search>` degrades gracefully in older browsers — it renders as an unstyled block element. The `role="search"` landmark will be missing in those browsers, but the form remains functional. Use `<form role="search">` if the landmark is critical.

## Support Checklist

Before shipping markup with newer HTML features:

- Is the base experience usable without the new feature?
- Is JavaScript feature detection in place for behaviour-critical features?
- Does the fallback preserve content access and primary actions?
- Have you checked MDN Baseline or caniuse for required browser targets?
- Are captions/alt text/labels present regardless of feature support?
