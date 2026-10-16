# Rooms Architecture, Unified Media Player & UX Flow

**Date:** 2026-10-16 · **Status:** agreed · **Repo:** `hindsight` ·
Builds on [Two rooms and a rig](2026-10-15-rooms-design.md),
[The scene contract (R1)](2026-10-15-scene-contract-design.md), and
[Flow follow-ups (F1–F9)](2026-10-15-flow-design.md).

## Why

The initial Two Rooms (`hindsight.rooms`) and Instrument (`hindsight.play`)
migration proved out the spatial layout as a proof-of-concept, but introduced
five usability and architectural regressions:

1. **Jerky tape & reel animations:**
   - `web/static/lib/tape/page.js` only redraws its playhead, ruler, overview,
     and LCD counter inside `poll()` every `POLL_MS = 200` (5 Hz), with no
     60fps `ticker` interpolation between network polls.
   - `web/static/lib/room/doorway.js` draws its own `.room-deck-reel` CSS
     keyframe (`animation: room-spin 2.4s linear infinite`) and scrapes the
     DOM at 2 Hz (`setInterval(..., 500)`) instead of mounting `ReelWindow` /
     `CassetteFace` on the shared 60fps `ticker`.
   - `web/static/lib/play/screen.js` uses a bespoke SVG reel updated on 200ms
     poll events instead of `ReelMotion`.
2. **Page-switch FOUC ("old UI then new UI"):**
   - `:root[data-rooms]` is set synchronously in `<head>` by `#rooms-early`,
     but `styles.css` only uses it to hide `.appnav:not(.appnav-rooms)`.
   - `takes.html`, `tape.html`, and `wave.html` paint the legacy DOM first and
     dynamically `import()` the Rooms modules after layout or network fetches
     complete, causing a visible flash and mid-render layout shift amplified
     by `@view-transition`.
3. **Settings, Releases, and Guide placement & mixed button styles:**
   - App-level controls (`#settings-btn`, `#releases-btn`, `the guide`,
     `#update-btn`) sit at the bottom of the Studio page inside `.about` with
     three different visual treatments (bordered pill, inline text button, and
     anchor link), and are completely unreachable from the Listening Room or
     Rig.
4. **Fragmented Media Player (`#np`), Sketchbook stutter, and Studio stop:**
   - `#np` is duplicated across three incompatible implementations:
     `lib/bar/bar.js` (`takes.html` / `index.html`), `lib/tape/page.js`
     (`tape.html`), and `lib/wave/page.js` (`wave.html`).
   - Clicking the Sketchbook (`✎`) in the Listening Room triggers a full MPA
     navigation to `/wave.html?file=…`, tearing down the active `<audio>`
     element, re-fetching metadata/peaks, and re-decoding audio—causing playhead
     stutter (or blocked autoplay on iOS).
   - Navigating to the Studio stops any playing shelf take because Studio's
     `#np` only speaks to the 4-track tape.
5. **Swimlane folding & Instrument affiliation:**
   - Studio tape swimlanes (`#lanes`) only fold when the Buffer panel is open
     (`body.buffer-fold`), lacking a dedicated collapse/expand toggle.
   - The Instrument strip (`#play-strip`) mounts as a sibling *above* `#np`
     rather than inside the Media Player (`#np`), obscuring that its punch-in
     FX, tape mods, and loop tricks apply to the Media Player's Tape channel.

---

## Architectural Guardrails

To make clean separation the default and prevent POC shortcuts from returning,
every Rooms and Play module must obey four structural rules enforced by
`web/static/lib/architecture.test.js` and documented in `AGENTS.md`:

### 1. Controller → Model → Renderer (No DOM Scraping or Synthetic Clicks)

```
Controller (bar / shelf / tape)  →  SceneObject / Model (60fps ticker)  →  View / Renderer
```

- Views under `lib/room/`, `lib/rooms/`, and `lib/play/` never scrape text out
  of legacy DOM nodes (`readBar`, `readRows`, `textContent`) and never trigger
  behavior by calling `.click()` on hidden legacy buttons (`clickControl`).
- Controllers expose explicit state snapshots, `.on('change', fn)`
  subscriptions, and action methods (`play()`, `pause()`, `selectSource()`,
  `selectTake()`, `openSketchbook()`).

### 2. Visual Objects Come Exclusively from `lib/objects/` & `lib/scene/`

- No module outside `lib/objects/` may define custom reel/cassette/VU markup
  or CSS `@keyframes` spin animations (`room-spin`).
- The Listening Room Hi-Fi deck (`.room-deck`) and the Instrument drawer use
  `ReelWindow` / `CassetteFace` backed by `ReelMotion` on the shared `ticker`.

### 3. 60fps Shared `ticker` Interpolation Contract

- Network poll handlers (`POLL_MS = 200`) only update target state (`heard`,
  `playing`, `at`, `sampleRate`, `length`).
- Every playhead, reel, ruler cursor, overview cursor, and time counter steps
  on `lib/objects/motion.js`'s shared `ticker` (`Loop`) using linear clock
  interpolation:
  $$\text{frame}(t) = \text{heard} + \max(0, t - t_{\text{poll}}) \times f_s \times \text{rate}$$
- When `!playing`, the `Loop` returns `false` and parks immediately.

### 4. Frame-Zero Flag Gating (`:root[data-rooms]`)

