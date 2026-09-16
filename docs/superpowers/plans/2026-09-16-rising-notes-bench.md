# Rising Notes and the Tablet Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A canvas view on the take page where every MIDI note rises out of a keyboard (or a drum pad) as it sounds, filling the right of a two-column bench on a tablet and opening fullscreen from a header button on a phone.

**Architecture:** One new browser module, `web/static/lib/wave/rising.js`, with pure tested geometry on top and a `RisingNotes` class owning one canvas below, in the same shape as `lanes.js`. It reads time from the page's one `Clock` (`clock.position()`) and draws per animation frame while playing. The page (`page.js`) builds it from the same `/api/midi` response the lanes use, and CSS turns the page into a bench at 860px. No Go changes.

**Tech Stack:** Vanilla ES modules, Canvas 2D, `node --test` for the pure geometry (CI runs `node --test 'web/static/lib/wave/*.test.js'`). No build step: files are served as written.

**Spec:** `docs/superpowers/specs/2026-09-16-rising-notes-bench-design.md`

## Global Constraints

- No web fonts: `var(--font)` for UI text, `var(--mono)` for readouts and key labels.
- Tap targets are `var(--tap)` = 48px; the chips here are 40px tall like `.icon-btn`, which the project accepts for secondary controls.
- Colours come from CSS custom properties read at paint time (`--bg`, `--panel`, `--panel-2`, `--line`, `--ink`, `--ink-dim`, `--ink-faint`), with the hex fallbacks used in `lanes.js`. Track colours are `laneColors(tracks)` and velocity alpha is `alphaFor(v)`, both imported from `./lanes.js`, so a track is the same colour everywhere.
- `[hidden] { display: none !important }` is already global in `styles.css`; toggling `el.hidden` is the way to show and hide.
- Bench breakpoint is `min-width: 860px`, the project's existing rule. Test on a 1024×600 tablet and a 390-wide phone.
- Every commit message ends with the two attribution lines given in the session (`Co-Authored-By` and `Claude-Session`).
- Run `node --test 'web/static/lib/wave/*.test.js'` before every commit; all six existing test files must still pass.

Deviation from the spec, decided while planning: pads are a **row** at the left end of the keyboard (one pad per drum pitch, lowest on the left, each `padW` wide and `KEY_H` tall), not a stacked column. A stacked column had no way for a hit to rise "out of" a pad that sits under another pad. `padW` is `clamp(12, floor(0.2 · width / npads), 32)` px, which gives the artboard's ~126px column for eight pads on the tablet.

---

### Task 1: `Clock.setRate` — playback speed on the preview engine

**Files:**
- Modify: `web/static/lib/wave/clock.js` (constructor fields around line 21; add a method after `pause()`)

**Interfaces:**
- Produces: `clock.setRate(rate: number): void` and `clock.rate: number` (default 1). Applies to the preview `<audio>` only; a slice loop plays at 1× regardless, as the spec says.

There is no node test for `clock.js` (it wraps `Audio` and `AudioContext`); this task is verified by Task 6's hardware check.

- [ ] **Step 1: Add the field and the method**

In the constructor, after `this.pendingFetch = 0;` add:

```js
    // Playback speed of the preview engine. The slice engine ignores it: a
    // loop is for hearing the cut exactly, and pitch-preserved 0.5× through
    // an AudioBufferSourceNode is not something the browser gives us.
    this.rate = 1;
    this.audio.preservesPitch = true;
```

After the `pause()` method add:

```js
  /** 0.5, 1 or 2: the preview plays at this speed; a slice loop stays at 1×. */
  setRate(rate) {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }
```

- [ ] **Step 2: Run the existing tests**

Run: `node --test 'web/static/lib/wave/*.test.js'`
Expected: all pass (nothing tests clock.js; this confirms the module still parses under the other imports).

- [ ] **Step 3: Commit**

```bash
git add web/static/lib/wave/clock.js
git commit -m "Clock.setRate: preview playback speed, pitch preserved"
```

---

### Task 2: Keyboard window, key layout, pad layout, tempo lookup

**Files:**
- Create: `web/static/lib/wave/rising.js`
- Create: `web/static/lib/wave/rising.test.js`

**Interfaces:**
- Consumes: `alphaFor`, `laneColors` from `./lanes.js` (imported now; used in Task 3).
- Produces:
  - constants `PX_PER_BEAT = 44`, `KEY_H = 88`, `KEY_H_SHORT = 72`, `CHIP_H = 40`, `KEYS = 48`, `FALLBACK_BPM = 120`, `GM_NAMES`
  - `isBlack(p: number): boolean`
  - `keyWindow(tracks): { lo: number, hi: number }` — `hi === lo + 47`, `lo` a multiple of 12 in `0..84`
  - `keyLayout(lo: number, width: number, keys = KEYS): { lo, hi, whites: Key[], blacks: Key[], ww: number, xFor(p): Key }` where `Key = { p, x, w, black }`; `xFor` clamps `p` into `[lo, hi]`
  - `padLayout(tracks, cap = 8): { pads: Pad[], colFor(p): number }` where `Pad = { p, label, short, col }`, `col` 0-based from the left in ascending pitch; `colFor` returns −1 with no pads, else the nearest kept pitch's column
  - `padWidth(width: number, npads: number): number`
  - `bpmAt(tempo: {frame, bpm}[], frame: number, fallback = FALLBACK_BPM): number`

- [ ] **Step 1: Write the failing tests**

