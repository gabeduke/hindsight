# Waveform Page v2 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the v2 waveform page after the owner's phone testing: selections that grow past the screen edge, a readable waveform on quiet takes, a region length in bars, a cheaper overview strip, and the minors the last reviews ledgered.

**Architecture:** No new endpoints and no new modules. Pure helpers land in `geometry.js` with tests; `view.js`, `overview.js`, `page.js`, `wave.html`, `styles.css` take small, local changes; two server minors in `api.go`; the v2 spec's §1/§2 prose is brought in line with the hold-to-select amendment.

**Tech Stack:** unchanged (Go, vanilla ES modules, `node --test`).

**Spec:** `docs/superpowers/specs/2026-09-11-waveform-page-v2-design.md` (as amended 2026-09-11). Owner's standing approval: "build out the next set of features or iterate on the existing design to make it a tighter experience" (2026-09-11, AFK). Every decision below is recorded in `STATE.md`.

## Global Constraints

- Hold-to-select model stands: tap seeks, double-tap flags, drag pans, hold `HOLD_MS` then drag selects.
- Display gain is **view-only**: it never touches audio, peaks files, the cut, the render, or the takes list. Default **on**; the toggle lives under Fine tune and is remembered in `localStorage` key `wave.fit`.
- Edge auto-scroll applies **only while selecting** (`g.selecting`), never while panning or dragging a handle.
- All `node --test` runs use `node --test 'web/static/lib/wave/*.test.js'` (42 pass today). Go: `gofmt -l .`, `go vet ./...`, `go test -race ./...`.
- Branch `waveform-v2-polish` off `main` (`7970ca5`). Commit trailer as the repo's recent commits.
- Nothing in `clock.js`, `tiles.js`, `cut.go`, `render.go` changes.

---

### Task 1: Edge auto-scroll while selecting, haptic on hold, pointer robustness

**Files:** Modify `web/static/lib/wave/geometry.js`, `web/static/lib/wave/geometry.test.js`, `web/static/lib/wave/view.js`, `web/static/lib/wave/view.test.js`.

**Interfaces:**
- Produces in `geometry.js`: `export const EDGE_MARGIN_PX = 28; export const EDGE_MAX_STEP_PX = 14;` and `export function edgeScrollStep(x, width, margin = EDGE_MARGIN_PX, maxStep = EDGE_MAX_STEP_PX)` → CSS px per frame to pan: negative when `x < margin` (magnitude grows linearly to `maxStep` at `x <= 0`), positive when `x > width - margin`, `0` otherwise.
- In `view.js`: while `g.selecting`, a rAF loop `edgeLoop()` runs whenever the last pointer x is inside a margin: each frame `panTo(view.start + step * fpp)`, then re-derives the region from `g.anchor` to the frame under the (unchanged) pointer x and emits a provisional `regionChange`. Stops on release/rollback/pointer leaving the margin. `beginSelect` calls `navigator.vibrate?.(10)` inside a try (Android haptic; iOS ignores). `up()`/`cancel()` ignore events whose `pointerId` is not the gesture's (`g.id` set in `down()`), and `lostpointercapture` routes to `cancel()`.

- [ ] **Step 1: Failing tests**

`geometry.test.js`:
```js
import { edgeScrollStep, EDGE_MARGIN_PX, EDGE_MAX_STEP_PX } from './geometry.js';
test('edge scroll step ramps inside the margins and is zero elsewhere', () => {
  assert.equal(edgeScrollStep(195, 390), 0);
  assert.equal(edgeScrollStep(EDGE_MARGIN_PX, 390), 0);
  assert.equal(edgeScrollStep(0, 390), -EDGE_MAX_STEP_PX);
  assert.equal(edgeScrollStep(EDGE_MARGIN_PX / 2, 390), -EDGE_MAX_STEP_PX / 2);
  assert.equal(edgeScrollStep(390, 390), EDGE_MAX_STEP_PX);
  assert.equal(edgeScrollStep(390 - EDGE_MARGIN_PX / 2, 390), EDGE_MAX_STEP_PX / 2);
  assert.equal(edgeScrollStep(-50, 390), -EDGE_MAX_STEP_PX); // clamped past the edge
});
```
`view.test.js` (same `pointerView()` harness, `t.mock.timers` for `setTimeout` **and** `requestAnimationFrame` via a stubbed `globalThis.requestAnimationFrame` that records callbacks so the test can run one frame by hand):
- hold-select, then move the pointer to x = 385 (inside the right margin) → after running one recorded rAF callback, `view.start` increased by `EDGE_MAX_STEP_PX * fpp` or less and a provisional `regionChange` was emitted whose `end` grew; move to x = 195 → the loop stops (no further callback scheduled after the next frame).
- `up()` with a foreign `pointerId` while a select is armed → nothing emitted, gesture still set; then `up()` with the right id → finalises.
- `beginSelect` calls `navigator.vibrate` when present (stub `globalThis.navigator = { vibrate: spy }`), and does not throw when absent.

