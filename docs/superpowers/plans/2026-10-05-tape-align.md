# Aligning clips on the tape — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zoom the tape to single samples with sample-level clip drawing, and move a clip to the sample with the take page's editor bar, snapping its first hit to the grid or to a hit on another track.

**Architecture:** Two small Go endpoints serve a pool file's range peaks and a 16-bit slice. The take page's tile cache and audio fetcher learn URL builders so the tape can use them on pool files. A new pure module, `lib/tape/align.js`, does the frame maths. The take page's editor-bar gesture core (pads, steps, keys, wheel, "save when the gesture ends") moves into `lib/edit/editor-bar.js`, which both pages use. The tape page draws clips with sample detail when zoomed past their whole-file peaks, and opens the bar on a clip from its sheet.

**Tech Stack:** Go 1.23 (no new dependencies), vanilla ES modules, Canvas 2D, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-tape-align-design.md`

## Global Constraints

- `CGO_ENABLED=0 go test ./...` and `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js'` pass after every task. (`lib/edit/*.test.js` is new; add the glob to `docs/development.md`'s command and the CI workflow's node step if they list globs.)
- **The take page's boundary editor behaves exactly as before** after the extraction: its node tests pass unchanged and its demo checks (spec 2026-10-05-boundary-editor-design.md, Checks) still hold.
- Moves of a clip are saved as the existing `slide` edit (`POST /api/tapes/edit?id=`, `{op: 'slide', clip, at}`), `at` in whole frames, one per gesture (a pad drag saves on release; a step or snap at once). The clip's nudge is never changed by alignment.
- **Where a clip sounds** is `at + nudge` (`soundingAt`); all alignment is in sounding frames.
- Attack (`findAttack`) is used with a reach of min(60 ms, half the visible span), and declines (`-1` → a toast) rather than guesses.
- The tape's zoom floor is the take page's `MIN_FPP` (8 px per sample).
- Reel-to-reel rules: no new hex in JS except token fallbacks; lanes draw with the window inks and track colours; hover only inside `@media (hover: hover)`; `:focus-visible` rings; reduced motion; nothing orange in the editor; the track picker shows track numbers in their colours.
- Pool files are reached only through `Store.AudioPath` (which refuses anything but a pool name); new endpoints refuse other names with 400, a missing file with 404, a bad range with 400, more than `audio.MaxSliceSeconds` with 400.
- Copy follows the repo's voice: plain words, no "user". The guide's tips table and `tips.js` match row for row.
- Commits end with the two trailer lines the controller gives.

## Review Focus

1. **A clip with a nudge** — every alignment number must be in sounding frames; a clip nudged +7 ms aligned Hit → Track ends with its *sound* on the reference hit, its nudge unchanged. → Task 3 tests; Task 6 demo.
2. **The take page after the extraction** — any regression in its editor (dirty-save on gesture end, the wheel accumulator, held-key save, pad capture) breaks shipped behaviour. → Task 4 keeps the take page's tests and a demo re-check.
3. **Deep zoom on the tape with many clips** — drawing must stay smooth: tiles requested only for clips on screen, whole-file bars drawn while a tile loads, no per-frame fetch storms. → Task 5.
4. **Hit → Track where the reference track has nothing at the point** — a toast, nothing moved. → Task 6.
5. **A clip moved to the tape's start or end** — clamped (`placeAt`), never a failed slide. → Task 3 test; Task 6 wiring uses `placeAt`.

---

### Task 1: The pool file's range peaks and slice

**Files:**
- Modify: `internal/api/api.go` (`handlePeaksRange` → shares a new `writeRangePeaks`; `handleSlice` → shares a new `writeSlice`; route `/api/tapes/slice`)
- Modify: `internal/api/tape.go` (`handleTapePeaks` gains the range form; new `handleTapeSlice`)
- Test: `internal/api/tape_test.go`

