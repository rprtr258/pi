---
name: html
description: Semantic, accessible, and modern HTML patterns. Use when writing, refactoring, or reviewing HTML, including HTML inside ERB or Svelte templates.
---

# HTML

Technical guidance for writing robust, semantic HTML using modern native elements over ARIA hacks, div-soup, and JavaScript workarounds.

## When to Use This Skill

- Writing, refactoring, or reviewing HTML in any template format (ERB, Svelte, plain HTML)
- Choosing between interactive elements (`dialog`, `popover`, `details`, `button`, `a`)
- Building or auditing accessible forms and input groups
- Replacing clickable divs, custom widgets, or JS-driven UI with native elements

## Core Rules

- Prefer native HTML elements over ARIA — if a native element carries the right semantics, use it and skip the role.
- Prefer `<button>` for actions and `<a>` for navigation; never attach click handlers to `<div>` or `<span>`.
- Prefer `<dialog>` for modal interactions requiring focus trapping; prefer `popover` for non-modal overlays (menus, tooltips, toasts).
- Prefer `<details>`/`<summary>` for disclosure widgets and accordions before reaching for JavaScript.
- Every `<input>`, `<select>`, and `<textarea>` must have an associated `<label>` via `for`/`id`.
- Use `<fieldset>` and `<legend>` to group related controls (radio groups, checkbox sets, address blocks).
- Maintain a logical heading hierarchy (`h1`→`h6`); never skip levels for visual sizing — use CSS instead.
- Use one `<main>` per page; use `<header>`, `<footer>`, `<nav>`, and `<aside>` as page landmarks.
- Always set `lang` on `<html>`; always set `alt` on `<img>` (empty string for decorative images).
- Use specific `input` types (`email`, `tel`, `url`, `number`, `search`) for mobile UX and native validation.
- Use native constraint attributes (`required`, `pattern`, `min`, `max`, `minlength`) before writing JS validation.
- Do not use `aria-label` when visible text is present; prefer `aria-labelledby` referencing that text.
- Use `aria-live="polite"` for dynamic content updates; `assertive` only for urgent errors.

## Workflow

1. Identify the HTML concern: document structure, semantics, forms, interactive patterns, media, ARIA, or browser support.
2. Read the matching reference before writing or changing markup.
3. Choose the most specific native element that fits the semantics and interaction model.
4. Validate: does every interactive element have a keyboard path? Does every form control have a visible label? Is the heading hierarchy intact?
5. Remove ARIA roles and attributes where a native element already carries them.

## References

Use the focused reference that matches the HTML concern:

| Topic       | Description                                                                          | Reference                                        |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| document    | `<html>`, `<head>`, charset, viewport, language, meta tags, and document boilerplate | [document](references/document.md)               |
| semantic    | Landmarks, sectioning, heading hierarchy, article, section, figure, time, search     | [semantic](references/semantic.md)               |
| forms       | Labels, fieldsets, input types, constraint validation, error states, autocomplete    | [forms](references/forms.md)                     |
| interactive | dialog, popover, details/summary, invoker commands, button vs. link decision table   | [interactive](references/interactive.md)         |
| media       | img, picture, video, audio, srcset, alt text, lazy loading, captions                 | [media](references/media.md)                     |
| aria        | First rule of ARIA, roles, states, live regions, labeling, focus management          | [aria](references/aria.md)                       |
| support     | Baseline checks, feature detection, progressive enhancement, and fallback patterns   | [browser-support](references/browser-support.md) |