- [ ] **Step 2: Run** the glob → new tests fail (`edgeScrollStep` undefined; rAF/pointerId behaviour missing).

- [ ] **Step 3: Implement**

`geometry.js`:
```js
export const EDGE_MARGIN_PX = 28;
export const EDGE_MAX_STEP_PX = 14;
// While a selection drags toward a screen edge, the view pans so the region
// can grow past what is visible. The step ramps from 0 at the margin's inner
// edge to maxStep at the canvas edge (and beyond), so a finger resting near
// the edge scrolls gently and one pressed against it scrolls fast.
export function edgeScrollStep(x, width, margin = EDGE_MARGIN_PX, maxStep = EDGE_MAX_STEP_PX) {
  if (x < margin) return -maxStep * Math.min(1, (margin - x) / margin);
  if (x > width - margin) return maxStep * Math.min(1, (x - (width - margin)) / margin);
  return 0;
}
```
`view.js`:
- import `edgeScrollStep`.
- `down()`: bare-wave gesture gets `id: e.pointerId`; `up(e)`/`cancel(e)`: `if (g && g.id !== undefined && e.pointerId !== g.id) return;` before anything else (pinch gestures have no `id`; keep their existing handling).
- register `lostpointercapture` → `cancel` in the constructor with the same abort signal.
- `beginSelect(g)`: after arming, `try { navigator.vibrate?.(10); } catch {}`.
- `move()` select branch: store `g.lastX = p.x`; after emitting the grown region, `this.updateEdgeLoop(g)`.
- ```js
  updateEdgeLoop(g) {
    const step = edgeScrollStep(g.lastX, this.view.width);
    if (!step) { this.stopEdgeLoop(); return; }
    if (this.edgeRaf) return;
    const tick = () => {
      this.edgeRaf = 0;
      if (this.gesture !== g || !g.selecting) return;
      const s = edgeScrollStep(g.lastX, this.view.width);
      if (!s) return;
      const before = this.view.start;
      this.panTo(this.view.start + s * this.view.fpp);
      if (this.view.start !== before) {
        const cur = xToFrame(g.lastX, this.view);
        const r = { start: Math.min(g.anchor, cur), end: Math.max(g.anchor, cur) };
        this.emit('regionChange', { region: clampRegion(r, this.total, Math.max(1, Math.min(this.minLen, r.end - r.start))), final: false });
      }
      this.edgeRaf = requestAnimationFrame(tick);
    };
    this.edgeRaf = requestAnimationFrame(tick);
  }
  stopEdgeLoop() { if (this.edgeRaf) { cancelAnimationFrame(this.edgeRaf); this.edgeRaf = 0; } }
  ```
  Call `stopEdgeLoop()` in `up()` (select case), `rollback()`, `cancel()`, `destroy()`. `panTo` already clamps; at the take's ends `start` stops changing and the loop idles until the pointer moves.

- [ ] **Step 4: Run** the glob → green; `node --check`.
- [ ] **Step 5: Commit** "Grow a selection past the screen edge; haptic on hold; pointer id guards".

---

### Task 2: Fit waveform to peak (display gain)

**Files:** Modify `geometry.js`, `geometry.test.js`, `view.js`, `overview.js`, `page.js`, `wave.html`, `styles.css`.