Create `web/static/lib/wave/rising.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, PX_PER_BEAT, FALLBACK_BPM, isBlack, keyWindow, keyLayout, padLayout, padWidth, bpmAt,
} from './rising.js';

const mel = (ps, kind = 'notes') => ({ name: 'm', kind, notes: ps.map((p, i) => ({ s: i * 4800, e: i * 4800 + 2400, p, v: 100 })) });

test('isBlack follows the piano', () => {
  assert.equal(isBlack(60), false); // C
  assert.equal(isBlack(61), true);  // C#
  assert.equal(isBlack(64), false); // E
  assert.equal(isBlack(65), false); // F
  assert.equal(isBlack(66), true);  // F#
  assert.equal(isBlack(71), false); // B
});

test('keyWindow: no melodic notes gives C2..B5', () => {
  assert.deepEqual(keyWindow([]), { lo: 36, hi: 83 });
  assert.deepEqual(keyWindow([mel([36, 38, 42], 'drums')]), { lo: 36, hi: 83 });
});

test('keyWindow: a bass range sits on the C at or below lo-2', () => {
  assert.deepEqual(keyWindow([mel([40, 45, 52])]), { lo: 36, hi: 83 });
  assert.deepEqual(keyWindow([mel([84, 90, 96])]), { lo: 72, hi: 119 });
  // lo-2 crossing a C boundary: 49-2 = 47 -> C is 36
  assert.deepEqual(keyWindow([mel([49])]), { lo: 36, hi: 83 });
});

test('keyWindow: a span wider than four octaves centres on the range', () => {
  const w = keyWindow([mel([24, 96])]);
  assert.equal(w.hi - w.lo + 1, KEYS);
  assert.equal(w.lo % 12, 0);
  assert.deepEqual(w, { lo: 36, hi: 83 });
});

test('keyWindow never leaves MIDI range', () => {
  assert.deepEqual(keyWindow([mel([120, 127])]), { lo: 84, hi: 131 }); // keys past G9 are drawn empty
  assert.deepEqual(keyWindow([mel([0, 1])]), { lo: 0, hi: 47 });
});

test('keyLayout: 28 whites across four octaves from a C, blacks between their neighbours', () => {
  const k = keyLayout(36, 280);
  assert.equal(k.whites.length, 28);
  assert.equal(k.blacks.length, 20);
  assert.equal(k.ww, 10);
  const cs = k.xFor(37); // C#2
  const c = k.xFor(36), d = k.xFor(38);
  assert.ok(cs.black);
  assert.ok(cs.x > c.x && cs.x + cs.w < d.x + d.w);
  assert.ok(cs.x + cs.w / 2 > c.x + c.w - 1e-9 && cs.x + cs.w / 2 < d.x + 1e-9);
  assert.equal(k.xFor(83).x + k.xFor(83).w, 280);
});

test('keyLayout: xFor clamps out-of-window pitches to the edge keys', () => {
  const k = keyLayout(36, 280);
  assert.deepEqual(k.xFor(20), k.xFor(36));
  assert.deepEqual(k.xFor(100), k.xFor(83));
});

test('padLayout: pads are the eight most-played pitches, ascending left to right', () => {
  const notes = [];
  const pitches = [36, 38, 42, 46, 41, 43, 45, 49, 51]; // nine
  pitches.forEach((p, i) => { for (let n = 0; n < (p === 51 ? 1 : 3); n++) notes.push({ s: n * 100 + i, e: n * 100 + i + 10, p, v: 100 }); });
  const { pads, colFor } = padLayout([{ name: 'd', kind: 'drums', notes }]);
  assert.equal(pads.length, 8);
  assert.deepEqual(pads.map((p) => p.p), [36, 38, 41, 42, 43, 45, 46, 49]);
  assert.deepEqual(pads.map((p) => p.col), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(colFor(51), 7); // the dropped ride maps to the nearest kept pitch, the crash
  assert.equal(colFor(36), 0);
  assert.equal(pads[0].label, 'kick');
  assert.equal(pads[0].short, 'BD');
  assert.equal(padLayout([{ name: 'd', kind: 'drums', notes: [{ s: 0, e: 1, p: 77, v: 1 }] }]).pads[0].label, '#77');
});

test('padLayout: no drum tracks means no pads', () => {
  const { pads, colFor } = padLayout([mel([60])]);
  assert.equal(pads.length, 0);
  assert.equal(colFor(36), -1);
});

test('padWidth: a fifth of the width shared out, 12..32 each', () => {
  assert.equal(padWidth(640, 8), 16);
  assert.equal(padWidth(390, 8), 12);
  assert.equal(padWidth(1200, 2), 32);
  assert.equal(padWidth(640, 0), 0);
});

test('bpmAt: the entry at or before the frame, the first before any, the fallback when empty or absurd', () => {
  const tempo = [{ frame: 1000, bpm: 90 }, { frame: 5000, bpm: 120 }];
  assert.equal(bpmAt(tempo, 0), 90);
  assert.equal(bpmAt(tempo, 1000), 90);
  assert.equal(bpmAt(tempo, 4999), 90);
  assert.equal(bpmAt(tempo, 5000), 120);
  assert.equal(bpmAt(tempo, 1e9), 120);
  assert.equal(bpmAt([], 0), FALLBACK_BPM);
  assert.equal(bpmAt(null, 0), FALLBACK_BPM);
  assert.equal(bpmAt([{ frame: 0, bpm: 0 }], 10), FALLBACK_BPM);
  assert.equal(bpmAt([{ frame: 0, bpm: 661 }], 10), FALLBACK_BPM);
  assert.equal(PX_PER_BEAT, 44);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/static/lib/wave/rising.test.js`
Expected: FAIL — `Cannot find module './rising.js'`.

- [ ] **Step 3: Write the module**

Create `web/static/lib/wave/rising.js`:

```js
// web/static/lib/wave/rising.js
// Rising notes: a keyboard and a row of drum pads at the foot of a canvas,
// and every note that sounds grows *out of* its key and rises away. The
// view shows the past, a bar or two deep -- what was just played -- which is
// what reviewing your own take is for. Geometry up top is pure and tested
// under `node --test`; the RisingNotes class at the bottom owns the canvas.
import { alphaFor, laneColors } from './lanes.js';

export const PX_PER_BEAT = 44;
export const KEY_H = 88;
export const KEY_H_SHORT = 72;   // a short phone screen
export const CHIP_H = 40;
export const KEYS = 48;          // four octaves
export const FALLBACK_BPM = 120; // a take with no tempo scrolls at 2 beats/s
export const MIN_DRUM_PX = 6;
export const GLOW_BEATS = 1;     // a key's colour decays over one beat after note-off
export const PAD_FLASH_BEATS = 0.3;
const MAX_BPM = 400;

export const GM_NAMES = {
  36: ['kick', 'BD'], 38: ['snare', 'SD'], 42: ['closed hat', 'HH'], 46: ['open hat', 'OH'],
  41: ['floor tom', 'T4'], 43: ['floor tom', 'T4'], 45: ['low tom', 'T3'], 47: ['mid tom', 'T2'],
  48: ['mid tom', 'T2'], 50: ['high tom', 'T1'], 49: ['crash', 'CR'], 51: ['ride', 'RD'],
};

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
export function isBlack(p) { return !WHITE.has(((p % 12) + 12) % 12); }

/**
 * Four octaves, C-aligned, around the melodic pitch range. Empty: C2..B5.
 * A range that does not fit from the C at or below lo-2 is centred instead.
 */
export function keyWindow(tracks) {
  let lo = Infinity, hi = -Infinity;
  for (const t of tracks) {
    if (t.kind === 'drums') continue;
    for (const n of t.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  }
  if (lo === Infinity) return { lo: 36, hi: 83 };
  let klo = Math.floor((lo - 2) / 12) * 12;
  if (hi > klo + KEYS - 1) klo = Math.round(((lo + hi) / 2 - KEYS / 2) / 12) * 12;
  // Stays C-aligned even at the ends: a window may run past pitch 127,
  // and those keys are simply never lit.
  klo = Math.max(0, Math.min(84, klo));
  return { lo: klo, hi: klo + KEYS - 1 };
}

/**
 * Key rectangles across `width` CSS px, x from 0. Whites are equal columns;
 * blacks sit over the join at 62% width. xFor clamps to the edge keys so an
 * out-of-window pitch still lands somewhere visible.
 */
export function keyLayout(lo, width, keys = KEYS) {
  const hi = lo + keys - 1;
  let nWhite = 0;
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) nWhite++;
  const ww = width / Math.max(1, nWhite);
  const bw = ww * 0.62;
  const whites = [], blacks = [], byPitch = new Map();
  let i = 0;
  for (let p = lo; p <= hi; p++) {
    if (!isBlack(p)) {
      const k = { p, x: i * ww, w: ww, black: false };
      whites.push(k); byPitch.set(p, k); i++;
    } else {
      const k = { p, x: Math.max(0, i * ww - bw / 2), w: bw, black: true };
      blacks.push(k); byPitch.set(p, k);
    }
  }
  const xFor = (p) => byPitch.get(Math.max(lo, Math.min(hi, p)));
  return { lo, hi, whites, blacks, ww, xFor };
}

/**
 * One pad per distinct drum pitch, the `cap` most-played kept, ascending
 * left to right. colFor maps any pitch to the nearest kept pad's column.
 */
export function padLayout(tracks, cap = 8) {
  const counts = new Map();
  for (const t of tracks) {
    if (t.kind !== 'drums') continue;
    for (const n of t.notes) counts.set(n.p, (counts.get(n.p) || 0) + 1);
  }
  const kept = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, cap)
    .map(([p]) => p)
    .sort((a, b) => a - b);
  const pads = kept.map((p, col) => {
    const gm = GM_NAMES[p];
    return { p, label: gm ? gm[0] : `#${p}`, short: gm ? gm[1] : String(p), col };
  });
  const colFor = (p) => {
    if (!kept.length) return -1;
    let best = 0;
    for (let i = 1; i < kept.length; i++) if (Math.abs(kept[i] - p) < Math.abs(kept[best] - p)) best = i;
    return best;
  };
  return { pads, colFor };
}

