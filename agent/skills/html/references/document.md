# HTML Document Reference

## Decision Table

| Goal                         | Use                                                                    | Notes                                     |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| Declare character encoding   | `<meta charset="UTF-8">`                                               | Must be first in `<head>`                 |
| Responsive viewport          | `<meta name="viewport" content="width=device-width, initial-scale=1">` | Required for mobile                       |
| Document language            | `<html lang="en">`                                                     | Use BCP 47 subtags (`en`, `de`, `fr-CH`)  |
| Page title                   | `<title>`                                                              | Unique per page; describes content first  |
| Canonical URL                | `<link rel="canonical" href="...">`                                    | Prevents duplicate content indexing       |
| Open Graph / social metadata | `<meta property="og:...">`                                             | Add only where social sharing matters     |
| Favicon                      | `<link rel="icon" href="..." type="image/svg+xml">`                    | SVG preferred; PNG fallback for older iOS |
| Base URL for relative links  | `<base href="/">`                                                      | Use sparingly; affects all relative URLs  |

## Minimal Boilerplate

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page Title – Site Name</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <a href="#main" class="skip-link">Skip to main content</a>
    <header>...</header>
    <main id="main">...</main>
    <footer>...</footer>
  </body>
</html>
```

## Title Conventions

Describe the page content first, then the site name. Screen readers and browser tabs show the beginning of the title.

**Good:**

```html
<title>Edit Project – MapIt</title>
```

**Bad:**

```html
<title>MapIt – Edit Project</title>
```

## Skip Link

Always include a skip link as the first element in `<body>`. It allows keyboard users to bypass repeated navigation.

```html
<a href="#main" class="skip-link">Skip to main content</a>
```

Make it visible on focus:

```css
.skip-link {
  position: absolute;
  top: -100%;
}
.skip-link:focus {
  top: 0;
}
```

## Meta Description

Include a `<meta name="description">` when the page is publicly indexed. Keep it under 160 characters.

```html
<meta
  name="description"
  content="MapIt helps communities plan and vote on local projects."
/>
```