**Interfaces:**
- `geometry.js`: `export function fitGain(filePeaks, target = 0.9, max = 40)` → the multiplier that brings the take's loudest sample to `target` of full scale, clamped to `[1, max]`; `1` when peaks are empty or already at/above target.
- `page.js`: `state.gain` (number, 1 when the toggle is off); `getState()` unchanged in shape. `#fit-peak` checkbox in Fine tune; persisted `wave.fit` (`'1'`/`'0'`, default on when unset).
- `view.js` paint: `mx * st.gain` / `mn * st.gain`, then clamp to `[-1, 1]`. `overview.js` paint: same on its folded lane. Both re-read `st.gain` per paint, so toggling is a `redraw()`.

- [ ] **Step 1: Failing test** (`geometry.test.js`):
```js
import { fitGain } from './geometry.js';
test('fitGain scales a quiet take up to the target and never down', () => {
  const pk = (v) => ({ channels: 1, buckets: 2, data: [[-v, v, -v / 2, v / 2]] });
  assert.equal(fitGain(pk(0.9)), 1);
  assert.equal(fitGain(pk(1.0)), 1);
  assert.ok(Math.abs(fitGain(pk(0.0123)) - 0.9 / 0.0123) < 1e-9);
  assert.equal(fitGain(pk(0.0001)), 40);
  assert.equal(fitGain({ channels: 1, buckets: 0, data: [[]] }), 1);
});
```
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement**
```js
// A -38 dBFS take drawn on an absolute scale is a flat line. This is the
// display-only multiplier that lifts its loudest sample to `target`; it never
// touches audio, and the takes list keeps its absolute scale on purpose.
export function fitGain(filePeaks, target = 0.9, max = 40) {
  let peak = 0;
  for (const ch of filePeaks.data || []) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  if (!(peak > 0) || peak >= target) return 1;
  return Math.min(max, target / peak);
}
```
`wave.html` Fine tune grid, before the Downbeat row:
```html
      <span class="fine-label">Waveform</span>
      <label class="fine-hint fine-check"><input id="fit-peak" type="checkbox"> fit quiet takes to the height</label>
```
`page.js`: `import { fitGain } ...`; `const gainFit = fitGain(filePeaks);` compute once; `state.gain = fitOn ? gainFit : 1` where `fitOn` reads `localStorage.getItem('wave.fit') !== '0'` in a try; `$('fit-peak').checked = fitOn`; on `change`: set `state.gain`, persist, `redraw()`.
`view.js` paint: `const mn = Math.max(-1, cols[...] * st.gain), mx = Math.min(1, cols[...] * st.gain);` (`st.gain ?? 1`). `overview.js` paint: apply the same to `mn`/`mx` before drawing (`this.getState().gain ?? 1`).
`styles.css`: `.fine-check { display: inline-flex; align-items: center; gap: 6px; } .fine-check input { width: 20px; height: 20px; }`.
- [ ] **Step 4: Run** the glob; `node --check` on the three modules; start the demo and confirm the demo take (loud) is unchanged with the box on/off, then with `browser_evaluate` set `state.gain`... (state is closed over; instead fetch `/api/peaks` and check `fitGain` in Node). Toggle persists across reload.
- [ ] **Step 5: Commit** "Fit quiet takes to the waveform height, display-only".

---

### Task 3: Region length in seconds and bars

**Files:** Modify `geometry.js`, `geometry.test.js`, `page.js`, `wave.html`.

**Interfaces:** `geometry.js`: `export function fmtRegionLength(region, grid)` → `"29.5 s"` or `"29.5 s · 14.8 bars"` when `grid.bpm`; `""` when `region` is null. `page.js`: a `Region` row in Fine tune (`#region-length`) updated from `updateActionRow()`.

