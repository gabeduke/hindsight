# Rooms Architecture, Unified Media Player & UX Flow — Implementation Plan

**Goal:** Eliminate the 5 UX/animation regressions in the Rooms + Play UI and
replace the POC DOM-scraping shortcuts with clean Controller → SceneObject →
Renderer boundaries enforced by automated architecture tests.

**Spec:** [`docs/superpowers/specs/2026-10-16-rooms-architecture-and-flow-design.md`](../specs/2026-10-16-rooms-architecture-and-flow-design.md)

## Global Constraints

- **Flag-off parity:** With `hindsight.rooms` and `hindsight.play` off, every
  page (`index.html`, `tape.html`, `takes.html`, `wave.html`, `rig.html`) must
  render and behave identically to before.
- **Red-then-green tests:** Every new regression or architecture test must be
  seen failing before the fix lands and passing after.
- **Service worker & path globs:** Any new module under `web/static/lib/` joins
  `SHELL` in `web/static/sw.js` (with `CACHE` bumped), and any new directory
  joins the test globs in `AGENTS.md` and `.github/workflows/ci.yml`.
- **Visual verification:** Render and inspect every changed surface against the
  demo server at desktop (1440×900) and phone (390×844) in both light and dark
  schemes, with flags on and off.

---

## Build Order

- [ ] **Step 1 · Architectural guardrails (`web/static/lib/architecture.test.js` & `AGENTS.md`)**
  - Add `web/static/lib/architecture.test.js` asserting:
    1. No module in `lib/room/`, `lib/rooms/`, or `lib/play/` calls DOM-scraping
       helpers (`readBar`, `readRows`, `clickControl`, `pickRow`) or dispatches
       synthetic `.click()` onto hidden legacy controls.
    2. No module outside `lib/objects/` and `lib/scene/` defines custom CSS reel
       spin animations (`room-spin`) or bespoke reel SVG geometry.
    3. `tape/page.js` drives playhead rendering through `lib/objects/motion.js`'s
       shared 60fps `ticker` (`Loop`) rather than only inside 200ms `poll()` ticks.
    4. `styles.css` gates legacy room-replaced containers under `:root[data-rooms]`
       for frame-zero FOUC prevention.
  - Document these 4 rules in `AGENTS.md`.
  - Run `node --test web/static/lib/architecture.test.js` and watch it fail
    against the current POC code.

- [ ] **Step 2 · 60fps Playhead & Reel Interpolation (`tape/page.js`, `doorway.js`, `play/strip.js`)**
  - In `web/static/lib/tape/page.js`:
    - Introduce `heardNow(now = performance.now())` that interpolates
      `state.live.heard + Math.max(0, (now - state.livePollAt) / 1000) * sr * rate`
      while `state.live.playing` is true (clamped to loop/tape bounds).
    - Attach a `Loop` on `ticker` (`lib/objects/motion.js`) that runs while
      `state.live.playing` is true and smoothly updates the playhead cursor in
      `drawLanes()`, `drawRuler()`, `drawOverview()`, and `tapeCounter()` at
      60fps, parking (`return false`) as soon as playback pauses.
  - In `web/static/lib/room/doorway.js` & `styles.css`:
    - Replace the static `.room-deck-reel` spans and `@keyframes room-spin`
      with a real `ReelWindow` (`lib/objects/reel-window.js`) driven by the
      player controller's state on the shared 60fps `ticker`.
  - In `web/static/lib/play/screen.js` & `strip.js`:
    - Drive the instrument reel/progress from `ReelWindow` / `ReelMotion` on
      the shared `ticker` without poll-jitter snapping.

- [ ] **Step 3 · Zero-FOUC Frame-0 CSS Gating & Synchronous Room Mount**
  - In `web/static/styles.css`:
    - Under `:root[data-rooms]`, immediately hide legacy-only views (`#takes`,
      `.shelf-tools`, `.about`, legacy headers) before JS executes.
  - In `web/static/lib/rooms/mount.js`, `web/static/lib/room/boot.js`,
    `shelf-page.js`, and `wave/page.js`:
    - Mount the room layout containers synchronously before awaiting network
      fetches so the first painted frame already has the final room geometry.

- [ ] **Step 4 · Top-Right Header Utility Cluster (`lib/nav.js`, Settings, Releases, Guide)**
  - In `web/static/lib/nav.js` and `web/static/styles.css`:
    - When `roomsOn()` is true, render consistent `.appbar-btn` controls in
      `.appbar-end` on every page: Rig chip, Output (`#out-btn`), Update badge
      (`#update-btn`), Version/Releases button, Guide link, Settings button,
      and Help (`?`).
    - Ensure the Settings modal (`lib/settings.js`) and Releases picker sheet
      can open on *any* page (`takes.html`, `tape.html`, `wave.html`,
      `rig.html`, `index.html`) when triggered from `.appbar-end`.
    - Update `styles.test.js` and `pages.test.js` so the Settings reachability
      guard checks both flag-off (`.about`) and flag-on (`.appbar-end`).

- [ ] **Step 5 · Unified Media Player (`#np`) with 3-Way Source Switcher & Inline Sketchbook**
  - Create `web/static/lib/bar/feed-source.js` (`FeedSource`) alongside
    `TakeSource` and `TapeSource` so `#np` can play and display:
    - `feed` (Live Studio Feed `/api/stream.wav`)
    - `tape` (4-Track Studio Tape mix)
    - `take` (Shelf Cassette Take)
  - Add the 3-way segmented source selector (`Feed` · `Tape` · `Shelf`) inside
    `#np` when `hindsight.rooms` is on, wired to switch sources cleanly and
    auto-select when Play is pressed in a given surface.
  - Wire Studio (`tape.html`) and Listening Room (`takes.html`) to share the
    3-source Media Player contract and carry any active source (`feed`, `tape`,
    or `take`) across room switches without stopping playback.
  - Replace the DOM-scraping `lib/room/adapters.js` calls in `doorway.js` with
    direct controller state subscriptions, and open the **Sketchbook (`✎`)
    inline** inside the Listening Room so inspecting/trimming/flagging a take
    uses the live `TakeSource` without unloading the page or stuttering audio.

- [ ] **Step 6 · Collapsible Studio Swimlanes & Instrument Inside `#np`**
  - Add an explicit `#tracks-fold-btn` (`Tracks ▾ / ▸`) toggle in the Studio
    tracks header that folds/unfolds `#lanes` (`body.tracks-fold`) at any time.
  - Mount `#play-strip` inside `<section id="np">` as the Media Player's
    expandable upper instrument deck, with its `Instrument ▴/▾` toggle button
    integrated into `#np` whenever the `Tape` source is active.

- [ ] **Step 7 · Full Test Suite, SW Cache Bump & Browser Verification**
  - Bump `CACHE` in `web/static/sw.js` and update `SHELL`.
  - Run all unit, path, style, release-script, Go, and architecture tests.
  - Verify against the live demo server in a browser at phone and desktop sizes,
    in light and dark modes, with flags on and off.
