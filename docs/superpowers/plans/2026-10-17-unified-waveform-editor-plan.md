# Unified Waveform Editor & Direct Navigation Implementation Plan

- **Goal:** Enable direct navigation from the Listening Room to the waveform editor and unify edit curve / fade utilities.
- **Spec:** `docs/superpowers/specs/2026-10-17-unified-waveform-editor-design.md`

## Proposed Changes

1. **`web/static/lib/room/doorway.js`**
   - In `openBar()`, when `d.kind === 'take'`, navigate directly to `/wave.html?file=${encodeURIComponent(d.take.name)}` instead of invoking `openSketchbook`.
   - In `renderDock()`, do not hide `.room-sit` when `d.kind === 'take'`; set its text to `Edit` (or `Open`) and link to the take's wave editor URL.
2. **`web/static/lib/takes.js` & `web/static/lib/shelf-detail.js`**
   - Ensure "Edit" / "Edit take ›" label is clean and consistently routes to `/wave.html?file=...`.
3. **`web/static/lib/edit/curves.js` & `web/static/lib/edit/curves.test.js`**
   - Create `web/static/lib/edit/curves.js` with shared fade curves (`FADE_SHAPES`, `fadeCurve`), gain text formatting (`gainText`), and fade presets.
   - Add unit tests verifying curve calculations and monotonicity.
4. **`web/static/sw.js`**
   - Bump `CACHE` from `hindsight-shell-v142` to `hindsight-shell-v143`.
   - Add `/lib/edit/curves.js` to `SHELL` array if needed.
5. **Verification**
   - Run `node --test 'web/static/lib/edit/*.test.js' 'web/static/lib/room/*.test.js' 'web/static/lib/paths.test.js'`.
   - Run full test suite.