- Any legacy container replaced by a Rooms view is hidden in `styles.css`
  under `:root[data-rooms]` (which is set synchronously in `<head>` before
  first paint), never solely by a class added after an async `import()` or
  network `fetch()`.
- With `hindsight.rooms` and `hindsight.play` off, the legacy DOM, CSS, and
  behavior remain 100% untouched.

---

## Design Decisions

### 1. Zero-FOUC Room Mounting & Inline Sketchbook

- **CSS pre-hiding from frame 0:** Under `:root[data-rooms]`, `styles.css`
  immediately hides `#takes`, `.shelf-tools`, and `.about`, and reserves the
  Studio Feed and Listening Room stage containers before first paint.
- **Synchronous room shell mount:** ` takes.html` and `tape.html` mount their
  room shell DOM synchronously during module initialization rather than waiting
  for network fetches to resolve.
- **Inline Sketchbook in the Listening Room:**
  - Opening the Sketchbook (`✎` on the shelf, deck, or chair, or clicking the
    Sketchbook prop in the Listening Room) opens the **Sketchbook drawer/view
    inline** inside the Listening Room without unloading the page or touching
    the active `<audio>` element in `#np`.
  - The inline Sketchbook mounts the waveform scrubber, flag markers, trim
    handles, take family versions, and notes directly against the active
    `TakeSource` clock—eliminating playhead stutter completely.
  - Direct visits to `/wave.html?file=…` continue to work and share the same
    component logic.

### 2. Unified Media Player (`#np`) with 3-Way Source Selector

`#np` is a single unified Media Player object across Studio and Listening Room
with three pluggable audio sources:

| Source ID | Label | Backing Source | What It Plays |
|---|---|---|---|
| `feed` | **Feed** | `FeedSource` (`lib/bar/feed-source.js`) | Live studio input monitor stream (`/api/stream.wav`) + live ring counter |
| `tape` | **Tape** | `TapeSource` (`lib/bar/tape-source.js`) | The 4-track studio tape mix (`/api/tape/*`) + 60fps interpolated playhead |
| `take` | **Shelf** | `TakeSource` (`lib/bar/take-source.js`) | The selected cassette take from the shelf (`/api/download?file=…`) |

- **Explicit 3-Way Segmented Switcher:**
  - The left side of `#np` (when `hindsight.rooms` is on) displays a segmented
    source toggle: **`Feed` · `Tape` · `Shelf`**.
  - Clicking any source segment switches `#np` to that source (pausing the
    prior source if it was playing on the phone) and updates the player's
    reel window, title, counter, scrub bar, and transport controls.
  - Auto-selection on intent: pressing Play on a shelf cassette automatically
    selects `Shelf`; pressing Play or Record on the Studio tape transport
    automatically selects `Tape`; clicking Listen on the Studio Feed selects
    `Feed`.
- **Continuity Across Rooms:**
  - Studio (`tape.html`) and Listening Room (`takes.html`) both host all three
    sources in `#np`, and `lib/bar/carry.js` carries the active source (`take`,
    `tape`, or `feed`), frame, and playback state across room transitions so
    navigating between Studio and Listening Room never drops playback.

### 3. Collapsible Studio Swimlanes & Instrument Inside `#np`

- **Independent Swimlane Collapse (`Tracks ▾ / ▸`):**
  - The Studio Tracks section header includes an explicit collapse/expand
    toggle button (`#tracks-fold-btn`, `aria-expanded="true|false"`).
  - Collapsing folds `#lanes` into compact horizontal track summary strips
    (`body.tracks-fold`, sharing the clean strip layout with `body.buffer-fold`)
    while keeping track mute/arm indicators and the overview bar visible.
- **Instrument Drawer Inside the Media Player (`#np`):**
  - When `hindsight.play` is enabled, the Instrument strip (`#play-strip`)
    mounts **inside `<section id="np">`** as an expandable upper deck of the
    Media Player (`#np.np-has-instrument`), rather than as a detached section
    above `#np-dock`.
  - An `Instrument ▴/▾` toggle pill lives directly inside `#np`'s control bar
    when the `Tape` source is active, making it visually unmistakable that the
    Instrument's punch-in FX, tape mods, and loop tricks process the Media
    Player's `Tape` channel.

### 4. Top-Right Header Utility Cluster (Settings, Guide, Releases/Update)

- When `hindsight.rooms` is on, [`lib/nav.js`](file:///Users/gabeduke/repos/hindsight/web/static/lib/nav.js)
  populates `.appbar-end` in the top-right header across **every page**
  (`index.html`, `tape.html`, `takes.html`, `wave.html`, `rig.html`) with a
  uniformly styled utility bar:
  - **Rig chip** (`.rig-chip`)
  - **Output selector** (`#out-btn`)
  - **Update badge** (`#update-btn`, shown when a newer release is available)
  - **Releases / Version pill** (`.appbar-releases-btn`, opens the Releases
    picker sheet from any page)
  - **Guide pill** (`.appbar-guide-link`, opens the guide)
  - **Settings pill** (`.appbar-settings-btn`, opens the Settings & Preview
    Features modal from any page)
  - **Help pill** (`#help`, `?`)
- The legacy footer `.about` remains in the DOM for flag-off mode and is
  hidden only under `:root[data-rooms]`, with `styles.test.js` and
  `pages.test.js` updated to verify that Settings is always reachable in both
  flag-off (`.about #settings-btn`) and flag-on (`.appbar-end`) modes.
