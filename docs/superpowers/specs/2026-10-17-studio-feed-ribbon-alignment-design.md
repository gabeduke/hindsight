# Studio Feed Ribbon & Tape Swimlane Grid Alignment Design

- **Date:** 2026-10-17
- **Status:** Proposed
- **Author:** Antigravity

## Context & Motivation

In the Studio view (`shell.html`, `web/static/lib/rooms/studio.js`), the feed panel (`.studio-feed`) sits above the multitrack tape session (`#tape-body .tape-lanes`).
The intention of the Studio layout was that from 700px viewport width up, the feed's visual parts line up with the swimlanes beneath it:
- The VU meters (`.studio-feed > .vu-row`) sit over the track lane heads (`.tape-track > .tt-head`).
- The feed ribbon (`.studio-feed > .viz-wrap`) sits directly over the tape canvas swimlanes (`.tape-track > .tt-lane`).
- The left edge and right edge of the ribbon coincide exactly with the left and right edges of the tape lanes.

However, a grid column mismatch previously occurred:
1. `.tape-track` and `.tape-ruler-row` use a 2-column grid:
   ```css
   @media (min-width: 700px) {
     .tape-track, .tape-ruler-row { grid-template-columns: 160px 1fr; gap: 6px; }
   }
   @media (min-width: 1400px) {
     .tape-track, .tape-ruler-row { grid-template-columns: 200px 1fr; gap: 6px; }
   }
   ```
2. `.studio-feed` previously introduced an asymmetric 3-column template:
   ```css
   grid-template-columns: var(--lane-head) minmax(0, 1fr) auto;
   grid-template-areas: "head head head" "vu ribbon ribbon" "keys keys keys" "sel sel sel";
   ```
   With `grid-template-areas: "head head keys" "vu ribbon ribbon" "sel sel sel"` at 1100px.
   Because `ribbon` spanned two columns (`minmax(0, 1fr)` and `auto`), the presence and size of items in column 3 distorted column widths, causing horizontal misalignment between the ribbon and track lanes across responsive breakpoints.

## Solution

Unify `.studio-feed` onto the exact same 2-column template and column gap as `.tape-track` and `.tape-ruler-row`:

```css
.studio-feed { --lane-head: 160px; }
@media (min-width: 1400px) { .studio-feed { --lane-head: 200px; } }
@media (min-width: 700px) {
  .studio-feed {
    grid-template-columns: var(--lane-head) 1fr;
    grid-template-areas: "head head" "vu ribbon" "keys keys" "sel sel";
    column-gap: 6px; padding-inline: 0;
  }
  .studio-feed > .studio-feed-head, .studio-feed > .studio-keys, .studio-feed > .rb-sel { margin-inline: 14px; }
  .studio-feed > .vu-row { padding-left: 14px; gap: 6px; align-self: stretch; align-items: center; }
  .studio-feed > .vu-row .vu { flex: 1 1 0; width: auto; }
}
@media (min-width: 1100px) {
  .studio-feed { grid-template-areas: "head keys" "vu ribbon" "sel sel"; }
  .studio-feed > .studio-feed-head { margin-right: 0; }
  .studio-feed > .studio-keys { margin-left: 0; justify-content: flex-end; }
}
```

### Visual Characteristics

- **Column 1 (`var(--lane-head)`):**
  - `< 1400px`: exactly 160px wide (matching `.tt-head` 160px).
  - `>= 1400px`: exactly 200px wide (matching `.tt-head` 200px).
  - Contains `.vu-row` (VU meters), padded with 14px on the left to align with panel chrome.
- **Column 2 (`1fr`):**
  - Contains `.viz-wrap` (feed ribbon). Left boundary begins at `var(--lane-head) + 6px` gap, exactly like `.tt-lane`.
  - Right boundary extends to the right edge of the track lanes.
  - On viewports >= 1100px, `.studio-keys` sits cleanly on top in row 1, col 2 (`head keys`), right-aligned to match the "now" playback point of the ribbon.
- **Service Worker Cache:**
  - Bumps `CACHE` in `web/static/sw.js` to `hindsight-shell-v142`.
