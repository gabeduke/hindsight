# Unified Waveform / Clip Editor & Direct Navigation Design

- **Date:** 2026-10-17
- **Status:** Proposed
- **Author:** Antigravity

## Context & Motivation

In recent UX audits and user feedback (`docs/superpowers/2026-10-17-handoff.md`), two friction points were identified around waveform and take editing:
1. **Unintuitive Navigation from the Listening Room**:
   Reaching the waveform editor (`wave.html`) from the Listening Room previously required detouring through the Sketchbook drawer (`doorway.js`), because clicking the deck with a take in it opened the Sketchbook rather than the waveform editor, and the deck dock explicitly hid the "Open" button (`sit.hidden = !d || d.kind === 'take'`).
2. **Fragmented Editing Paradigms**:
   Editing clips on the tape reel in the Studio (`lib/tape/`) and editing standalone takes in the waveform editor (`lib/wave/`) duplicated logic for gain calculations, fade curves, and editing gestures. While `lib/edit/editor-bar.js` centralized sample nudging and zoom encoders, fade curve mathematics, gain text formatting, and normalization shared no unified module.

## Requirements & Design Decisions

### 1. Direct "Edit" Navigation from the Listening Room

- **Deck Tap**:
  When a take is on the deck in the Listening Room, clicking the deck (`openBar` in `lib/room/doorway.js`) navigates directly to the take's waveform editor (`/wave.html?file=${encodeURIComponent(t.name)}`).
- **Deck Dock Button**:
  The dock's action button (`.room-sit`) remains visible when a take is loaded (`sit.hidden = !d`), displaying "Edit" (or "Open"), taking the user directly to the waveform editor.
- **Shelf Row & Detail Wording**:
  Shelf list rows (`lib/takes.js`) and detail pane (`lib/shelf-detail.js`) label the navigation action clearly as "Edit" / "Edit take ›", providing direct access to the waveform editor without passing through the notes dialog.
- **Notes Preservation**:
  The Sketchbook remains accessible via the dedicated `✎` button (`#np-note`) on the bar or inside the waveform editor, preserving rapid flag annotation while separating notes from editing.

### 2. Unified Edit Curves & Gain Utilities (`lib/edit/curves.js`)

Extract shared curve and fade definitions into `web/static/lib/edit/curves.js`:
- `gainText(db)`: standard formatted decibel representation (`+2.4 dB`, `-1.1 dB`, `0.0 dB`).
- `FADE_SHAPES`: shared curve models ('linear', 'log', 'exp', 's-curve') with normalized mathematical evaluation functions $y = f(x)$.
- `fadeCurve(shape, t)`: evaluatable curve interpolation for both tape clip rendering and waveform rendering.
- `fadeOptions(sampleRate)`: shared time/beat fade preset steps (e.g., 3 ms de-click, 10 ms, 25 ms, 50 ms, 100 ms, 1/16, 1/8).

### 3. Service Worker Cache

Bump `CACHE` in `web/static/sw.js` to `hindsight-shell-v143` when shipping edits to `lib/` or `styles.css`.