**Interfaces:**
- Produces: `GET /api/tapes/peaks?file=<pool>&from=&to=&buckets=` → `audio.PeakData` JSON (immutable cache); without the three params, the whole-file peaks as now. `GET|HEAD /api/tapes/slice?file=<pool>&from=&to=` → a 16-bit WAV of `[from, to)`, both channels (immutable cache).

- [ ] **Step 1: Write the failing tests.** In `internal/api/tape_test.go`, a test that puts a known pool file on a tape and reads it back both ways. Use the existing drop path (see the test near the `/api/tapes/drop` calls, ~line 205: it writes a take with the package's take-writing helper and drops it), then read the clip's `file` from `/api/tapes/state`. Assert:
  - `GET /api/tapes/peaks?file=<clip.file>&from=0&to=4800&buckets=16` → 200, JSON with `buckets` 16;
  - the same with `to` past the file's end → 400; `buckets=0` → 400; only `from` given → 400;
  - `GET /api/tapes/slice?file=<clip.file>&from=0&to=4800` → 200, `Content-Type: audio/wav`, body length `44 + 4800*2*2`;
  - `GET /api/tapes/slice?file=../etc/passwd&from=0&to=10` → 400; a well-formed but missing pool name (`audio/copy_2000-01-01_000000.wav`) → 404; `to` more than 60 s past `from` → 400;
  - `GET /api/tapes/peaks?file=<clip.file>` (no range) → 200 as before.
- [ ] **Step 2: Run them to see them fail.** `CGO_ENABLED=0 go test ./internal/api/ -run Tape` — the range and slice asserts fail (404 for the unknown route; the peaks range answers whole-file JSON).
- [ ] **Step 3: Share the range-peaks handler.** In `api.go`, move the body of `handlePeaksRange` after it resolves `path` into:

```go
// writeRangePeaks answers peaks for [from, to) of the WAV at path, from the
// request's from, to and buckets: the take page's tiles, and the tape's
// (a pool file's). what names the file in errors.
func writeRangePeaks(w http.ResponseWriter, r *http.Request, path, what string) {
	// (the existing validation of from, to and buckets, the os.Stat → 404,
	// audio.RangePeaks, ErrRange → 400 "range is past the end of the <what>",
	// the 500 with a log line, the immutable Cache-Control and writeJSON —
	// moved verbatim, with "take" replaced by what)
}
```

  and make `handlePeaksRange` call `writeRangePeaks(w, r, filepath.Join(a.cfg.OutputDir, name), "take")`. Run `CGO_ENABLED=0 go test ./internal/api/` — the take tests still pass.
- [ ] **Step 4: Share the slice handler** the same way: `writeSlice(w, r, path string, pick []int, what string)` holding everything of `handleSlice` after the path is known (32-bit check, range checks, `MaxSliceSeconds`, headers, HEAD, `WriteSlice16`). `handleSlice` calls it with `audio.SlicePick(info, a.cfg.SaveChannels)` as now (read `info` inside `writeSlice` and take a `pickFor func(audio.WAVInfo) []int` if the pick depends on it — keep the take's behaviour byte-identical).
- [ ] **Step 5: The tape's forms.** In `handleTapePeaks`, after `p` is resolved: if any of `from`, `to`, `buckets` is present, `writeRangePeaks(w, r, p, "pool file")` and return (it 404s a missing file). Add:

```go
// handleTapeSlice streams a 16-bit WAV of [from, to) of a pool file, both
// channels: the audio round a point that the tape's clip editor reads for
// Attack. A pool file is immutable, so it caches like a take's slice.
func (a *API) handleTapeSlice(w http.ResponseWriter, r *http.Request) {
	if a.tapeOff(w) {
		return
	}
	p := a.tape.Store().AudioPath(r.URL.Query().Get("file"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "not a pool file")
		return
	}
	writeSlice(w, r, p, func(audio.WAVInfo) []int { return nil }, "pool file")
}
```

  and route it beside `/api/tapes/peaks`: `r.HandleFunc("/api/tapes/slice", a.handleTapeSlice).Methods(http.MethodGet, http.MethodHead)`. Document both in the route comment block at the top of `tape.go` and in `docs/api.md` beside `/api/tapes/peaks`.
- [ ] **Step 6: Run the tests.** `CGO_ENABLED=0 go test ./internal/api/ && CGO_ENABLED=0 go test ./...` — all pass.
- [ ] **Step 7: Commit** — "The tape serves a pool file's range peaks and a slice of it".

---

### Task 2: The tile cache and the audio fetcher learn a URL

**Files:**
- Modify: `web/static/lib/wave/tiles.js` (`TileCache`)
- Modify: `web/static/lib/wave/near.js` (`NearAudio`)
- Test: `web/static/lib/wave/tiles.test.js`, `web/static/lib/wave/near.test.js`

**Interfaces:**
- Produces: `new TileCache({ ..., urlFor })` where `urlFor(from, to, buckets) → string`, default `(f, t, b) => \`/api/peaks?file=${encodeURIComponent(file)}&from=${f}&to=${t}&buckets=${b}\``; `new NearAudio({ ..., urlFor })` where `urlFor(from, to) → string`, default the `/api/slice` URL as now. Callers that pass nothing behave exactly as before.

- [ ] **Step 1: Tests first.** In `tiles.test.js`, a test constructing a `TileCache` with `urlFor: (f, t, b) => \`/api/tapes/peaks?file=x&from=${f}&to=${t}&buckets=${b}\``, a fake `fetchFn` recording URLs, and asserting the first request's URL starts `/api/tapes/peaks?file=x&from=0&to=`. In `near.test.js`, the same for `NearAudio` with `urlFor: (f, t) => \`/api/tapes/slice?file=x&from=${f}&to=${t}\``. See them fail.
- [ ] **Step 2: Implement.** Store `urlFor` with the default above; use it where the URLs are built (`tiles.js` ~line 59; `near.js` `around()`).
- [ ] **Step 3: Run the node suite** — all pass (the existing tiles and near tests unchanged).
- [ ] **Step 4: Commit** — "Tiles and the audio round a point can come from another endpoint".

---

### Task 3: `lib/tape/align.js` — the clip alignment maths

**Files:**
- Create: `web/static/lib/tape/align.js`
- Test: `web/static/lib/tape/align.test.js`

**Interfaces:**
- Consumes: `snapFrame(grid, f, snap)` and `nudgeFrames(clip, sampleRate)` from `./geometry.js`.
- Produces: `soundingAt(clip, sr)`, `toFile(clip, f, sr)`, `toTape(clip, k, sr)`, `fileView(clip, view, width, sr) → {start, fpp, width}`, `gridMove(hit, grid, snap) → frames`, `beatGrid(grid, sr) → {bpm, sampleRate, downbeat}`, `clipUnder(track, f, sr) → clip | null`, `placeAt(clip, delta, length) → at`.

Prototyped and validated before the plan; write it as given.

- [ ] **Step 1: Tests** — `web/static/lib/tape/align.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundingAt, toFile, toTape, fileView, gridMove, beatGrid, clipUnder, placeAt } from './align.js';

const sr = 48000;
const clip = { at: 100000, src: 480, frames: 96000, layer: 0, nudge_ms: 2.5 }; // heard 120 frames late

test('a clip sounds at its at plus its nudge, and tape and file frames map both ways', () => {
  assert.equal(soundingAt(clip, sr), 100120);
  assert.equal(soundingAt({ ...clip, nudge_ms: undefined }, sr), 100000);
  assert.equal(toFile(clip, 100120, sr), 480);
  assert.equal(toFile(clip, 101120, sr), 1480);
  assert.equal(toTape(clip, 1480, sr), 101120);
});

test('the view of the clip\'s file under a tape view', () => {
  assert.deepEqual(fileView(clip, { from: 100120, to: 100520 }, 400, sr), { start: 480, fpp: 1, width: 400 });
  assert.deepEqual(fileView(clip, { from: 90000, to: 130000 }, 400, sr), { start: 480 - 10120, fpp: 100, width: 400 });
});

test('Hit → Grid moves the hit onto the nearest line of the snap, or the beat with it off', () => {
  const grid = { frames: 480000, bars: 4 }; // 120000 a bar, 30000 a beat (96 BPM)
  assert.equal(gridMove(120119, grid, 'bar'), -119);
  assert.equal(gridMove(149880, grid, 'beat'), 120);
  assert.equal(gridMove(149880, grid, 'off'), 120);
  assert.equal(gridMove(16000, grid, '8th'), -1000);
  assert.equal(gridMove(5000, null, 'bar'), 0);
});

test('the tape grid as a beat grid', () => {
  assert.deepEqual(beatGrid({ frames: 480000, bars: 4 }, sr), { bpm: 96, sampleRate: sr, downbeat: 0 });
  assert.equal(beatGrid(null, sr).bpm, null);
});

test('the clip heard at a tape frame: the top layer where clips overlap', () => {
  const tr = { clips: [
    { at: 0, src: 0, frames: 48000, layer: 0 },
    { at: 24000, src: 0, frames: 48000, layer: 1 },
  ] };
  assert.equal(clipUnder(tr, 1000, sr).layer, 0);
  assert.equal(clipUnder(tr, 30000, sr).layer, 1);
  assert.equal(clipUnder(tr, 80000, sr), null);
  assert.equal(clipUnder({ clips: [] }, 0, sr), null);
});

test('a moved clip stays on the tape', () => {
  assert.equal(placeAt(clip, -119, 10000000), 99881);
  assert.equal(placeAt(clip, -200000, 10000000), 0);
  assert.equal(placeAt(clip, 9999999, 10000000), 9999999);
  assert.equal(placeAt(clip, 0.6, 10000000), 100001);
});
```

- [ ] **Step 2: See them fail** (`node --test web/static/lib/tape/align.test.js` — cannot find `./align.js`).
- [ ] **Step 3: The module** — `web/static/lib/tape/align.js`:

```js
// web/static/lib/tape/align.js
// Aligning a clip on the tape: where it sounds, how tape frames map to its
// pool file's frames, the view of its file under a tape view, and the moves
// Hit → Grid and Hit → Track make. Pure; node-tested.
import { snapFrame, nudgeFrames } from './geometry.js';

/** soundingAt is the tape frame a clip's first frame is heard at: its at plus its nudge. */
export function soundingAt(clip, sampleRate) {
  return clip.at + nudgeFrames(clip, sampleRate);
}

/** toFile is the clip's pool-file frame heard at tape frame f. */
export function toFile(clip, f, sampleRate) {
  return f - soundingAt(clip, sampleRate) + clip.src;
}

/** toTape is the tape frame where the clip's pool-file frame k is heard. */
export function toTape(clip, k, sampleRate) {
  return k - clip.src + soundingAt(clip, sampleRate);
}

/**
 * fileView is the view of a clip's pool file under a tape view ({from, to})
 * width px wide: { start, fpp, width } in file frames, for the take page's
 * tile cache.
 */
export function fileView(clip, view, width, sampleRate) {
  const fpp = (view.to - view.from) / width;
  return { start: toFile(clip, view.from, sampleRate), fpp, width };
}

/**
 * gridMove is how far Hit → Grid moves a clip whose hit sounds at tape frame
 * hit: to the nearest line of the snap (the beat with the snap off). 0
 * without a grid.
 */
export function gridMove(hit, grid, snap) {
  if (!grid) return 0;
  return snapFrame(grid, hit, snap === 'off' ? 'beat' : snap) - hit;
}

/** beatGrid is the tape grid as the take page's beat maths wants it. */
export function beatGrid(grid, sampleRate) {
  if (!grid) return { bpm: null, sampleRate, downbeat: 0 };
  return { bpm: (grid.bars * 4 * 60 * sampleRate) / grid.frames, sampleRate, downbeat: 0 };
}

/**
 * clipUnder is the clip on a track heard at tape frame f -- the top layer
 * where several are -- or null.
 */
export function clipUnder(track, f, sampleRate) {
  let best = null;
  for (const c of track.clips || []) {
    const s = soundingAt(c, sampleRate);
    if (f >= s && f < s + c.frames && (!best || c.layer > best.layer)) best = c;
  }
  return best;
}

/**
 * placeAt is where a clip moved by delta may go: a whole frame, not before
 * the tape's start, and starting before its end (as a slide allows).
 */
export function placeAt(clip, delta, length) {
  return Math.min(length - 1, Math.max(0, Math.round(clip.at + delta)));
}
```

- [ ] **Step 4: Run** — 6 pass.
- [ ] **Step 5: Commit** — "Clip alignment maths: where a clip sounds, and the two moves".

---

### Task 4: Share the editor bar's gesture core

**Files:**
- Create: `web/static/lib/edit/editor-bar.js`
- Test: `web/static/lib/edit/editor-bar.test.js`
- Modify: `web/static/lib/wave/page.js` (the boundary editor section, ~lines 671–940)

**Interfaces:**
- Produces:

```js
// new EditorBar({ els, host })
//   els:  { zoom, pos, back, fwd, step }        -- the pads, the step keys, the step label
//   host: {
//     active(): boolean,                         -- is something being edited
//     frame(): number | null,                    -- the point
//     place(frame, save): number,                -- show the point at frame; save it if save; answers where it went
//     fpp(): number, follow(fpp?): void,         -- the view's zoom; centre on the point (at fpp)
//     sampleRate: number,
//     render(): void,                            -- redraw the host's readout and view
//   }
// bar.move(frame, final)  -- the dirty-save rule: a non-final move marks the gesture dirty;
//                            a final one saves if it changed anything or the gesture was dirty
// bar.commit()            -- save a gesture in flight (wheel burst, held key, drag)
// bar.wheel(e) → boolean  -- for view.onWheel: moves (or zooms with ⌘/Ctrl), commits after 250 ms
// bar.renderStep()        -- the step label
```

  It owns: `dirty`, the wheel timer and accumulator, the POSITION accumulator (`wholeFrames`), `wirePad` (primary button, capture, cancel, lostpointercapture), the ◂ ▸ clicks, the pads' ←/→ keys (Shift ×10; ZOOM halves/doubles), and the document `keyup` that saves a held key. It imports `zoomBy`, `positionBy`, `stepFrames`, `stepLabel`, `wholeFrames` from `../wave/boundary.js`.

- [ ] **Step 1: Tests for the pure rule.** Export the dirty-save rule as a pure function from `editor-bar.js` — `gestureSave(prev, next, final, dirty) → { save, dirty }` (save = final && (next !== prev || dirty); dirty' = final ? false : dirty || next !== prev) — with a test table covering: a non-final change marks dirty and doesn't save; a final with no change and not dirty doesn't save; a final with no change after a dirty gesture saves; a final change saves and clears dirty.
- [ ] **Step 2: Build `EditorBar`** from the take page's code, moved, not rewritten: `wirePad`, the POSITION/ZOOM pad handlers, `stepBy`, the pads' keydown handlers, the `keyup` saver, `commitEdit` (→ `commit`), the wheel handler body (→ `wheel`), and `moveEdit`'s dirty/save bookkeeping (→ `move`, which calls `host.place(frame, save)` and, when the point moved, `host.follow()` and `host.render()`).
- [ ] **Step 3: The take page uses it.** In `wave/page.js`, construct one `EditorBar` for the boundary editor with a host built from the existing functions: `active: () => !!state.edit`, `frame: editFrame`, `place: (f, save) => { ...the edge-specific part of moveEdit: placeEdge, region/downbeat update, selectionChanged/saveDownbeat when save, the grid-line haptic tick...; return placed }`, `fpp`, `follow`, `render: () => { renderEditor(); redraw(); }`. Replace the moved code with calls to the bar (`bar.move`, `bar.commit`, `view.onWheel = (e) => bar.wheel(e)`, `bar.renderStep()` in `renderEditor`). Keep everything page-specific in `page.js`: Attack/Zero/Grid/Seam, play, Done, the In/Out readouts, `checkEdit`, `startEditing`/`stopEditing`, the resize observer.
- [ ] **Step 4: Run the full node suite** (the boundary editor's tests pass unchanged) and `node --check` both files.
- [ ] **Step 5: Commit** — "Share the editor bar's gesture core". The controller re-runs the take page's editor in the demo after this task.

---

### Task 5: The tape at sample level

**Files:**
- Modify: `web/static/lib/tape/page.js` (`minSpan`; `drawLanes`; tile caches per pool file)
- Modify: `web/static/lib/tape/blocks.js` (if a helper fits there)
- Test: `web/static/lib/tape/blocks.test.js` (a pure helper's test)

**Interfaces:**
- Consumes: `TileCache` with `urlFor` (Task 2); `fileView` (Task 3); `MIN_FPP` from `../edit/gestures.js`; `levelsOfColumns`, `laneChannels` from `../wave/draw.js`; `drawTrace`, `traceLines` from `../wave/tape-strip.js`.
- Produces: `needsDetail(clip, pd, view, width) → boolean` in `blocks.js`: true when the whole-file peaks' frames per bucket exceed the view's frames per pixel × 2 (`(pd.duration * pd.sample_rate / pd.buckets) > 2 * (view.to - view.from) / width`).

- [ ] **Step 1: A test for `needsDetail`.** A 10 s file at 48 kHz with 1024 buckets has 468.75 frames a bucket. Viewing 1 s across 400 px (120 frames/px, ×2 = 240 < 468.75) → `true`; viewing 10 s across 400 px (1200 frames/px, ×2 = 2400 > 468.75) → `false`. Use `pd = { duration: 10, sample_rate: 48000, buckets: 1024 }`, views `{from: 0, to: 48000}` and `{from: 0, to: 480000}`, width 400. See it fail, then implement it.
- [ ] **Step 2: The zoom floor.** `minSpan` becomes `() => Math.max(1, Math.round(MIN_FPP * laneWidth()))` where `laneWidth()` is the lane canvas's CSS width — the take page's 8 px per sample.
- [ ] **Step 3: Tiles per pool file.** Keep a `Map` from pool file to a `TileCache` (created on first need, with `urlFor: (f, t, b) => \`/api/tapes/peaks?file=${encodeURIComponent(file)}&from=${f}&to=${t}&buckets=${b}\``, `totalFrames` from the whole-file peaks (`Math.round(pd.duration * pd.sample_rate)`), `filePeaks: pd`, `onChange: drawLanes`). Drop caches for files no longer on the tape when the tape changes.
- [ ] **Step 4: Draw the detail.** In `drawLanes`, for a clip on screen whose `needsDetail(...)` is true and whose whole-file peaks are loaded: get `cols` from its cache's `columns(fileView(c, view, W, sr), dpr)`, clip the drawing to the block's x-range and the clip's own file span (`src` to `src + frames`), and draw the clip as a trace (`traceLines`/`drawTrace` with `levelsOfColumns`, one lane per channel as `laneChannels` gives, inside the block's height) in the track's colour, the lit part to the heard playhead as the bars do. Otherwise draw the bars as now. While a tile loads, `columns()` answers the coarsest it has, so nothing flickers to empty.
- [ ] **Step 5: Run the node suite and `node --check`.**
- [ ] **Step 6: Commit** — "The tape zooms to the sample, and clips draw their detail". The controller checks it in the demo.

---

### Task 6: The clip editor

**Files:**
- Modify: `web/static/tape.html` (Align in the clip sheet; the editor bar block)
- Modify: `web/static/styles.css` (the bar on the tape page; the track picker)
- Modify: `web/static/lib/tape/page.js`

**Interfaces:**
- Consumes: `EditorBar` (Task 4), `align.js` (Task 3), `NearAudio` with `urlFor` (Task 2), `findAttack` from `../wave/onset.js`, `fmtSample`, `beatOffset`, `fmtOffset`, `viewAbout`, `snapRadius` from `../wave/boundary.js`.
- Produces: page state `state.align = null | { clipId, hitOff, at, ref }` — `hitOff` the first hit's offset from the clip's sounding start (frames), `at` the previewed `at` while a gesture runs, `ref` the reference track number or null.

- [ ] **Step 1: Markup.** In the clip sheet (`#clip-sheet`), an **Align** button (`id="clip-align"`, `data-tip="clip-align"`). In `tape.html`, an editor bar block (`id="clip-editor"`, `class="boundary-editor"`, hidden) with the same pieces and classes as the take page's (`#boundary-readout`-style readout `id="ce-readout"`, Done `id="ce-done"`, pads `id="ce-zoom"` / `id="ce-pos"` with `class="be-pad"`, steps `id="ce-back"` / `ce-step` / `ce-fwd`, ▶ `id="ce-play"`) plus **Hit → Grid** (`id="ce-grid"`), a track picker (`id="ce-ref"`, one key per other track, `data-track`, its number, `--track-n` colour, `aria-pressed`), and **Hit → Track** (`id="ce-track"`). Tips ids: `ce-open` (on Align), `ce-done`, `ce-zoom`, `ce-pos`, `ce-step`, `ce-play`, `ce-grid`, `ce-ref`, `ce-track`. While open, the bar takes the place of the tape toolbar's rows (as on the take page: a class on the toolbar hiding its `.tb-row`s).
- [ ] **Step 2: Opening.** Align → close the sheet; find the first hit: `NearAudio` for the clip's pool file (`urlFor` the tape slice; `total` from its peaks) around file frame `clip.src`, `findAttack(x, sr, clip.src - from, Math.round(sr * 0.06))`; `hitOff = j < 0 ? 0 : (from + j) - clip.src` (frames from the clip's sounding start). `state.align = { clipId, hitOff, at: clip.at, ref: null }`; centre the view on the point (`soundingAt(clip with at) + hitOff`) with `viewAbout` converted to the tape view `{from, to}`; render; focus POSITION.
- [ ] **Step 3: The host for `EditorBar`.**
  - `frame()` → the point: `soundingAt({ ...clip, at: state.align.at }, sr) + hitOff`.
  - `place(f, save)` → `at = placeAt(clip, f - point, tape.length)`; `state.align.at = at` (the lane draws the clip at the previewed `at`, the way a slide in progress draws); when `save` and `at !== clip.at`, `POST /api/tapes/edit?id=` `{op: 'slide', clip: clip.id, at}` through the page's existing edit call (so undo and the refreshed tape follow as for a slide); answer the new point.
  - `fpp()`/`follow(fpp)` in the tape's `{from, to}` view: `fpp = (to - from) / laneWidth`; follow centres with `viewAbout` (frames) and converts back; it sets the tape page's zoom state the way a pinch does.
  - `render()` → the readout: `Clip <track>.<n> <fmtSample(point)> · <fmtOffset(beatOffset(point, beatGrid(grid, sr)))>` and, with a reference, ` · <±x.x ms> from track <r>` once Hit → Track has a reference hit to compare (else nothing); `bar.renderStep()`; redraw the lanes.
- [ ] **Step 4: Hit → Grid.** `bar.move(point + gridMove(point, grid, state.snap), true)`. Hidden without a grid.
- [ ] **Step 5: Hit → Track.** The picker sets `state.align.ref`. Hit → Track: `ref` clip = `clipUnder(tape.tracks[ref - 1], point, sr)`; none → toast *"Track r has nothing here"*. Else fetch its pool audio round `toFile(refClip, point, sr)` (a second `NearAudio` keyed by file — keep a small `Map` of them), `findAttack` with `snapRadius('attack', sr, view)` (min 60 ms, half the visible span); `-1` → toast *"No hit near here on track r"*; else `refHit = toTape(refClip, from + j, sr)` and `bar.move(refHit, true)`. Hidden until a reference is picked; the picker lists the other tracks only.
- [ ] **Step 6: The rest.** ▶ plays the tape from a second before the point and pauses (the tape transport: `locate` then `play`, or pause when playing; show ❚❚ while playing). Done / Escape close (committing a gesture in flight first: `bar.commit()`); the clip's removal (another device, undo) closes it. The wheel over the lanes: `bar.wheel(e)` while open (the tape page's own wheel zoom/pan otherwise).
- [ ] **Step 7: Run the node suite, `node --check`, `CGO_ENABLED=0 go test ./internal/api/`.** Add the tip rows now, with the text in Task 7's Step 1, to both `tips.js` and the guide's tips table, identical, so the help test stays green; Task 7 then writes only the guide's prose.
- [ ] **Step 8: Commit** — "Align a clip on the tape: the editor bar, Hit → Grid, Hit → Track".

---

### Task 7: Guide and tips

**Files:** `docs/guide.md` (§8, the tape page), `web/static/lib/help/tips.js`, and the guide's tips table.

- [ ] **Step 1: Tips** — added in Task 6 Step 7 with this text (both files, identical, after the clip sheet's rows); check they're there: `Align` (`clip-align`/`ce-open`): *Line the clip up to the sample: the editor bar opens on its first hit*; `Done` (`ce-done`): *Close the editor. Esc does too*; `ZOOM` (`ce-zoom`) and `POSITION` (`ce-pos`) as on the take page, POSITION moving the whole clip; `◂ ▸ on the tape` (`ce-step`): *Move the clip a millisecond, or a sample when zoomed right in*; `▶ on the tape` (`ce-play`): *Play from a second before the hit, or pause*; `Hit → Grid` (`ce-grid`): *Move the clip so its first hit lands on the nearest line of the Snap setting, or the nearest beat with Snap off*; `Track picker` (`ce-ref`): *Choose the track to line this clip up against*; `Hit → Track` (`ce-track`): *Move the clip so its hit lands on the nearest hit of the chosen track*.
- [ ] **Step 2: Prose** in §8: a short "Lining clips up exactly" paragraph — zoom the lanes to the sample; tap a clip, Align; the bar's ZOOM/POSITION/steps move the whole clip; Hit → Grid for a catch at the tape's tempo; pick a track and Hit → Track for an overdub; a clip's nudge is kept and counted. Plus a short "Checks — lining clips up" list in the guide's `[demo]` / `[rig]` style from the spec.
- [ ] **Step 3: Run the node suite and `CGO_ENABLED=0 go test ./internal/api/`.** Commit — "Guide: lining clips up exactly".

---

### Task 8: Check it in the demo

**Files:** none, unless a check fails. The controller runs this.

- [ ] Run the demo on an unused port (check `lsof` and the process's cwd; other sessions run demos too).
- [ ] The take page's boundary editor still passes its #24 checks (In, ZOOM/POSITION, Attack on the kick, Seam, one drag one undo, Done).
- [ ] The tape: zoom the lanes to single samples; every clip draws a trace with sample detail; zooming out returns to bars.
- [ ] Catch a pass onto track 2; Align → the view centres on its first hit; Hit → Grid → the readout says *on* a beat; ↶ undoes it in one step.
- [ ] Nudge a clip on track 2 +7 ms; Align; pick track 1; Hit → Track → the readout's offset from track 1 is under 0.1 ms; the clip's nudge still reads +7 ms in its sheet.
- [ ] Hit → Track with nothing on the reference track at the point → a toast, nothing moved.
- [ ] A clip moved to the tape's start clamps at 0 without an error.
- [ ] 390 px: the bar fits; no sideways scroll; console clean. Stop the demo by its port.
