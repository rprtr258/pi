# HTML Media Reference

## Decision Table

| Goal                                | Use                                       | Notes                                           |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Single image, no art direction      | `<img>`                                   | Always include `alt`                            |
| Multiple formats or art direction   | `<picture>` + `<source>`                  | Fallback `<img>` inside is required             |
| Responsive image sizes              | `srcset` + `sizes` on `<img>`             | Let the browser pick the best file              |
| Decorative image (no meaning)       | `alt=""`                                  | Empty string, not missing attribute             |
| Icon with adjacent visible label    | `<img alt="">` or inline SVG              | Label text carries the meaning                  |
| Icon without visible label          | `aria-label` on the parent button         | Or `alt="Icon description"` on the img          |
| Autoplay video (ambient/decorative) | `<video autoplay muted loop playsinline>` | Must be muted; provide a pause mechanism        |
| Video with audio content            | `<video>` + `<track kind="captions">`     | Captions required for accessibility             |
| Lazy load below-fold images         | `loading="lazy"`                          | Do not apply to above-fold or LCP images        |
| Hint at aspect ratio before load    | `width` + `height` attributes             | Prevents layout shift; use CSS for display size |

## `<img>` Basics

Always include `alt`. Always include `width` and `height` to prevent Cumulative Layout Shift.

```html
<img
  src="riverside-park.jpg"
  alt="Aerial view of the proposed Riverside Park site"
  width="800"
  height="450"
  loading="lazy"
/>
```

For images above the fold or the Largest Contentful Paint image, omit `loading="lazy"` and add `fetchpriority="high"`:

```html
<img
  src="hero.jpg"
  alt="Community members planting trees in Riverside Park"
  width="1200"
  height="600"
  fetchpriority="high"
/>
```

## Decorative Images

Use `alt=""` (not missing) for purely decorative images. The empty string tells screen readers to skip the element.

**Good:**

```html
<img src="divider-wave.svg" alt="" />
```

**Bad:**

```html
<img src="divider-wave.svg" />
<!-- missing alt: screen reader reads filename -->
<img src="divider-wave.svg" alt="wave" />
<!-- unnecessary noise for screen readers -->
```

## `<picture>` for Format and Art Direction

Provide modern formats with a fallback:

```html
<picture>
  <source srcset="map.avif" type="image/avif" />
  <source srcset="map.webp" type="image/webp" />
  <img
    src="map.jpg"
    alt="Map of proposed park boundaries"
    width="800"
    height="450"
  />
</picture>
```

Art direction (different crops at different breakpoints):

```html
<picture>
  <source media="(min-width: 60rem)" srcset="hero-wide.jpg" />
  <source media="(min-width: 30rem)" srcset="hero-medium.jpg" />
  <img
    src="hero-small.jpg"
    alt="Participants at the community planning session"
    width="600"
    height="400"
  />
</picture>
```

## Responsive Images with `srcset`

```html
<img
  src="park-800.jpg"
  srcset="park-400.jpg 400w, park-800.jpg 800w, park-1600.jpg 1600w"
  sizes="(min-width: 60rem) 50vw, 100vw"
  alt="Riverside Park on a sunny day"
  width="800"
  height="450"
/>
```

## Video

For video with meaningful audio, always include captions:

```html
<video controls width="800" height="450">
  <source src="intro.mp4" type="video/mp4" />
  <track
    kind="captions"
    src="intro.en.vtt"
    srclang="en"
    label="English"
    default
  />
  <p>
    Your browser does not support video.
    <a href="intro.mp4">Download the video</a>.
  </p>
</video>
```

For ambient/decorative video:

```html
<video autoplay muted loop playsinline aria-hidden="true">
  <source src="background.mp4" type="video/mp4" />
</video>
```

- `muted` is required for autoplay to work in most browsers.
- `playsinline` prevents iOS from going fullscreen.
- `aria-hidden="true"` hides a purely decorative video from screen readers.