/** Each pad's width: a fifth of the canvas shared out, never under 12 or over 32. */
export function padWidth(width, npads) {
  if (!npads) return 0;
  return Math.max(12, Math.min(32, Math.floor((0.2 * width) / npads)));
}

/** The tempo in force at `frame`: the last entry at or before it, the first before any. */
export function bpmAt(tempo, frame, fallback = FALLBACK_BPM) {
  if (!tempo || !tempo.length) return fallback;
  let bpm = tempo[0].bpm;
  for (const t of tempo) { if (t.frame <= frame) bpm = t.bpm; else break; }
  if (!(bpm > 0) || bpm > MAX_BPM) return fallback;
  return bpm;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test web/static/lib/wave/rising.test.js`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/wave/rising.js web/static/lib/wave/rising.test.js
git commit -m "Rising notes geometry: keyboard window and layout, pads, tempo lookup"
```

---

### Task 3: Note bars and key glow for one frame

**Files:**
- Modify: `web/static/lib/wave/rising.js` (append after `bpmAt`)
- Modify: `web/static/lib/wave/rising.test.js` (append)

**Interfaces:**
- Consumes: `keyLayout`, `padLayout`, `alphaFor`, `PX_PER_BEAT`, `MIN_DRUM_PX`, `GLOW_BEATS`, `PAD_FLASH_BEATS` from Task 2.
- Produces:
  - `lowerBound(notes, frame): number` — first index with `notes[i].s >= frame`
  - `trackMaxLen(track): number` — longest note in frames, cached per track object
  - `noteBars(tracks, now, geo): Bar[]` where `geo = { fpb, keyTop, riseH, keys, pads, padW, padCol, muted: Set<string>, colors: string[] }` and `Bar = { x, w, y0, y1, alpha, color, drum: boolean, clamp: -1|0|1 }` (`y0 < y1`, y down the canvas, `y1 === keyTop` while sounding)
  - `glow(tracks, now, geo): { keys: Map<pitch, {alpha, color}>, pads: Map<col, {alpha, color}> }`
  - `yAt(frame, now, fpb, keyTop): number`

- [ ] **Step 1: Write the failing tests**

Append to `web/static/lib/wave/rising.test.js`:

```js
import { lowerBound, trackMaxLen, noteBars, glow, yAt, MIN_DRUM_PX, KEY_H } from './rising.js';
import { alphaFor, laneColors } from './lanes.js';

// 48 kHz, 120 bpm: 24000 frames per beat. Canvas 640 wide, keyboard top at
// y=400 (so riseH = 400 ≈ 9.09 beats), 8 drum pads 16px each = 128px column.
function geoFor(tracks) {
  const pads = padLayout(tracks);
  const padW = padWidth(640, pads.pads.length);
  const padCol = padW * pads.pads.length;
  return {
    fpb: 24000, keyTop: 400, riseH: 400,
    keys: keyLayout(keyWindow(tracks).lo, 640 - padCol), pads, padW, padCol,
    muted: new Set(), colors: laneColors(tracks),
  };
}
const melodic = { name: 'bento ch2', kind: 'notes', notes: [
  { s: 0, e: 24000, p: 60, v: 127 },       // one beat, C4
  { s: 48000, e: 72000, p: 64, v: 64 },    // E4, beats 2..3
  { s: 96000, e: 480000, p: 20, v: 100 },  // below the window, held 16 beats
  { s: 500000, e: 524000, p: 62, v: 100 }, // in the future for every `now` below
] };
const drums = { name: 'bento ch1', kind: 'drums', notes: [
  { s: 0, e: 480, p: 36, v: 127 },
  { s: 24000, e: 24480, p: 38, v: 64 },
] };

test('yAt: the keyboard top is now, one beat ago is PX_PER_BEAT above it', () => {
  assert.equal(yAt(24000, 24000, 24000, 400), 400);
  assert.equal(yAt(0, 24000, 24000, 400), 400 - PX_PER_BEAT);
});

test('lowerBound and trackMaxLen', () => {
  assert.equal(lowerBound(melodic.notes, 0), 0);
  assert.equal(lowerBound(melodic.notes, 1), 1);
  assert.equal(lowerBound(melodic.notes, 48000), 1);
  assert.equal(lowerBound(melodic.notes, 1e9), 4);
  assert.equal(trackMaxLen(melodic), 384000);
  assert.equal(trackMaxLen({ name: 'x', kind: 'notes', notes: [] }), 0);
});

test('noteBars: a sounding note is anchored to the keyboard and grows with time', () => {
  const geo = geoFor([melodic]);
  const at = (now) => noteBars([melodic], now, geo).filter((b) => !b.drum);
  const half = at(12000);
  assert.equal(half.length, 1);
  assert.equal(half[0].y1, 400);
  assert.ok(Math.abs(half[0].y0 - (400 - PX_PER_BEAT / 2)) < 1e-9);
  assert.equal(half[0].alpha, alphaFor(127));
  assert.equal(half[0].clamp, 0);
  assert.equal(half[0].color, laneColors([melodic])[0]);
  const c4 = geo.keys.xFor(60);
  assert.equal(half[0].x, c4.x + geo.padCol);
  assert.equal(half[0].w, c4.w);
});

test('noteBars: a finished note lifts off and fades as it rises', () => {
  const geo = geoFor([melodic]);
  const bars = noteBars([melodic], 48000, geo).filter((b) => !b.drum); // C4 ended one beat ago; E4 starts now
  const c4 = bars.find((b) => b.x === geo.keys.xFor(60).x + geo.padCol);
  assert.ok(c4);
  assert.ok(c4.y1 < 400);
  assert.ok(Math.abs(c4.y1 - (400 - PX_PER_BEAT)) < 1e-9);
  assert.ok(Math.abs((c4.y1 - c4.y0) - PX_PER_BEAT) < 1e-9);
  assert.ok(c4.alpha < alphaFor(127) && c4.alpha > 0);
  const e4 = bars.find((b) => b.x === geo.keys.xFor(64).x + geo.padCol);
  assert.ok(e4 && e4.y1 === 400);
});

test('noteBars: nothing from the future, nothing past the top, nothing from a muted track', () => {
  const geo = geoFor([melodic]);
  assert.equal(noteBars([melodic], 100000, geo).some((b) => b.x === geo.keys.xFor(62).x + geo.padCol), false);
  // 30 beats later the C4 bar (ended at beat 1) is far above the top and gone
  const late = noteBars([melodic], 24000 * 31, geo);
  assert.equal(late.some((b) => b.x === geo.keys.xFor(60).x + geo.padCol), false);
  const muted = { ...geo, muted: new Set(['bento ch2']) };
  assert.equal(noteBars([melodic], 12000, muted).length, 0);
});

test('noteBars: a long note whose start has risen off the top is still drawn from y=0', () => {
  const geo = geoFor([melodic]);
  const bars = noteBars([melodic], 96000 + 24000 * 12, geo); // 12 beats into the 16-beat low note
  const low = bars.find((b) => b.clamp === -1);
  assert.ok(low, 'the below-window note is present, clamped to the low edge');
  assert.equal(low.y0, 0);
  assert.equal(low.y1, 400);
  assert.equal(low.x, geo.keys.xFor(geo.keys.lo).x + geo.padCol);
});

test('noteBars: drum hits rise from their pad column and are never thinner than MIN_DRUM_PX', () => {
  const tracks = [drums, melodic];
  const geo = geoFor(tracks);
  const hit = noteBars(tracks, 240, geo).filter((b) => b.drum); // kick sounding, 240 of 480 frames in
  assert.equal(hit.length, 1);
  assert.equal(hit[0].x, 0 * geo.padW);
  assert.equal(hit[0].w, geo.padW);
  assert.equal(hit[0].y1, 400);
  assert.equal(hit[0].y1 - hit[0].y0, MIN_DRUM_PX);
  const snare = noteBars(tracks, 24480, geo).filter((b) => b.drum).find((b) => b.x === 1 * geo.padW);
  assert.ok(snare);
  assert.equal(snare.color, laneColors(tracks)[0]);
});

test('glow: full at note-off, gone one beat later, the stronger of two wins; pads flash 0.3 beat', () => {
  const tracks = [drums, melodic];
  const geo = geoFor(tracks);
  const on = glow(tracks, 12000, geo);
  assert.equal(on.keys.get(60).alpha, alphaFor(127));
  assert.ok(Math.abs(glow(tracks, 24000, geo).keys.get(60).alpha - alphaFor(127)) < 1e-9);
  assert.ok(Math.abs(glow(tracks, 36000, geo).keys.get(60).alpha - alphaFor(127) / 2) < 1e-9);
  assert.equal(glow(tracks, 48000, geo).keys.has(60), false);
  const two = { name: 'two', kind: 'notes', notes: [{ s: 0, e: 100, p: 60, v: 10 }, { s: 0, e: 100, p: 60, v: 127 }] };
  assert.equal(glow([two], 50, geoFor([two])).keys.get(60).alpha, alphaFor(127));
  assert.equal(on.pads.has(0), false); // the kick's flash ended 0.3 beat after its note-off at 480
  assert.equal(glow(tracks, 240, geo).pads.get(0).alpha, alphaFor(127));
  assert.equal(glow(tracks, 480 + 0.3 * 24000 + 1, geo).pads.has(0), false);
  const muted = { ...geo, muted: new Set(['bento ch2']) };
  assert.equal(glow(tracks, 12000, muted).keys.has(60), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/static/lib/wave/rising.test.js`
Expected: FAIL — `does not provide an export named 'lowerBound'`.

- [ ] **Step 3: Append the frame geometry**

Append to `web/static/lib/wave/rising.js`:

```js
// ---------------------------------------------------------------- per frame

/** y of a frame on the canvas: the keyboard top is `now`, the past is above. */
export function yAt(frame, now, fpb, keyTop) {
  return keyTop - ((now - frame) / fpb) * PX_PER_BEAT;
}

/** First index whose start is at or after `frame`. Notes are sorted by s. */
export function lowerBound(notes, frame) {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].s < frame) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Notes are sorted by start, not end, so the oldest bar still on screen can
// have started long before the visible window (a held chord). Scanning from
// `now - horizon - longest note` covers it; the length is computed once.
const maxLenCache = new WeakMap();
export function trackMaxLen(track) {
  let m = maxLenCache.get(track);
  if (m == null) {
    m = 0;
    for (const n of track.notes) if (n.e - n.s > m) m = n.e - n.s;
    maxLenCache.set(track, m);
  }
  return m;
}

/**
 * Every bar to draw for one frame. A sounding note is anchored at keyTop and
 * grows upward; a finished note has lifted off and fades to nothing by the
 * time its bottom edge reaches the top. Drums rise from their pad column.
 */
export function noteBars(tracks, now, geo) {
  const { fpb, keyTop, riseH, keys, pads, padW, padCol, muted, colors } = geo;
  const horizon = (riseH / PX_PER_BEAT) * fpb;
  const out = [];
  tracks.forEach((t, ti) => {
    if (muted.has(t.name)) return;
    const color = colors[ti];
    const notes = t.notes;
    for (let i = lowerBound(notes, now - horizon - trackMaxLen(t)); i < notes.length; i++) {
      const n = notes[i];
      if (n.s > now) break;
      if (n.e < now - horizon) continue;
      const sounding = n.e > now;
      const y0 = Math.max(0, yAt(n.s, now, fpb, keyTop));
      const y1 = sounding ? keyTop : yAt(n.e, now, fpb, keyTop);
      if (y1 <= 0) continue;
      let alpha = alphaFor(n.v);
      if (!sounding) alpha *= Math.max(0, 1 - (keyTop - y1) / riseH);
      if (alpha <= 0) continue;
      if (t.kind === 'drums') {
        const col = pads.colFor(n.p);
        if (col < 0) continue;
        const h = Math.max(MIN_DRUM_PX, y1 - y0);
        out.push({ x: col * padW, w: padW, y0: y1 - h, y1, alpha, color, drum: true, clamp: 0 });
      } else {
        const k = keys.xFor(n.p);
        const clamp = n.p < keys.lo ? -1 : n.p > keys.hi ? 1 : 0;
        out.push({ x: k.x + padCol, w: k.w, y0, y1, alpha, color, drum: false, clamp });
      }
    }
  });
  return out;
}

/**
 * How lit each key and pad is: a sounding note's velocity alpha, decaying to
 * nothing over GLOW_BEATS (keys) or PAD_FLASH_BEATS (pads) after note-off.
 * Two notes on one key: the brighter wins.
 */
export function glow(tracks, now, geo) {
  const { fpb, pads, muted, colors } = geo;
  const keysOut = new Map(), padsOut = new Map();
  const put = (map, key, alpha, color) => {
    const cur = map.get(key);
    if (!cur || alpha > cur.alpha) map.set(key, { alpha, color });
  };
  tracks.forEach((t, ti) => {
    if (muted.has(t.name)) return;
    const drum = t.kind === 'drums';
    const tail = (drum ? PAD_FLASH_BEATS : GLOW_BEATS) * fpb;
    const notes = t.notes;
    for (let i = lowerBound(notes, now - tail - trackMaxLen(t)); i < notes.length; i++) {
      const n = notes[i];
      if (n.s > now) break;
      if (n.e + tail < now) continue;
      const base = alphaFor(n.v);
      const alpha = n.e > now ? base : base * (1 - (now - n.e) / tail);
      if (alpha <= 0) continue;
      if (drum) {
        const col = pads.colFor(n.p);
        if (col >= 0) put(padsOut, col, alpha, colors[ti]);
      } else {
        put(keysOut, n.p, alpha, colors[ti]);
      }
    }
  });
  return { keys: keysOut, pads: padsOut };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test web/static/lib/wave/rising.test.js`
Expected: all 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/wave/rising.js web/static/lib/wave/rising.test.js
git commit -m "Rising notes: bars and glow for one frame, past only, fading as they rise"
```

---

### Task 4: The `RisingNotes` canvas class and the chip row

**Files:**
- Modify: `web/static/lib/wave/rising.js` (append at the end)

**Interfaces:**
- Consumes: everything from Tasks 2 and 3; `laneColors` from `./lanes.js`; the page's `Clock` via `getClock()` (needs `position()`, `setRate()`, `rate`, `sr`) and page state via `getState()` (`grid.downbeat`, `grid.sampleRate`).
- Produces:
  ```js
  new RisingNotes({ canvas, chips, tracks, tempo, sampleRate, getState, getClock, storageKey })
  rn.start()          // begin drawing every animation frame (while playing)
  rn.stop()           // stop the loop
  rn.draw()           // paint one frame soon (no-op while the loop runs)
  rn.running          // boolean
  rn.destroy()
  ```
  `chips` is the `#notes-tracks` element: one `<button class="chip">` per track with `aria-pressed="true"` while muted; plus the speed button is the element passed as `speedButton` (optional; when given, cycles 0.5/1/2 and calls `clock.setRate`).

No node test: this class is DOM and canvas. Verified on hardware in Task 6.

- [ ] **Step 1: Append the class**

Append to `web/static/lib/wave/rising.js`:

```js
// ---------------------------------------------------------------- DOM

const SPEEDS = [0.5, 1, 2];
const fmtSpeed = (r) => `${r}×`;

/**
 * One canvas: chips are built into `chips`, the speed button (if given) is
 * wired to the clock. Reads clock.position() every frame while running;
 * draw() paints a single frame for a paused page.
 */
export class RisingNotes {
  constructor({ canvas, chips, speedButton, tracks, tempo, sampleRate, getState, getClock, storageKey }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chips = chips;
    this.tracks = tracks;
    this.tempo = tempo || [];
    this.sr = sampleRate;
    this.getState = getState;
    this.getClock = getClock;
    this.storageKey = storageKey;
    this.muted = new Set();
    try { this.muted = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch {}
    this.running = false;
    this.raf = 0;
    this.layoutKey = '';
    this.layout = null;
    this.ac = new AbortController();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    this.buildChips(speedButton);
    this.draw();
  }

  destroy() {
    this.stop();
    this.ac.abort();
    this.ro.disconnect();
    this.chips.replaceChildren();
  }

  buildChips(speedButton) {
    const sig = { signal: this.ac.signal };
    this.chips.replaceChildren();
    this.chipEls = this.tracks.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      const sw = document.createElement('span');
      sw.className = 'chip-swatch';
      b.append(sw, document.createTextNode(t.name));
      b.title = 'Tap to mute this track in the view';
      b.addEventListener('click', () => {
        if (this.muted.has(t.name)) this.muted.delete(t.name); else this.muted.add(t.name);
        try { localStorage.setItem(this.storageKey, JSON.stringify([...this.muted])); } catch {}
        this.syncChips();
        this.draw();
      }, sig);
      this.chips.appendChild(b);
      return b;
    });
    this.syncChips();
    if (speedButton) {
      const clock = this.getClock();
      speedButton.textContent = fmtSpeed(clock.rate || 1);
      speedButton.addEventListener('click', () => {
        const c = this.getClock();
        const next = SPEEDS[(SPEEDS.indexOf(c.rate || 1) + 1) % SPEEDS.length];
        c.setRate(next);
        speedButton.textContent = fmtSpeed(next);
      }, sig);
    }
  }

  /** Colours follow the lanes, including a kind flipped after the chips were built. */
  syncChips() {
    const colors = laneColors(this.tracks);
    this.chipEls.forEach((b, i) => {
      b.querySelector('.chip-swatch').style.background = colors[i];
      b.setAttribute('aria-pressed', this.muted.has(this.tracks[i].name) ? 'true' : 'false');
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (!this.running) return;
      this.paint();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  draw() {
    if (this.running || this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }

  // Key window and pads depend on the track kinds, which the lanes can flip
  // under us (hold a lane header); recomputed when the kinds or width change.
  layoutFor(W) {
    const key = `${W}|${this.tracks.map((t) => t.kind).join(',')}`;
    if (key !== this.layoutKey) {
      const pads = padLayout(this.tracks);
      const padW = padWidth(W, pads.pads.length);
      const padCol = padW * pads.pads.length;
      const keys = keyLayout(keyWindow(this.tracks).lo, W - padCol);
      this.layout = { pads, padW, padCol, keys };
      this.layoutKey = key;
      this.syncChips();
    }
    return this.layout;
  }

  paint() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = r.width, H = r.height;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(this.canvas);
    const col = (n, fb) => css.getPropertyValue(n).trim() || fb;

    const st = this.getState();
    const clock = this.getClock();
    const now = clock.position();
    const bpm = bpmAt(this.tempo, now);
    const hasTempo = this.tempo.length > 0 && bpmAt(this.tempo, now, 0) > 0;
    const fpb = (this.sr * 60) / bpm;
    const keyH = H < 480 ? KEY_H_SHORT : KEY_H;
    const keyTop = H - keyH;
    const riseH = keyTop;
    const { pads, padW, padCol, keys } = this.layoutFor(W);
    const geo = { fpb, keyTop, riseH, keys, pads, padW, padCol, muted: this.muted, colors: laneColors(this.tracks) };

    // Ground
    ctx.fillStyle = col('--bg', '#0b1120');
    ctx.fillRect(0, 0, W, H);

    // Beat lines from the downbeat, scrolling up with the notes. Without a
    // tempo the grid is a guess, so it is drawn faint and without bars.
    const downbeat = st.grid.downbeat || 0;
    let b = Math.floor((now - downbeat) / fpb);
    for (;;) {
      const y = yAt(downbeat + b * fpb, now, fpb, keyTop);
      if (y < 0) break;
      const bar = hasTempo && ((b % 4) + 4) % 4 === 0;
      ctx.fillStyle = bar ? col('--line', '#26324a') : 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, Math.round(y), W, 1);
      b--;
    }

    // Bars
    for (const n of noteBars(this.tracks, now, geo)) {
      ctx.globalAlpha = n.alpha;
      ctx.fillStyle = n.color;
      ctx.fillRect(n.x, n.y0, n.w, n.y1 - n.y0);
      // A lighter top edge, so the growing end of a sounding bar reads as an edge.
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(n.x, n.y0, n.w, 1);
      if (n.clamp) {
        ctx.fillStyle = col('--ink', '#eef2f8');
        ctx.font = `10px ${col('--mono', 'ui-monospace, monospace')}`;
        ctx.textAlign = 'center';
        ctx.fillText(n.clamp < 0 ? '▾' : '▴', n.x + n.w / 2, Math.min(n.y1 - 2, n.y0 + 10));
      }
    }
    ctx.globalAlpha = 1;

    // Keyboard
    const lit = glow(this.tracks, now, geo);
    const mono = col('--mono', 'ui-monospace, monospace');
    for (const k of keys.whites) {
      ctx.fillStyle = col('--panel', '#131c2e');
      ctx.fillRect(padCol + k.x, keyTop, k.w, keyH);
      const g = lit.keys.get(k.p);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(padCol + k.x, keyTop, k.w, keyH); ctx.globalAlpha = 1; }
      ctx.fillStyle = col('--line', '#26324a');
      ctx.fillRect(padCol + k.x, keyTop, 1, keyH);
      if (k.p % 12 === 0 && k.w >= 9) {
        ctx.fillStyle = col('--ink-faint', '#5d6b85');
        ctx.font = `${k.w >= 14 ? 10 : 8}px ${mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(`C${Math.floor(k.p / 12) - 1}`, padCol + k.x + k.w / 2, H - 6);
      }
    }
    ctx.fillStyle = col('--line', '#26324a');
    ctx.fillRect(padCol, keyTop, W - padCol, 1);
    for (const k of keys.blacks) {
      ctx.fillStyle = '#060a14';
      ctx.fillRect(padCol + k.x, keyTop, k.w, keyH * 0.6);
      const g = lit.keys.get(k.p);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(padCol + k.x, keyTop, k.w, keyH * 0.6); ctx.globalAlpha = 1; }
    }

    // Pads: a row at the left, lowest pitch first, each padW wide.
    for (const p of pads.pads) {
      const x = p.col * padW;
      ctx.fillStyle = col('--panel-2', '#1a2437');
      ctx.fillRect(x + 1, keyTop + 1, padW - 2, keyH - 2);
      const g = lit.pads.get(p.col);
      if (g) { ctx.globalAlpha = g.alpha; ctx.fillStyle = g.color; ctx.fillRect(x + 1, keyTop + 1, padW - 2, keyH - 2); ctx.globalAlpha = 1; }
      if (padW >= 16) {
        ctx.fillStyle = col('--ink-dim', '#8b9ab4');
        ctx.font = `9px ${mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(p.short, x + padW / 2, H - 6);
      }
    }
    if (pads.pads.length) {
      ctx.fillStyle = col('--line', '#26324a');
      ctx.fillRect(padCol - 1, keyTop, 2, keyH);
    }
  }
}
```

- [ ] **Step 2: Run the tests**

Run: `node --test 'web/static/lib/wave/*.test.js'`
Expected: all pass. The class references `document`, `ResizeObserver` and `requestAnimationFrame` only inside methods, so importing the module under node is still fine (the lanes module works the same way).

- [ ] **Step 3: Commit**

```bash
git add web/static/lib/wave/rising.js
git commit -m "RisingNotes: the canvas, the keyboard and pads, mute chips and speed"
```

---

### Task 5: Markup and CSS — the pane, the bench grid, the phone fullscreen

**Files:**
- Modify: `web/static/wave.html` (header and `<main>`)
- Modify: `web/static/styles.css` (waveform page section, lines ~186–297: replace the two `@media` blocks at the end of the section and add the pane rules)

**Interfaces:**
- Produces for Task 6: elements `#notes-open` (header button, starts `hidden`), `#notes-pane` (starts `hidden`), `#notes-tracks`, `#notes-speed`, `#notes-bar`, `#notes-play`, `#notes-canvas`; the `body.notes-open` class contract; the `.wave-col` wrapper.

- [ ] **Step 1: Wrap the page and add the pane**

In `web/static/wave.html`, change the header to:

```html
<header class="topbar">
  <a class="back" href="/" aria-label="Back to takes">‹</a>
  <div class="wave-title">
    <span id="wave-name" class="wave-name">…</span>
    <span id="wave-bpm" class="wave-bpm"></span>
  </div>
  <!-- Phone only: opens the rising-notes pane fullscreen. Revealed by
       page.js once /api/midi has returned tracks, so a take without MIDI
       never offers a view of nothing. On the bench the pane is always
       there and this stays hidden. -->
  <button id="notes-open" class="icon-btn notes-btn" type="button" hidden>Notes</button>
</header>
```

Replace `<main class="wave-main">` … `</main>` with the same content wrapped in a `.wave-col`, plus the pane after it:

```html
<main class="wave-main">
  <div class="wave-col">
    <div id="wave-error" class="wave-error" hidden></div>
    <canvas id="overview-canvas" class="overview-canvas" aria-label="Whole take"></canvas>
    <canvas id="wave-canvas" class="wave-canvas" aria-label="Waveform"></canvas>

    <!-- One lane per MIDI track, built by lib/wave/lanes.js when the take has
         a .mid; stays empty and takes no space otherwise. -->
    <div id="lanes" class="lanes" hidden></div>

    <div class="wave-row action">
      <button id="play" class="icon-btn" type="button">Play</button>
      <button id="bundle" class="icon-btn" type="button">DAW bundle</button>
      <button id="share" class="icon-btn primary" type="button">Share MP3</button>
      <button id="region-clear" class="region-x" type="button" aria-label="Clear region" hidden>×</button>
    </div>

    <details id="fine" class="fine">
      ... (unchanged) ...
    </details>
  </div>

  <!-- Rising notes: the take's MIDI coming out of a keyboard as it plays.
       Built by lib/wave/rising.js from the same /api/midi response as the
       lanes. On a bench-width screen it is the right column; on a phone
       it opens fullscreen from the Notes button. -->
  <section id="notes-pane" class="notes-pane" hidden aria-label="Rising notes">
    <div class="notes-chips">
      <div id="notes-tracks" class="notes-tracks"></div>
      <button id="notes-speed" class="chip" type="button" aria-label="Playback speed">1×</button>
      <span id="notes-bar" class="mono notes-bar phone-only"></span>
      <button id="notes-play" class="icon-btn phone-only" type="button">Play</button>
    </div>
    <canvas id="notes-canvas" class="notes-canvas"></canvas>
  </section>
</main>
```

Keep the `<details id="fine">` block byte-for-byte as it is today; only its indentation moves.

- [ ] **Step 2: CSS**

In `web/static/styles.css`, in the waveform page section, add after the `.wave-main { … }` rule (line ~195):

```css
/* The page's own column: everything the phone shows. On the bench it is the
   left column and scrolls on its own; the pane beside it does not scroll. */
.wave-col { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0; }
```

Replace the block from `/* ---------- MIDI lanes ---------- */` through the end of the `@media (min-width: 860px) { .wave-row.action … }` rule with:

```css
/* ---------- MIDI lanes ---------- */
/* Capped so four lanes never push the transport off a phone; scrolls inside. */
.lanes { display: flex; flex-direction: column; gap: 6px; max-height: 40vh; overflow-y: auto; }
.lane { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); overflow: hidden; flex: none; }
.lane-head {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px; min-height: 26px;
  cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  touch-action: manipulation;
}
.lane-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.lane-name { font-size: 12px; font-weight: 600; white-space: nowrap; }
.lane-meta { font-size: 10px; color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lane-chev { margin-left: auto; color: var(--ink-faint); font-size: 12px; }
.lane-body { display: block; width: 100%; border-top: 1px solid var(--panel-2); touch-action: pan-y; }

/* ---------- rising notes ---------- */
.notes-pane {
  display: flex; flex-direction: column; min-height: 0; min-width: 0;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); overflow: hidden;
}
.notes-chips {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px; min-height: 40px;
  border-bottom: 1px solid var(--line); background: var(--panel);
}
.notes-tracks { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-x: auto; flex: 1; }
.chip {
  appearance: none; display: inline-flex; align-items: center; gap: 6px; flex: none;
  min-height: 32px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 999px;
  background: var(--panel-2); color: var(--ink); font-family: var(--font); font-size: 12px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.chip-swatch { width: 8px; height: 8px; border-radius: 2px; }
/* Muted: the chip dims, the swatch hollows. */
.chip[aria-pressed="true"] { color: var(--ink-faint); background: transparent; }
.chip[aria-pressed="true"] .chip-swatch { background: transparent !important; box-shadow: inset 0 0 0 1px var(--ink-faint); }
.notes-bar { color: var(--ink-dim); font-size: 12px; min-width: 3.5em; text-align: right; }
.notes-canvas { display: block; width: 100%; flex: 1; min-height: 0; touch-action: none; }
/* The chips row's phone-only controls (bar.beat and Play) exist because the
   fullscreen pane covers the page's own action row. */
.phone-only { display: none; }

/* Below the bench the pane is a phone thing: gone until opened, then over
   everything under the top bar. history.pushState makes the back gesture
   close it (page.js). */
@media (max-width: 859.98px) {
  .notes-pane:not([hidden]) { display: none; }
  body.notes-open { overflow: hidden; }
  body.notes-open .notes-pane:not([hidden]) {
    display: flex; position: fixed; z-index: 40;
    top: var(--topbar-h); left: 0; right: 0; bottom: 0;
    border: none; border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  body.notes-open .phone-only { display: inline-flex; }
  body.notes-open .notes-bar { display: inline; }
}

/* The bench: 860px and up (the 1024x600 tablet in landscape). With a pane,
   the page is a fixed-height two-column grid, left column scrolling on its
   own. Without one (a take with no MIDI) the phone layout simply widens,
   as before. grid-template-columns and max-width are set explicitly
   because the takes page's >=860px rule sets both on a bare `main`. */
@media (min-width: 860px) {
  .wave-canvas { height: 55vh; }
  .wave-main:has(.notes-pane:not([hidden])) {
    display: grid; grid-template-columns: 372px minmax(0, 1fr); gap: 10px;
    align-items: stretch; max-width: none;
    height: calc(100dvh - var(--topbar-h)); box-sizing: border-box;
  }
  .wave-main:has(.notes-pane:not([hidden])) .wave-col { overflow-y: auto; min-height: 0; }
  .wave-main:has(.notes-pane:not([hidden])) .wave-canvas { height: 30vh; min-height: 140px; }
  .wave-main:has(.notes-pane:not([hidden])) .lanes { max-height: none; overflow-y: visible; }
  .notes-btn { display: none; }
  /* On a bench-sized screen the DAW is the destination and the MP3 the
     afterthought; on a phone it is the other way round. Same buttons, same
     places, only the weight moves. */
  .wave-row.action #bundle { flex: 1.5; background: var(--accent-dk); color: var(--ink); border-color: var(--accent-dk); }
  .wave-row.action #share { flex: 1; background: var(--panel); color: var(--ink-dim); border-color: var(--line); }
}
```

Also keep, just above the `@media (max-width: 859.98px)` block, the two unscoped weight rules that used to precede the 860 rule (they were already there; do not lose them):

```css
.wave-row.action #share { flex: 1.4; }
.wave-row.action #bundle { flex: 1; color: var(--ink-dim); }
```

Note the old `@media (min-width: 900px) { .wave-canvas { height: 55vh } }` moves into the 860 block; the ten-pixel difference was never deliberate. The `.notes-btn` rule hides the header button on the bench; on a phone it is `hidden` until MIDI arrives and page.js un-hides it.

- [ ] **Step 3: Check the page still renders**

Run the server locally (`docs/development.md` has the demo recipe: `CGO_ENABLED=0 go run ./cmd/hindsight` with the demo flags, or point a browser at the Pi) and open a take. Expected: the phone-width page looks exactly as before (the pane is `hidden`); at 1024 wide it also looks as before, since no code un-hides the pane yet. Check that the header's Notes button does not appear.

- [ ] **Step 4: Commit**

```bash
git add web/static/wave.html web/static/styles.css
git commit -m "Take page markup and CSS for the rising-notes pane, the bench grid and the phone fullscreen"
```

---

### Task 6: Page wiring — build the pane from the MIDI response, bench and phone modes

**Files:**
- Modify: `web/static/lib/wave/page.js` (imports; `redraw`; clock `onEnded`; the transport handler around line 258; `loadLanes` around line 466; `updateReadout`; the `pagehide` line)

**Interfaces:**
- Consumes: `RisingNotes` from `./rising.js` (Task 4); `clock.setRate` (Task 1); the elements from Task 5.

- [ ] **Step 1: Import and declare**

At the top of `page.js`, after `import { Lanes } from './lanes.js';` add:

```js
import { RisingNotes } from './rising.js';
```

Right after `let lanes = null;` add:

```js
  // The rising-notes pane, built with the lanes from the same response.
  // Visible always on the bench, only while open on a phone; it draws every
  // frame on its own while playing, and one frame per tick when paused.
  let notes = null;
  const bench = window.matchMedia('(min-width: 860px)');
  const notesVisible = () => bench.matches || document.body.classList.contains('notes-open');
  function syncNotes() {
    if (!notes) return;
    if (notesVisible() && clock.playing) notes.start();
    else { notes.stop(); if (notesVisible()) notes.draw(); }
    $('notes-play').textContent = clock.playing ? 'Pause' : 'Play';
  }
```

Change `redraw()` to:

```js
  function redraw() { view.draw(); if (overview) overview.draw(); if (lanes) lanes.draw(); if (notes && !notes.running && notesVisible()) notes.draw(); }
```

- [ ] **Step 2: Transport**

Replace the Play handler:

```js
  $('play').addEventListener('click', async () => {
```
…through its closing `});` with:

```js
  async function togglePlay() {
    if (clock.playing) clock.pause();
    else await clock.play();
    // play() can fail (no preview yet, autoplay refused) and resolve anyway,
    // so the label follows the clock rather than what we asked it to do.
    $('play').textContent = clock.playing ? 'Pause' : 'Play';
    syncNotes();
  }
  $('play').addEventListener('click', togglePlay);
  $('notes-play').addEventListener('click', togglePlay);
```

In the `Clock` constructor call change `onEnded: () => { $('play').textContent = 'Play'; },` to:

```js
    onEnded: () => { $('play').textContent = 'Play'; syncNotes(); },
```

- [ ] **Step 3: Build the pane in `loadLanes`**

`loadLanes()` keeps its decoded response in a local called `notes`, which now
collides with the module-level `notes`. Rename the local first: change
`let notes;` to `let midi;`, `notes = await res.json();` to
`midi = await res.json();`, `if (!notes.tracks || !notes.tracks.length) return;`
to `if (!midi.tracks || !midi.tracks.length) return;`,
`for (const t of notes.tracks)` to `for (const t of midi.tracks)`, and
`tracks: notes.tracks,` in the `Lanes` constructor to `tracks: midi.tracks,`.

Then, at the end of `loadLanes()`, after `lanes.draw();`, add:

```js
    // The pane, from the same tracks (shared objects: a kind flipped on a
    // lane header changes colour and pads here too).
    notes = new RisingNotes({
      canvas: $('notes-canvas'),
      chips: $('notes-tracks'),
      speedButton: $('notes-speed'),
      tracks: midi.tracks,
      tempo: midi.tempo || [],
      sampleRate: sr,
      getState: () => state,
      getClock: () => clock,
      storageKey: `wave.notes.${file}`,
    });
    $('notes-pane').hidden = false;
    $('notes-open').hidden = false;
    syncNotes();
```

Also, in the `Lanes` constructor's `onKindChange`, after `laneKinds[name] = kind;` add `if (notes) notes.draw();` so the pane repaints with the new pads and colours at once.

- [ ] **Step 4: The phone's open and close**

After `loadLanes`'s definition (before `// --- keyboard ---`), add:

```js
  // --- rising notes on a phone ------------------------------------------
  // Fullscreen over the page, sharing its clock. Opening pushes a history
  // entry so the back gesture closes it; the header's back link does the
  // same while it is open.
  function openNotes() {
    if (document.body.classList.contains('notes-open')) return;
    document.body.classList.add('notes-open');
    history.pushState({ notes: 1 }, '');
    updateReadout();
    syncNotes();
  }
  function closeNotes() {
    if (!document.body.classList.contains('notes-open')) return;
    document.body.classList.remove('notes-open');
    syncNotes();
  }
  $('notes-open').addEventListener('click', openNotes);
  window.addEventListener('popstate', () => closeNotes());
  document.querySelector('.topbar .back').addEventListener('click', (e) => {
    if (!document.body.classList.contains('notes-open')) return;
    e.preventDefault();
    if (history.state && history.state.notes) history.back(); else closeNotes();
  });
  // Rotating a tablet, or a phone crossing the breakpoint: the pane's
  // visibility rule changes under it.
  bench.addEventListener('change', () => { if (bench.matches) closeNotes(); syncNotes(); });
```

- [ ] **Step 5: Readout and teardown**

Change `updateReadout` to:

```js
  function updateReadout() {
    $('pos-bar').textContent = barBeat(state.cursor, state.grid);
    $('pos-time').textContent = fmtTime(state.cursor, sr);
    $('notes-bar').textContent = barBeat(state.cursor, state.grid) || fmtTime(state.cursor, sr);
  }
```

In the `pagehide` listener, after `if (lanes) lanes.destroy();` add ` if (notes) notes.destroy();`.

- [ ] **Step 6: Run the tests**

Run: `node --test 'web/static/lib/wave/*.test.js'`
Expected: all pass (page.js is not under test, but the modules it imports are).

- [ ] **Step 7: Hardware check**

Deploy to the Pi (`./deploy.sh`; see memory `pi-ssh-and-deploy`) and open a take with MIDI:

- Tablet (1024×600 landscape): two columns; the left column scrolls; the right pane shows the keyboard with a pad row at the left. Press Play: bars grow out of keys and rise, drums flash their pads, beat lines scroll up. Pause: the picture freezes. Tap the wave to seek: the pane redraws at that spot. Drag a region: the loop wraps and the pane follows. Tap a chip: that track disappears; reload: it stays muted. Speed 0.5×: audio and rise slow together, pitch unchanged. Hold a lane header to flip drums/notes: the pane's pads and colours change.
- Phone (portrait): no pane, a Notes button in the header. Tap it: fullscreen pane with a Play button and a bar.beat readout in the chip row. Play, then use the hardware/gesture back: the pane closes and playback continues. Rotate to landscape: still fullscreen, shorter keyboard.
- A take without MIDI: no Notes button, no pane, the page as before at both widths.

- [ ] **Step 8: Commit**

```bash
git add web/static/lib/wave/page.js
git commit -m "Wire the rising-notes pane: bench column, phone fullscreen, shared clock and speed"
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-rising-notes-bench-design.md` (the pad column bullet under "The picture" and the "### Pads" paragraph)
- Modify: `README.md:15` (the **Waveform page** feature bullet)
- Modify: `docs/development.md` ("Checking the waveform page by hand", around line 85)

- [ ] **Step 1: Spec follows the build**

In the spec, replace the pad column bullet under "The picture" with:

```markdown
- **Pad row**, at the left end of the keyboard: one pad per kept drum pitch,
  lowest on the left, each `padW = clamp(12, floor(0.2 · width / npads), 32)`
  px wide and `KEY_H` tall (about 126 px for eight pads on the tablet),
  labelled with a two-letter GM abbreviation when there is room (`BD`, `SD`,
  `HH`, `OH`, `T1`–`T4`, `CR`, `RD`) and nothing when there is not. A hit
  flashes the pad at velocity alpha for 0.3 beat and its bar rises straight
  out of the pad, `padW` wide.
```

and under "### Pads" replace "lowest at the bottom" with "lowest on the left".

- [ ] **Step 2: README**

Add a feature bullet directly after the **Waveform page** bullet (line 15):

```markdown
- **Rising notes** — press Play and the take's MIDI plays out on a keyboard: every note grows out of its key and rises away, drums pop out of their pads. On a tablet it fills the right of the take page beside the wave and lanes; on a phone it opens from the Notes button in the header. Chips mute a track in the view, and the speed chip plays the preview at ½× or 2× with the pitch kept.
```

- [ ] **Step 3: development.md**

In "Checking the waveform page by hand", add `rising.js` to the list of
files in the sentence ("after touching `view.js`, `overview.js`, `share.js`,
`rising.js` or `page.js`") and append these bullets to the list:

```markdown
- **Rising notes (bench)** — at 860px and wider a take with MIDI is two
  columns; press Play and bars grow out of the keys and rise, drum hits
  flash their pads; pause freezes the picture; tapping the wave to seek
  redraws it; a region loop wraps the rise with it
- **Rising notes (phone)** — the header's Notes button opens the pane
  fullscreen with its own Play and bar.beat readout; the back gesture or the
  header's back link closes it and playback carries on
- **Speed chip** — ½× slows the audio and the rise together with the pitch
  kept; a region loop ignores it and plays at 1×
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-rising-notes-bench-design.md README.md docs/development.md
git commit -m "Document the rising-notes pane"
```