- [ ] **Step 1: Failing test**:
```js
import { fmtRegionLength } from './geometry.js';
test('region length in seconds and bars', () => {
  const g = { bpm: 120, sampleRate: 48000, downbeat: 0 };
  assert.equal(fmtRegionLength({ start: 0, end: 48000 * 8 }, g), '8.0 s · 4.0 bars');
  assert.equal(fmtRegionLength({ start: 0, end: 48000 * 29.5 }, { ...g, bpm: null }), '29.5 s');
  assert.equal(fmtRegionLength(null, g), '');
});
```
- [ ] **Step 2: Run** → fails. **Step 3:** implement (bars = frames / (framesPerBeat * 4), one decimal each). `wave.html`: add `<span class="fine-label">Region</span><span id="region-length" class="mono fine-hint">—</span>` as the first grid row. `page.js`: `$('region-length').textContent = fmtRegionLength(state.region, state.grid) || '—'` in `updateActionRow()`; also refresh it in the `downbeatChange` handler? No — length does not depend on the downbeat. BPM edits happen on the list page, so no live refresh needed.
- [ ] **Step 4: Run** green. **Step 5: Commit** "Show the region's length in seconds and bars under Fine tune".

---

### Task 4: Overview strip: cached waveform, pointer ownership

**Files:** Modify `overview.js`, `overview.test.js`.

- [ ] **Step 1:** Add a test that `down()` while a gesture with a different `id` is live does **not** replace it (drive `down` twice with different `pointerId`s on the stubbed instance; assert `gesture.id` is still the first).
- [ ] **Step 2: Run** → fails.
- [ ] **Step 3: Implement:**
  - `down(e)`: `if (this.gesture && this.gesture.id !== e.pointerId) return;` before creating a gesture; fix the comment to say a second pointer is ignored entirely.
  - Static waveform cache: keep `this.waveCache` (an `OffscreenCanvas` if available, else a detached `document.createElement('canvas')`) rendered in `renderWaveCache()` at the current `cssW`/`cssH`/`dpr`/`gain`; `paint()` does `ctx.drawImage(this.waveCache, 0, 0, W, H)` then the dynamic layers (region, flags, cursor, window). Invalidate on `resize()` and when `st.gain` changes (compare to `this.cachedGain`). This removes the per-tick min/max scan.
- [ ] **Step 4: Run** green; `node --check`. **Step 5: Commit** "Cache the overview's waveform; ignore a second pointer on the strip".

---

### Task 5: Server minors and spec prose

**Files:** Modify `internal/api/api.go`, `internal/api/api_test.go`, `docs/superpowers/specs/2026-09-11-waveform-page-v2-design.md`, `docs/development.md`.

- [ ] **Step 1:** In `api_test.go`'s render-500 test, add `if w.Header().Get("Content-Disposition") != "" { t.Error("500 must not carry a filename") }` → fails.
- [ ] **Step 2: Implement:** in `handleRender`'s zero-bytes branch, `w.Header().Del("Content-Disposition")` before `writeErr`. Above the `url.PathEscape` line add a comment: the value is RFC 5987-safe only because `RenderFilename` whitelists letters, digits, space, `-`, `_`, `.`; widening that whitelist needs an `attr-char` encoder.
- [ ] **Step 3:** Spec: rewrite §1's "One-finger drag no longer pans; see §2." to "One-finger drag pans; press-and-hold then drag selects (see §2)." and §2's table so the "Drag does" column for the two bare-waveform rows reads "pans; after a 350ms hold, creates a region from the press frame (replacing any existing one)". Add a line under §3 Fine tune for "Waveform: fit quiet takes to the height" and "Region: length in seconds and bars". `docs/development.md` manual checks: add the fit toggle, the region length row, and edge auto-scroll while selecting.
- [ ] **Step 4:** `gofmt`, `vet`, `go test -race ./...` green. **Step 5: Commit** "Render 500s drop the filename; spec prose matches hold-to-select; docs for the polish".

---

## Self-review

Spec coverage: this is a polish plan against the amended v2 spec; each task either closes a ledgered minor (pointer ids, lost capture, overview ownership, 500 header, PathEscape comment, spec prose) or adds a bounded display feature (edge scroll, fit gain, region length, overview cache) with no audio or API surface change. Placeholders: none. Types: `edgeScrollStep(x, width, margin, maxStep)`, `fitGain(filePeaks, target, max)`, `fmtRegionLength(region, grid)` used consistently; `state.gain` read as `st.gain ?? 1` in both painters.
