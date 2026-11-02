# Buffer Button Resize Stability Implementation Plan

**Date:** 2026-10-17 · **Status:** proposed · **Spec:** `docs/superpowers/specs/2026-10-17-buffer-button-resize-stability-design.md`

## Build Order

1. **Write regression test:**
   - In `web/static/lib/buffer/resize-stability.test.js`, verify:
     - `.buffer-grab` remains inside `keysRow` (`.studio-keys`) across media query transitions (`matchMedia('(min-width: 1100px)')`).
     - Window resizing does not reparent `.buffer-grab` into `.studio-feed-head`.
     - `Buffer ▴` / `Buffer ▾` remains visible and cleanly anchored.
   - Verify the regression test fails against unfixed code.

2. **Update `web/static/lib/buffer/buffer.js`:**
   - Remove `head.append(grabRow)` dynamic reparenting listener in `mountBuffer`.
   - Ensure `.buffer-grab` stays firmly in `keysRow`.

3. **Update `web/static/styles.css`:**
   - Remove the `head head keys` override under `@media (min-width: 1100px)` (lines 4004-4006 and 4045-4048).
   - Add responsive `flex-wrap: wrap; gap: 8px 12px;` to `.studio-keys` so rows wrap rather than squeezing/overlapping when viewport is narrow.
   - Ensure `.buffer-grab` wraps cleanly on small viewports.

4. **Bump Service Worker Cache:**
   - In `web/static/sw.js`, bump `CACHE` to `hindsight-shell-v140`.

5. **Verify:**
   - Run Node test runner for all suites.
   - Run git checks, commit, push, and open PR to `main`.
