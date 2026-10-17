# Design Spec: Collapsible Media Player Transport Bar

**Date:** 2026-10-17  
**Author:** Gabe & Antigravity  
**Status:** In Progress  

## Context & Motivation

In Studio view (`body.tape-page`), the screen vertically stacks:
1. Shell topbar (`.topbar`: ~55px)
2. Live Studio feed (`.studio-feed`: ribbon visualizer, VU meters, grab & keep keys: ~180–200px)
3. Tape sections and ruler rows (~60px)
4. Four tape tracks in `#lanes.tape-lanes` (each requiring ~65–75px minimum)
5. Media player / transport bar (`#np` inside `#np-dock`: 120px to 160px with out-strip)

On desktop and laptop screens (especially common viewports with height 700–850px, such as 13"/14" MacBooks or browser windows with bookmark bars), the full two-row transport bar takes up over 20–25% of the total viewport height. This leaves insufficient room for the four tape tracks, causing the tracks to be severely compressed or forcing the main container to scroll so that the sticky media player covers the bottom tracks.

### User Request
> *"the media player is now overwriting the tape lanes, I think they should either operate side by side or the media player should be collapsable"*
> User confirmed preference: **"Make the media player collapsible with a toggle button (collapses between full 2-row transport and a slim compact bar, giving full height back to the tape lanes)"**.

---

## Design

### 1. Toggle Button (`#np-fold-btn`)

- **Anchor:** Positioned at the trailing end of `#np .np-own` (next to Catch and Eject).
- **Attributes:**
  - `id="np-fold-btn"`
  - `class="icon-btn np-fold-btn"`
  - `type="button"`
  - `aria-controls="np"`
  - `data-tip="np-fold"`
- **Responsive Display:**
  - On phones (`@media (max-width: 699.98px)`): Hidden (`display: none`), where the phone already has the mini-player + full-screen sheet (`#np-expand`).
  - On desktop (`@media (min-width: 700px)`): Always visible in `#np`.

### 2. State & Styling (`body.np-fold`)

- **Expanded (default):**
  - Label / glyph: `▾`, `aria-expanded="true"`, `aria-label="Collapse transport"`.
  - Full two-row transport bar (`--np-h: 120px`, or `160px` with `#out-strip`).
- **Collapsed (`body.np-fold`):**
  - Label / glyph: `▴`, `aria-expanded="false"`, `aria-label="Expand transport"`.
  - Height: `--np-h: 46px`.
  - Row 2 (`.np-row-2`: tape overview scrubber and OUT selector) is hidden (`display: none`).
  - Row 1 (`.np-row-1`):
    - Height reduced to 38px.
    - Reel window (`.np-window`): compact reels (28px) and LCD, preserving playhead position, time, and status.
    - Transport keys (`.np-keys`): compact 36px buttons (Start, Play, Loop, Rec, Click).
    - Catch key (`.np-catch`): compact row layout.
  - The reclaimed ~75–115px vertical space immediately flows to `main.tape-main` and `#lanes.tape-lanes`, letting all 4 tracks display comfortably.

### 3. Persistence

- Persisted in `sessionStorage` under `hindsight.npFold` (`'1'` when folded, deleted when expanded), mirroring `hindsight.tracksFold`.
- Initialized on page boot so the user's preferred layout persists across routes and reloads.

---

## Verification & Guardrails

- `web/static/lib/bar/player.test.js` / `bar.test.js`:
  - Unit tests verifying clicking `#np-fold-btn` toggles `body.np-fold`, updates `aria-expanded`, and persists to `sessionStorage`.
- Architecture Guardrails (`architecture.test.js`):
  - Preserves Controller → Model → Renderer separation.
  - No DOM scraping or synthetic clicks.
  - Service worker cache bump (`CACHE = 'hindsight-shell-vNNN'`).
