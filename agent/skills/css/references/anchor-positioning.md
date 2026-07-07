# CSS Anchor Positioning Reference

## Use When

- Positioning tooltips, popovers, menus, callouts, badges, or teaching UI relative to a trigger.
- The relationship is visual positioning, not document-flow layout.
- Browser support is acceptable or a fallback exists.

## Basic Pattern

```css
.trigger {
  anchor-name: --menu-trigger;
}

.menu {
  position: absolute;
  position-anchor: --menu-trigger;
  inset-block-start: anchor(block-end);
  inset-inline-start: anchor(inline-start);
}
```

## Fallback Pattern

Keep usable conventional positioning first, enhance with anchor positioning inside `@supports`.

```css
.menu-wrapper {
  position: relative;
}

.menu {
  position: absolute;
  inset-block-start: 100%;
  inset-inline-start: 0;
}

@supports (position-anchor: --anchor) {
  .menu-wrapper {
    position: static;
  }

  .menu-button {
    anchor-name: --menu-button;
  }

  .menu {
    position-anchor: --menu-button;
    inset-block-start: anchor(block-end);
    inset-inline-start: anchor(inline-start);
  }
}
```

## Rules

- Do not use anchor positioning for normal layout. Use Grid/Flexbox/document flow.
- Prefer HTML popover semantics for popover behavior; use anchor positioning for placement.
- Provide collision/fallback behavior when UI may hit viewport edges.
- Test keyboard and screen-reader behavior separately from visual position.

