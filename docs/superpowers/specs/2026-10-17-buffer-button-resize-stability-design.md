# Buffer Button Resize Stability Design

**Date:** 2026-10-17 · **Status:** proposed · **Repo:** `hindsight`

## Context & Problem

In the Studio view, `Buffer ▴` / `Buffer ▾` (`.icon-btn.buffer-reopen`) toggles the buffer bench open and closed. In PR #142, the feed source selector (`[main | ch1 | ch2 | aux]`) was added to `.buffer-grab`, and `Buffer ▴ / ▾` was made to stay visible at all times when grabbed buffer audio exists.

However, when resizing the browser window, `Buffer ▴ / ▾` gets visually overwritten by other buttons (`30s` in `#dur-seg` or `Flag now` in `#mark-btn`), or jumps abruptly between rows:
1. **Dynamic DOM reparenting in `buffer.js`:**
   `buffer.js` listened to `matchMedia('(min-width: 1100px)')` and dynamically moved `.buffer-grab` between `.studio-feed-head` (`head.append(grabRow)`) when width >= 1100px, and `.studio-keys` (`keysRow.prepend(grabRow)`) when width < 1100px.
2. **Grid collision in `styles.css` at `min-width: 1100px`:**
   `styles.css` specified `grid-template-areas: "head head keys" "vu ribbon ribbon" "sel sel sel"` at `min-width: 1100px`.
   - `head` spanned columns 1 & 2.
   - `keys` sat in column 3 (`auto` width).
   - With the expanded `.buffer-grab` toolbar inside `head`, `head`'s content width exceeded columns 1 & 2 on screen widths between 1100px and 1400px.
   - Because `head` had no clipping and `.studio-keys` came after `head` in DOM order, `.studio-keys` was painted directly on top of the right edge of `head`, causing `dur-seg` (`30s`) and `mark-btn` (`Flag now`) to overwrite `Buffer ▴ / ▾`.
3. **Row jumping across 1100px:**
   Resizing across 1100px caused the entire grab toolbar to jump between Row 1 and Row 3.
4. **Squeezing at 700px - 1099px:**
   Below 1100px, `.studio-keys` had `flex-wrap: nowrap`, squeezing `.buffer-grab` and `#dur-seg` against each other when width was less than ~950px.

## Design

1. **Keep `.buffer-grab` stably mounted in `.studio-keys` at all screen widths:**
   - Eliminate dynamic reparenting (`place()`) in `web/static/lib/buffer/buffer.js`.
   - `.buffer-grab` stays inside `.studio-keys` where it is prepended on mount.
   - The buffer toggle button (`Buffer ▴` / `Buffer ▾`) stays permanently anchored in the exact same spot on the toolbar directly above the `#buffer` panel, never jumping rows.

2. **Unified 3-row grid layout for `.studio-feed`:**
   - Remove `@media (min-width: 1100px) { .studio-feed { grid-template-areas: "head head keys" ... } }`.
   - Maintain the clean, robust grid layout across all tablet and desktop viewports (`min-width: 700px`):
     - **Row 1:** `"head head head"` — Feed heading, stats, and Phone button span full width.
     - **Row 2:** `"vu ribbon ribbon"` — VU needles line up over lane heads (`var(--lane-head)`), ribbon lines up over tape lanes (`minmax(0, 1fr) auto`).
     - **Row 3:** `"keys keys keys"` — Feed actions toolbar spans full width directly above the `#buffer` bench.
     - **Row 4:** `"sel sel sel"` — Ribbon selection actions when active.

3. **Responsive wrapping and flex alignment in `.studio-keys`:**
   - Give `.studio-keys` `flex-wrap: wrap; gap: 8px 12px; align-items: center;`.
   - `.buffer-grab` leads the row on the left.
   - `.studio-keep` keeps `margin-left: auto; flex: none;`.
   - On wide screens (>= 1100px), everything sits side-by-side with generous breathing room.
   - On medium screens (700px - 1050px), if the combined width exceeds the viewport, `.studio-keys` wraps cleanly without any overlapping or clipping.
   - On mobile (`< 700px`), `.buffer-grab` has `flex-wrap: wrap;` so its buttons never overflow the screen.

4. **Service Worker cache bump:**
   - Bump cache in `web/static/sw.js` to `hindsight-shell-v140`.
