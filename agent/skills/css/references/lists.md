# CSS Lists Reference

## Decision Table

| Goal                                   | Use                                               | Notes                                                          |
| -------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Preserve semantic list behavior        | Native `<ul>`, `<ol>`, `<li>`                     | Prefer real lists over divs for list content                   |
| Change bullet type or numbering system | `list-style` / `list-style-type`                  | `disc`, `circle`, `square`, `decimal`, etc.                    |
| Use emoji, unicode, or text as bullet  | `list-style-type: "👉 "`                          | Quoted string value; test Safari behavior                      |
| Change marker color or font            | `li::marker`                                      | Only limited properties are supported                          |
| Custom symbol sequence                 | `@counter-style`                                  | Baseline 2023; better than `symbols()`                         |
| Modify an existing numbering system    | `extends` in `@counter-style`                     | Inherit decimal etc. and only override suffix/prefix           |
| Full control over marker layout        | `li::before` + `list-style: none` + `role="list"` | Required for large, positioned, or complex markers             |
| Number headings/sections               | CSS counters                                      | Counters work on non-list elements                             |
| Change ordered-list start/order        | HTML `start`, `reversed`, `value`                 | Prefer HTML attributes when the numbering is content semantics |

## Core Rules

- Keep native list semantics unless there is a strong reason not to.
- Use `::marker` for simple marker color/font changes.
- Use `@counter-style` for cross-browser custom marker content.
- Use `::before` only when marker layout needs full CSS control.
- If removing native markers with `list-style: none`, add `role="list"` for Safari accessibility.
- Prefer logical spacing (`padding-inline-start`, `margin-block`) over physical spacing.

## Baseline Spacing

Indent lists with logical properties so markers work in different writing modes.

Indent `ul` by one line height so the bullet sits in a square of whitespace:

```css
ul {
  padding-inline-start: 1lh;
}
```

Ordered lists that go into double figures need more room:

```css
ol {
  padding-inline-start: 2lh;
}
```

For nested lists, control vertical rhythm explicitly:

```css
li > :is(ul, ol) {
  margin-block-start: 0.5em;
}

li + li {
  margin-block-start: 0.375em;
}
```

## Native `list-style`

Use native markers for simple bullets and numbering.

```css
ul.checklist {
  list-style-type: "✓ ";
}

ol.steps {
  list-style-type: decimal-leading-zero;
}
```

Common values include `disc`, `circle`, `square`, `decimal`, `decimal-leading-zero`, `lower-alpha`, `upper-alpha`, `lower-roman`, and `upper-roman`.

## Styling `::marker`

Only a limited set of properties work reliably on `::marker`: mainly `color`, `font-*`, `white-space`, and `content` in some browsers.

```css
ol li::marker {
  color: gray;
  font-family: sans-serif;
  font-size: 0.8em;
  font-variant-numeric: tabular-nums;
}
```

`content` on `::marker` works in Chrome and Firefox but **not Safari**. Use `@counter-style` or `::before` for cross-browser custom content.

**Good:** simple visual marker styling.

```css
.task-list li::marker {
  color: var(--color-accent);
  font-weight: 700;
}
```

**Bad:** expecting marker layout properties to work.

```css
.task-list li::marker {
  display: grid;
  width: 2rem;
  margin-inline-end: 1rem;
}
```

## `@counter-style`

Baseline 2023. Use instead of `symbols()` for custom marker systems.

```css
@counter-style --footnotes {
  system: symbolic;
  symbols: "*" "†" "‡" "§";
  suffix: " ";
}

@counter-style --moons {
  system: cyclic; /* loops when symbols run out */
  symbols: 🌑 🌓 🌕 🌗;
  suffix: " ";
  speak-as: bullets; /* prevents VoiceOver reading "first quarter moon" */
}

ol.footnotes {
  list-style: --footnotes;
}
```

Extend an existing system to change only the suffix:

```css
@counter-style --decimalparen {
  system: extends decimal;
  suffix: ") ";
}

ol.parenthesized {
  list-style: --decimalparen;
}
```

Useful descriptors: `system`, `symbols`, `suffix`, `prefix`, `negative`, `pad`, `range`, `speak-as`, `fallback`.

Use `speak-as` when custom symbols would be noisy or misleading to assistive technology.

## Custom `::before` Markers With Full Control

Use when markers need to be large, absolutely positioned, aligned to custom columns, or styled beyond what `::marker` allows.

1. Remove native marker and restore accessibility:

```html
<ol class="timeline" role="list">
  <li>Item</li>
</ol>
```

```css
.timeline {
  list-style: none;
  padding-inline-start: 0;
}
```

2. Build the marker with `::before`:

```css
.timeline li {
  counter-increment: list-item;
  display: grid;
  grid-template-columns: 4ch minmax(0, 1fr);
  gap: 1ch;
}

.timeline li::before {
  justify-self: end;
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  content: counter(list-item) ".";
}
```

Alternative hanging-marker pattern:

```css
ol[role="list"] li::before {
  display: inline-block;
  width: 4ch;
  padding-inline-end: 1ch;
  margin-inline-start: -5ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  content: counter(list-item) ".";
}
```

For nested counters, use `counters()`:

```css
.outline li::before {
  content: counters(list-item, ".") ":";
}
```

## Custom Counters

Use named counters when the numbering does not map to the native `list-item` counter.

```css
ol[role="list"].mylist {
  counter-reset: --myList 3; /* start at 3 */
}

ol[role="list"].mylist li {
  counter-increment: --myList 2; /* step by 2 */
}

ol[role="list"].mylist li::before {
  content: counter(--myList) ". ";
}
```

Counters work on any element, not just lists:

```css
.article {
  counter-reset: --h2;
}

.article h2 {
  counter-increment: --h2;
}

.article h2::before {
  content: counter(--h2) ". ";
}
```

## HTML Attributes No CSS Needed

Use HTML when the numbering is part of the document semantics.

```html
<ol start="42">
  <!-- start at 42 -->
</ol>

<ol reversed start="44">
  <!-- count down from 44 -->
</ol>

<ol>
  <li value="42">Override this item's value</li>
</ol>
```

## Accessibility Notes

- Native list semantics are best. Do not replace lists with generic elements for styling convenience.
- Safari may drop list semantics when `list-style: none` is used; add `role="list"` to the list element.
- Custom `::before` markers may be announced inconsistently. Keep marker text decorative unless it conveys necessary information elsewhere.
- Use `speak-as` in `@counter-style` for symbolic systems where supported.

