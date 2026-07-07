# HTML Semantic Reference

## Decision Table

| Goal                                     | Use                         | Notes                                           |
| ---------------------------------------- | --------------------------- | ----------------------------------------------- |
| Primary content region                   | `<main>`                    | One per page                                    |
| Site header / masthead                   | `<header>`                  | Can also be used inside `<article>`/`<section>` |
| Site footer                              | `<footer>`                  | Can also be used inside `<article>`/`<section>` |
| Navigation landmark                      | `<nav>`                     | Only for major navigation sets                  |
| Complementary content                    | `<aside>`                   | Related but not essential to main content       |
| Self-contained content (blog post, card) | `<article>`                 | Makes sense when pulled out of context          |
| Thematic grouping with a heading         | `<section>`                 | Must include a heading; otherwise use `<div>`   |
| Search controls                          | `<search>`                  | Provides `search` landmark role automatically   |
| Machine-readable date/time               | `<time datetime="…">`       | Use ISO 8601 format in `datetime`               |
| Image with caption                       | `<figure>` + `<figcaption>` | Also suitable for code blocks and charts        |
| Inline emphasis (importance)             | `<strong>`                  | Not bold styling; use CSS for that              |
| Inline stress emphasis                   | `<em>`                      | Not italic styling; use CSS for that            |
| Abbreviation                             | `<abbr title="…">`          | Include full expansion in `title`               |

## Landmark Regions

Use landmarks to let screen reader users jump directly to page regions.

```html
<body>
  <header>
    <nav aria-label="Primary">...</nav>
  </header>
  <main id="main">
    <h1>Page Title</h1>
    ...
  </main>
  <aside aria-label="Related links">...</aside>
  <footer>...</footer>
</body>
```

When multiple `<nav>` elements exist, label each with `aria-label` or `aria-labelledby` so they are distinguishable in landmark menus.

## Heading Hierarchy

Never skip heading levels. Use CSS for visual size.

**Good:**

```html
<h1>Projects</h1>
<h2>Active</h2>
<h3>Riverside Park Renovation</h3>
<h2>Archived</h2>
```

**Bad:**

```html
<h1>Projects</h1>
<h3>Riverside Park Renovation</h3>
<!-- skipped h2 -->
```

## `<article>` vs `<section>`

- `<article>`: self-contained, syndicatable — blog post, comment, card, feed item.
- `<section>`: thematic chunk of a page — must have a heading or it is just `<div>`.

```html
<!-- article: makes sense extracted from the page -->
<article>
  <h2><a href="/projects/riverside">Riverside Park</a></h2>
  <p>Community-led green space renovation.</p>
</article>

<!-- section: groups related content on the page -->
<section>
  <h2>How It Works</h2>
  <p>...</p>
</section>
```

## `<time>`

Always include `datetime` for machine-readable values.

```html
<time datetime="2026-04-27">April 27, 2026</time>
<time datetime="PT2H30M">2 hours 30 minutes</time>
```

## `<search>`

Use `<search>` to wrap search form controls. It provides the `search` landmark role without needing `role="search"` on a `<form>`.

```html
<search>
  <label for="q">Search projects</label>
  <input type="search" id="q" name="q" />
  <button type="submit">Search</button>
</search>
```

## `<figure>` and `<figcaption>`

```html
<figure>
  <img src="map.png" alt="Map showing proposed park boundaries" />
  <figcaption>
    Proposed boundaries for the Riverside Park renovation.
  </figcaption>
</figure>
```
