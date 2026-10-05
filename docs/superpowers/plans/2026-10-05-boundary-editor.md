# The boundary editor — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the take page, place In, Out and bar 1 to the sample with two encoders (ZOOM and POSITION) centred on the point, snap it to a hit, a zero crossing or the grid, and see a loop's seam.

**Architecture:** Browser only. Two new pure, node-tested modules: `lib/wave/onset.js` (where a hit starts, the nearest zero crossing, reading the 16-bit WAV `/api/slice` sends) and `lib/wave/boundary.js` (the view about the point, the encoders' maths, steps, clamping, the readout, the seam halves). A small loader, `lib/wave/near.js`, fetches and caches audio around a point. `lib/wave/view.js` draws the edited boundary and the seam view; `lib/wave/page.js` owns the editing state and wires the editor bar in `wave.html`.

**Tech Stack:** vanilla ES modules, Canvas 2D, Web Audio (existing clock), `node --test`. No Go changes.

**Spec:** `docs/superpowers/specs/2026-10-05-boundary-editor-design.md`

## Global Constraints

- No Go changes. `CGO_ENABLED=0 go test ./...` still passes (it embeds the guide and static files).
- `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js'` passes after every task.
- **Reel-to-reel rules** (`docs/superpowers/plans/2026-10-04-reel-to-reel.md`, Global Constraints): no new hex literals in JS except token fallbacks; anything drawn on the black waveform window uses `--well-ink` / `--well-dim` / `--well-rule` (or the existing `--sel`, `--warn`, `--grease`), never `--ink`; hover styles only inside `@media (hover: hover)`; every control shows the `:focus-visible` ring; `@media (prefers-reduced-motion: reduce)` turns off any slide-in; orange (`primary`) stays the page's one main action — nothing in the editor is orange; Seam latches with a yellow LED.
- The editor's markup is one self-contained block, `#boundary-editor`, and its readout one element, `#boundary-readout`.
- Encoders: a full pad width of ZOOM zooms 64×; a full pad width of POSITION moves the point by half the visible span. A step is 1 sample when zoomed past 1 px per sample, else 1 ms.
- Attack searches ±60 ms (or half the visible span, if smaller); Zero searches ±5 ms; the audio comes from `/api/slice` ±250 ms around the point.
- One encoder drag is one undo step (`final: true` only on release); each snap and each step is one change.
- Copy follows the repo's voice: plain words, full sentences in docs, no "user". The guide's tips table and `web/static/lib/help/tips.js` must match row for row (the help test checks).
- Commits end with the two trailer lines the controller gives.

## Review Focus

1. **A boundary near the take's start or end** — the view can't centre it; it must stay on screen and the encoders must still move it (clamped), never throw. → Task 2's `viewAbout` tests; Task 5 demo step at the take's start.
2. **Editing while playing with the loop on** — moving In or Out must not stop or glitch playback; the loop picks it up at the next wrap (existing `scheduleLoop`). → Task 5 demo step.
3. **A take with no BPM** — Grid is hidden, the readout has no beat offset, bar 1 can't be selected. → Task 2 `beatOffset` null test; Task 5 wiring guard.
4. **A slice that fails to load** (offline Pi, 404) — Attack/Zero say so in a toast and move nothing; the button doesn't stay stuck waiting. → Task 3 loader test with a failing fetch.
5. **Seam with the selection narrower than the screen** — both halves still show their side of the seam (each half may run past the other end of the selection); nothing divides by zero. → Task 2 `seamHalves` test; Task 4 drawing.

---

### Task 0: Start from the reel-to-reel tokens

**Files:** none.

- [ ] **Step 1:** Check that reel-to-reel PR 1 is on `main`: `git log --oneline main | grep -c "Reel-to-reel palette"` prints 1 or more. If it isn't there yet, stop and report — the controller decides whether to wait or to build on the current tokens.
- [ ] **Step 2:** Rebase this branch on `main`: `git rebase main`, then run the node tests and `CGO_ENABLED=0 go test ./...`; both pass.

---

### Task 1: `lib/wave/onset.js` — where a hit starts, and the nearest zero crossing

**Files:**
- Create: `web/static/lib/wave/onset.js`
- Test: `web/static/lib/wave/onset.test.js`

**Interfaces:**
- Produces: `parseWav16(arrayBuffer) → { sampleRate, channels, mono: Float32Array }`; `findAttack(x: Float32Array, sampleRate, i, radius) → index | -1`; `findZero(x, i, radius) → index | -1`.

This was prototyped and validated before the plan: every synthetic case below passes, and on the real demo take it places 20 of 20 kicks on the same sample offset; on the 2026-10-04 stylophone take, successive hits come 239.2–239.8 ms apart against an eighth of 239.7. Write it as given.

- [ ] **Step 1: Write the tests** — `web/static/lib/wave/onset.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav16, findZero, findAttack } from './onset.js';

const sr = 48000;
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1; }

test('a click after silence starts where it starts', () => {
  const x = new Float32Array(sr / 2);
  const at = 12000;
  for (let n = at; n < x.length; n++) x[n] = 0.6 * Math.exp(-(n - at) / 480) * Math.sin((2 * Math.PI * 180 * (n - at)) / sr + 0.8);
  const got = findAttack(x, sr, at + 1200, 2880); // asked 25 ms late, ±60 ms
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

function kickOverBass(at, phase) {
  const rnd = seeded(3);
  const x = new Float32Array(sr);
  for (let n = 0; n < x.length; n++) {
    const t = n / sr;
    const bass = 0.45 * Math.sin(2 * Math.PI * 82.41 * t);
    const k = n - at;
    const kick = k >= 0 ? 0.55 * Math.exp(-k / (0.07 * sr)) * Math.sin(2 * Math.PI * 55 * k / sr + phase) : 0;
    x[n] = Math.tanh(bass + kick + 0.002 * rnd()) * 0.5;
  }
  return x;
}

test('a kick with an edge over a held bass is found to the millisecond', () => {
  const at = 24000;
  const got = findAttack(kickOverBass(at, Math.PI / 2), sr, at - 1500, 2880); // starts at full height: a click
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

test('a soft low kick over a held bass, starting from zero, is found to the millisecond too', () => {
  const at = 24000;
  const got = findAttack(kickOverBass(at, 0), sr, at - 1500, 2880); // starts from zero: no edge
  assert.ok(Math.abs(got - at) <= 48, `found ${got}, want ${at} ± 1 ms`);
});

test('nothing rises in silence, a held sine, or steady noise', () => {
  const rnd = seeded(5);
  const silence = new Float32Array(sr / 4);
  const sine = Float32Array.from({ length: sr / 4 }, (_, n) => 0.5 * Math.sin((2 * Math.PI * 82.41 * n) / sr));
  const noise = Float32Array.from({ length: sr / 4 }, () => 0.3 * rnd());
  for (const [name, x] of [['silence', silence], ['sine', sine], ['noise', noise]]) {
    assert.equal(findAttack(x, sr, 6000, 2880), -1, name);
  }
});

test('the nearest zero crossing, either side, and none in a DC stretch', () => {
  // Half a sample off, so no sample is exactly zero: it crosses between 99 and 100, 199 and 200, ...
  const x = Float32Array.from({ length: 1000 }, (_, n) => Math.sin((2 * Math.PI * (n + 0.5)) / 200));
  assert.equal(findZero(x, 97, 50), 100);
  assert.equal(findZero(x, 203, 50), 200);
  assert.equal(findZero(new Float32Array(500).fill(0.2), 250, 100), -1);
});

test('a 16-bit WAV from the slice endpoint reads back as mono', () => {
  const frames = 4, ch = 2;
  const buf = new ArrayBuffer(44 + frames * ch * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + frames * ch * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, 48000, true); dv.setUint32(28, 48000 * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, frames * ch * 2, true);
  [[16384, 16384], [-16384, 0], [0, 0], [32767, -32768]].forEach(([l, r], f) => { dv.setInt16(44 + f * 4, l, true); dv.setInt16(46 + f * 4, r, true); });
  const got = parseWav16(buf);
  assert.equal(got.sampleRate, 48000);
  assert.equal(got.channels, 2);
  assert.deepEqual([...got.mono].map((v) => Math.round(v * 1000) / 1000 + 0), [0.5, -0.25, 0, 0]);
});
```

- [ ] **Step 2: Run them to see them fail.** `node --test web/static/lib/wave/onset.test.js` — FAIL: cannot find `./onset.js`.

- [ ] **Step 3: Write the module** — `web/static/lib/wave/onset.js`:

```js
// web/static/lib/wave/onset.js
// Finding where a hit starts and where the wave crosses zero, in a short
// stretch of a take's audio, for the boundary editor's Attack and Zero.
// Pure; node-tested.

// A hit is found in two passes. First, surely: energy over LONG_MS, which a
// held low note can't ripple, rising by RISE against the LONG_MS before it.
// That says a hit began somewhere in the LONG_MS + SLACK_MS before the rise.
// Then exactly, in two ways. Whatever was sounding before the hit (held
// notes, a pad, silence) is steady, so a short linear predictor fitted to the
// stretch just before predicts it, and its error stays small until the hit's
// first sample, which nothing before predicts. But a new pure tone starting
// from zero (a sine kick) is itself predictable; for that, when what came
// before repeats cycle by cycle, the audio less itself one cycle back is near
// zero until the hit begins.
const LONG_MS = 40;
const RISE = 1.15;       // the long energy's rise on the window before that makes a hit (~1.2 dB: a limited mix rises little)
const SLACK_MS = 25;     // how far before the long window the hit may begin (the rise peaks a little after it fills)
const PRE_MS = 30;       // the stretch read for what was sounding before
const ORDER = 24;        // the predictor's length: enough for a dozen steady tones
const CYCLE_MS = [2, 25];// a held note's cycle: 40–500 Hz
const PERIODIC = 0.9;    // how alike two cycles must be to count as one note held
const ENV_MS = 1;        // the residual's envelope window
const STAND = 4;         // how many times above anything before it the residual must stand
const NOISE = 1.5;       // ... and it began where it last stood within this of it

/**
 * parseWav16 reads the 16-bit PCM WAV /api/slice sends: its rate, channel
 * count, and the samples mixed to mono in -1..1.
 */
export function parseWav16(buf) {
  const dv = new DataView(buf);
  let at = 12, channels = 0, sampleRate = 0, bits = 0;
  while (at + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    const size = dv.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(at + 10, true);
      sampleRate = dv.getUint32(at + 12, true);
      bits = dv.getUint16(at + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || channels < 1) throw new Error('not 16-bit PCM');
      const frames = Math.floor(Math.min(size, dv.byteLength - at - 8) / (2 * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += dv.getInt16(at + 8 + (f * channels + c) * 2, true);
        mono[f] = s / channels / 32768;
      }
      return { sampleRate, channels, mono };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no audio in the WAV');
}

/**
 * findZero is the index nearest i, within radius, where the wave crosses
 * zero (the sign changes between it and the sample before), or -1.
 */
export function findZero(x, i, radius) {
  for (let d = 0; d <= radius; d++) {
    for (const j of d ? [i - d, i + d] : [i]) {
      if (j < 1 || j >= x.length) continue;
      if ((x[j - 1] < 0 && x[j] >= 0) || (x[j - 1] >= 0 && x[j] < 0)) return j;
    }
  }
  return -1;
}

/** rms is the RMS of f(n) over the win values ending at each n in [lo, hi). */
function rms(f, lo, hi, win) {
  const out = new Float64Array(Math.max(0, hi - lo));
  let sum = 0;
  for (let n = lo; n < hi; n++) {
    const v = f(n);
    sum += v * v;
    if (n - win >= lo) { const o = f(n - win); sum -= o * o; }
    out[n - lo] = Math.sqrt(Math.max(0, sum) / win);
  }
  return out;
}

/**
 * predictor fits an order-p linear predictor to x[from, to) (autocorrelation
 * method, Levinson-Durbin) and answers its coefficients a[1..p], so that
 * x[n] is predicted as -sum a[k] x[n-k]; null for silence.
 */
function predictor(x, from, to, p) {
  const r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) {
    let s = 0;
    for (let n = from + k; n < to; n++) s += x[n] * x[n - k];
    r[k] = s;
  }
  if (r[0] < 1e-9) return null;
  r[0] *= 1 + 1e-9; // a hair of white noise keeps it stable
  const a = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return a;
}

/** cycle is the lag, in [minLag, maxLag], at which x[from, to) best repeats, or 0 if it doesn't. */
function cycle(x, from, to, minLag, maxLag) {
  let best = 0, bestR = PERIODIC;
  for (let L = minLag; L <= maxLag; L++) {
    let ab = 0, aa = 0, bb = 0;
    for (let n = Math.max(from, L); n < to; n++) { const a = x[n], b = x[n - L]; ab += a * b; aa += a * a; bb += b * b; }
    if (aa < 1e-12 || bb < 1e-12) return 0;
    const r = ab / Math.sqrt(aa * bb);
    if (r > bestR) { bestR = r; best = L; }
  }
  return best;
}

/**
 * onsetIn is where res's short envelope first stands STAND times above all
 * it reached in [preLo, from), going back to where it last stood within
 * NOISE of that -- or -1 if it never does by best.
 */
function onsetIn(res, preLo, from, best, envN) {
  const R = rms(res, preLo, best + 1, envN);
  const r = (n) => R[n - preLo];
  let before = 0;
  for (let n = preLo + envN; n < from; n++) before = Math.max(before, r(n));
  const thr = Math.max(before * STAND, 1e-4);
  for (let n = from; n <= best; n++) {
    if (r(n) >= thr) {
      let m = n;
      while (m > from && r(m - 1) > before * NOISE) m--;
      return m;
    }
  }
  return -1;
}

/**
 * findAttack is the index where the strongest hit within radius of i starts,
 * or -1 when nothing there rises. See the passes above.
 */
export function findAttack(x, sr, i, radius) {
  const ms = (m) => Math.max(1, Math.round((sr * m) / 1000));
  const long = ms(LONG_MS), slack = ms(SLACK_MS), pre = ms(PRE_MS);
  const lo = Math.max(ORDER + 1, i - radius - 2 * long - slack - pre - ms(CYCLE_MS[1]));
  const hi = Math.min(x.length, i + radius + long);
  if (hi - lo < 3 * long) return -1;
  const E = rms((n) => x[n], lo, hi, long);
  const e = (n) => E[n - lo];
  const tiny = 1e-6;
  // The strongest rise of the long energy, its window ending within reach.
  let best = -1, bestRatio = RISE;
  for (let n = Math.max(lo + 2 * long, i - radius); n < Math.min(hi, i + radius + long); n++) {
    const r = (e(n) + tiny) / (e(n - long) + tiny);
    if (r > bestRatio) { bestRatio = r; best = n; }
  }
  if (best < 0) return -1;
  // The hit began in [from, best]; what sounded before it is in [from - pre, from).
  const from = Math.max(lo + 1, best - long - slack);
  const preLo = Math.max(lo + 1, from - pre);
  const A = predictor(x, preLo, from, Math.min(ORDER, from - preLo - 1));
  const envN = ms(ENV_MS);
  if (A) {
    const err = (n) => { let v = x[n]; for (let k = 1; k < A.length; k++) v += A[k] * x[n - k]; return v; };
    const at = onsetIn(err, preLo, from, best, envN);
    if (at >= 0) return at;
  }
  const L = cycle(x, preLo, from, ms(CYCLE_MS[0]), Math.min(ms(CYCLE_MS[1]), from - preLo - 1));
  const at = onsetIn(L ? (n) => x[n] - x[n - L] : (n) => x[n], preLo, from, best, envN);
  return at >= 0 ? at : from; // it rose, but never stood clear: the earliest it can have begun
}
```

- [ ] **Step 4: Run the tests.** `node --test web/static/lib/wave/onset.test.js` — 6 pass.

- [ ] **Step 5: Commit.** `git add web/static/lib/wave/onset.js web/static/lib/wave/onset.test.js && git commit -m "Find where a hit starts, and the nearest zero crossing"` (with the trailer).

---

### Task 2: `lib/wave/boundary.js` — the encoders' maths, the readout, the seam halves

**Files:**
- Create: `web/static/lib/wave/boundary.js`
- Test: `web/static/lib/wave/boundary.test.js`

**Interfaces:**
- Consumes: `barBeat(frame, grid)` from `./geometry.js` (existing; `grid` is `{ bpm, sampleRate, downbeat }`).
- Produces: `ZOOM_PER_PAD`, `POSITION_PER_PAD`, `viewAbout(frame, fpp, width, total, minFpp) → {start, fpp, width}`, `zoomBy(fpp, dx, padW) → fpp`, `positionBy(dx, padW, view) → frames`, `stepFrames(fpp, sampleRate)`, `stepLabel(frames, sampleRate)`, `placeEdge(edge, frame, {region, total, minLen})` (edge `'start' | 'end' | 'downbeat'`), `fmtSample(frame, sampleRate)`, `beatOffset(frame, grid) → {ms, at} | null`, `fmtOffset(off)`, `crossedLine(a, b, origin, step)`, `seamHalves(region, fpp, width) → {left, right}`.

Prototyped and validated before the plan; write it as given.

- [ ] **Step 1: Write the tests** — `web/static/lib/wave/boundary.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewAbout, zoomBy, positionBy, stepFrames, stepLabel, placeEdge, fmtSample, beatOffset, fmtOffset, crossedLine, seamHalves, ZOOM_PER_PAD } from './boundary.js';

const sr = 48000;

test('the view keeps the point in the middle, as far as the take allows', () => {
  assert.deepEqual(viewAbout(100000, 10, 400, 1000000, 0.125), { start: 98000, fpp: 10, width: 400 });
  assert.deepEqual(viewAbout(500, 10, 400, 1000000, 0.125), { start: 0, fpp: 10, width: 400 }, 'near the start');
  assert.deepEqual(viewAbout(999900, 10, 400, 1000000, 0.125), { start: 996000, fpp: 10, width: 400 }, 'near the end');
  assert.equal(viewAbout(100000, 0.001, 400, 1000000, 0.125).fpp, 0.125, 'no closer than 8 px a sample');
  assert.equal(viewAbout(100000, 1e9, 400, 1000000, 0.125).fpp, 2500, 'no wider than the take');
});

test('a full pad of ZOOM zooms 64 times; right is closer', () => {
  assert.equal(zoomBy(640, 300, 300), 640 / ZOOM_PER_PAD);
  assert.equal(zoomBy(10, -300, 300), 10 * ZOOM_PER_PAD);
  assert.equal(zoomBy(10, 0, 300), 10);
});

test('a full pad of POSITION moves half of what is on screen, so it scales with the zoom', () => {
  assert.equal(positionBy(300, 300, { width: 400, fpp: 100 }), 20000);   // far out: 0.42 s
  assert.equal(positionBy(-150, 300, { width: 400, fpp: 0.125 }), -12.5); // fully in: samples
});

test('a step is a sample when zoomed past a pixel a sample, else a millisecond', () => {
  assert.equal(stepFrames(0.5, sr), 1);
  assert.equal(stepFrames(1, sr), 48);
  assert.equal(stepFrames(1, 44100), 44);
  assert.equal(stepLabel(1, sr), '1 smp');
  assert.equal(stepLabel(48, sr), '1 ms');
});

test('a boundary stays in the take, and In stays before Out', () => {
  const ctx = { region: { start: 1000, end: 5000 }, total: 10000, minLen: 100 };
  assert.equal(placeEdge('start', 4990, ctx), 4900);
  assert.equal(placeEdge('end', 1010, ctx), 1100);
  assert.equal(placeEdge('start', -50, ctx), 0);
  assert.equal(placeEdge('downbeat', 12000, ctx), 9999);
  assert.equal(placeEdge('downbeat', 123.6, ctx), 124);
});

test('the point reads to the sample', () => {
  assert.equal(fmtSample(120031, sr), '0:02.500 +31');
  assert.equal(fmtSample(0, sr), '0:00.000 +0');
  assert.equal(fmtSample(48000 * 61 + 47, sr), '1:01.000 +47');
  assert.equal(fmtSample(110251, 44100), '0:02.500 +1'); // 2.5 s is 110250 at 44.1 kHz
});

test('how far the point sits from its nearest beat', () => {
  const grid = { bpm: 96, sampleRate: sr, downbeat: 1000 }; // a beat is 30000
  assert.deepEqual(beatOffset(1000 + 2 * 30000 + 149, grid), { ms: 149 / 48, at: '1.3' });
  assert.equal(fmtOffset(beatOffset(1000 + 2 * 30000 + 149, grid)), '+3.1 ms from 1.3');
  assert.equal(fmtOffset(beatOffset(1000 + 4 * 30000 - 96, grid)), '−2.0 ms from 2.1');
  assert.equal(fmtOffset(beatOffset(1000 + 30000, grid)), 'on 1.2');
  assert.equal(beatOffset(5000, { bpm: null, sampleRate: sr, downbeat: 0 }), null);
});

test('the editor ticks when the point crosses a line', () => {
  assert.equal(crossedLine(29990, 30010, 0, 30000), true);
  assert.equal(crossedLine(30010, 29990, 0, 30000), true);
  assert.equal(crossedLine(30010, 30020, 0, 30000), false);
  assert.equal(crossedLine(1, 2, 0, 0), false);
});

test('the seam view: the end of the loop on the left, its start on the right, meeting in the middle', () => {
  const { left, right } = seamHalves({ start: 48000, end: 528000 }, 2, 400);
  assert.deepEqual(left, { start: 528000 - 400, fpp: 2, width: 200 });
  assert.deepEqual(right, { start: 48000, fpp: 2, width: 200 });
});
```

- [ ] **Step 2: Run them to see them fail.** `node --test web/static/lib/wave/boundary.test.js` — FAIL: cannot find `./boundary.js`.

- [ ] **Step 3: Write the module** — `web/static/lib/wave/boundary.js`:

```js
// web/static/lib/wave/boundary.js
// The boundary editor's pure parts: a view about the point being placed,
// what the ZOOM and POSITION encoders do to it, the step, keeping In before
// Out, how the point reads, and the two halves of the seam view.
// Node-tested.
import { barBeat } from './geometry.js';

/** A full pad's width of ZOOM drag zooms this many times. */
export const ZOOM_PER_PAD = 64;
/** A full pad's width of POSITION drag moves the point by this share of the visible span. */
export const POSITION_PER_PAD = 0.5;

/**
 * viewAbout is a view width px wide at fpp (kept within [minFpp, the whole
 * take]) with frame in the middle -- or as near the middle as the take's
 * ends allow.
 */
export function viewAbout(frame, fpp, width, total, minFpp) {
  const f = Math.min(Math.max(minFpp, total / width), Math.max(minFpp, fpp));
  const span = width * f;
  const start = Math.min(Math.max(0, frame - span / 2), Math.max(0, total - span));
  return { start, fpp: f, width };
}

/** zoomBy is the fpp after a ZOOM drag of dx px on a pad padW wide: right is closer. */
export function zoomBy(fpp, dx, padW) {
  return fpp * Math.pow(ZOOM_PER_PAD, -dx / padW);
}

/** positionBy is how many frames a POSITION drag of dx px on a pad padW wide moves the point. */
export function positionBy(dx, padW, view) {
  return (dx / padW) * view.width * view.fpp * POSITION_PER_PAD;
}

/** stepFrames is one step: a sample when zoomed past a pixel a sample, else a millisecond. */
export function stepFrames(fpp, sampleRate) {
  return fpp < 1 ? 1 : Math.max(1, Math.round(sampleRate / 1000));
}

/** stepLabel names a step. */
export function stepLabel(frames, sampleRate) {
  return frames === 1 ? '1 smp' : `${Math.round((frames * 1000) / sampleRate)} ms`;
}

/**
 * placeEdge is where a boundary may go: a whole frame inside the take, and
 * for In and Out, at least minLen short of the other end. edge is 'start',
 * 'end' or 'downbeat'.
 */
export function placeEdge(edge, frame, { region, total, minLen }) {
  let f = Math.round(Math.min(total - 1, Math.max(0, frame)));
  if (region && edge === 'start') f = Math.max(0, Math.min(f, region.end - minLen));
  if (region && edge === 'end') f = Math.min(total, Math.max(f, region.start + minLen));
  return f;
}

/** fmtSample reads a frame as m:ss.mmm and the samples past that millisecond: "0:02.500 +31". */
export function fmtSample(frame, sampleRate) {
  const ms = Math.floor((frame * 1000) / sampleRate);
  const extra = Math.max(0, frame - Math.ceil((ms * sampleRate) / 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')} +${extra}`;
}

/**
 * beatOffset is how far a frame sits from its nearest beat line, in ms, and
 * that beat as bar.beat; null without a tempo.
 */
export function beatOffset(frame, grid) {
  if (!grid || !grid.bpm) return null;
  const beat = (60 / grid.bpm) * grid.sampleRate;
  const k = Math.round((frame - grid.downbeat) / beat);
  const line = grid.downbeat + k * beat;
  return { ms: ((frame - line) * 1000) / grid.sampleRate, at: barBeat(Math.round(line), grid) };
}

/** fmtOffset reads beatOffset: "+3.1 ms from 3.1", "on 3.1". */
export function fmtOffset(off) {
  if (!off) return '';
  if (Math.abs(off.ms) < 0.05) return `on ${off.at}`;
  return `${off.ms > 0 ? '+' : '−'}${Math.abs(off.ms).toFixed(1)} ms from ${off.at}`;
}

/**
 * crossedLine says whether moving from a to b crossed a line every step
 * frames from origin: the moments the editor ticks.
 */
export function crossedLine(a, b, origin, step) {
  if (!(step > 0) || a === b) return false;
  return Math.floor((a - origin) / step) !== Math.floor((b - origin) / step);
}

/**
 * seamHalves is the seam view's two halves of a view width px wide at fpp:
 * on the left, the stretch ending at Out; on the right, the stretch from In.
 * Each is a view half as wide.
 */
export function seamHalves(region, fpp, width) {
  const half = width / 2;
  const span = half * fpp;
  return {
    left: { start: region.end - span, fpp, width: half },
    right: { start: region.start, fpp, width: half },
  };
}
```

- [ ] **Step 4: Run the tests.** `node --test web/static/lib/wave/boundary.test.js` — 9 pass.

- [ ] **Step 5: Commit** — "The boundary editor's maths: encoders, steps, the readout, the seam" (with the trailer).

---

### Task 3: `lib/wave/near.js` — the audio around a point

**Files:**
- Create: `web/static/lib/wave/near.js`
- Test: `web/static/lib/wave/near.test.js`

**Interfaces:**
- Consumes: `parseWav16` (Task 1).
- Produces: `class NearAudio { constructor({ file, sampleRate, total, fetchFn }); async around(frame) → { x: Float32Array, from: number } }` — `x[k]` is the mono sample at frame `from + k`; rejects with an `Error` whose message says why when the fetch fails.

- [ ] **Step 1: Write the tests** — `web/static/lib/wave/near.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NearAudio, SPAN_MS } from './near.js';

// A WAV of `frames` mono 16-bit samples, sample k = k mod 1000 (so a test
// can tell which frames came back).
function wav(frames, sr = 48000) {
  const buf = new ArrayBuffer(44 + frames * 2);
  const dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + frames * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, frames * 2, true);
  for (let k = 0; k < frames; k++) dv.setInt16(44 + k * 2, k % 1000, true);
  return buf;
}

test('it asks the slice endpoint for the span round the point, and caches it', async () => {
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    const u = new URL(url, 'http://x');
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    return { ok: true, arrayBuffer: async () => wav(to - from) };
  };
  const near = new NearAudio({ file: 'jam a.wav', sampleRate: 48000, total: 480000, fetchFn });
  const half = (48000 * SPAN_MS) / 1000;
  const a = await near.around(100000);
  assert.equal(a.from, 100000 - half);
  assert.equal(a.x.length, 2 * half);
  assert.match(urls[0], /^\/api\/slice\?file=jam%20a\.wav&from=\d+&to=\d+$/);
  await near.around(100000 + 10); // within the same span: no new fetch
  assert.equal(urls.length, 1);
});

test('near the start or the end, the span stops at the take', async () => {
  const fetchFn = async (url) => {
    const u = new URL(url, 'http://x');
    return { ok: true, arrayBuffer: async () => wav(Number(u.searchParams.get('to')) - Number(u.searchParams.get('from'))) };
  };
  const near = new NearAudio({ file: 'a.wav', sampleRate: 48000, total: 30000, fetchFn });
  const a = await near.around(100);
  assert.equal(a.from, 0, 'at the start, it starts at 0');
  assert.equal(a.x.length, 100 + 12000);
  const z = await near.around(29900);
  assert.equal(z.from, 29900 - 12000);
  assert.equal(z.from + z.x.length, 30000, 'at the end, it stops at the take');
});

test('a failed load rejects, saying why, and a later call tries again', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const near = new NearAudio({ file: 'a.wav', sampleRate: 48000, total: 480000, fetchFn });
  await assert.rejects(near.around(100000), /404/);
  await assert.rejects(near.around(100000), /404/);
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run them to see them fail.** `node --test web/static/lib/wave/near.test.js` — FAIL: cannot find `./near.js`.

- [ ] **Step 3: Write the module** — `web/static/lib/wave/near.js`:

```js
// web/static/lib/wave/near.js
// The audio round a point, for the boundary editor's Attack and Zero: a
// short stretch from /api/slice (16-bit, which the browser caches as
// immutable), mixed to mono. One stretch is kept; a point inside its middle
// half reuses it.
import { parseWav16 } from './onset.js';

/** How far either side of the point a stretch reaches. */
export const SPAN_MS = 250;

const defaultFetch = (...args) => globalThis.fetch(...args);

export class NearAudio {
  constructor({ file, sampleRate, total, fetchFn = defaultFetch }) {
    this.file = file;
    this.sr = sampleRate;
    this.total = total;
    this.fetchFn = fetchFn;
    this.half = Math.round((sampleRate * SPAN_MS) / 1000);
    this.kept = null; // { from, x }
  }

  /** around answers { x, from }: mono samples x[k] at frame from + k, reaching SPAN_MS either side of frame where the take allows. */
  async around(frame) {
    const k = this.kept;
    if (k && frame - k.from >= this.half / 2 && k.from + k.x.length - frame >= this.half / 2) return k;
    const from = Math.max(0, Math.round(frame) - this.half);
    const to = Math.min(this.total, Math.round(frame) + this.half);
    const res = await this.fetchFn(`/api/slice?file=${encodeURIComponent(this.file)}&from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`the audio there didn't load (${res.status})`);
    const { mono } = parseWav16(await res.arrayBuffer());
    this.kept = { from, x: mono };
    return this.kept;
  }
}
```

- [ ] **Step 4: Run the tests.** 3 pass.

- [ ] **Step 5: Commit** — "Fetch the audio round a point, for Attack and Zero" (with the trailer).

---

### Task 4: Draw the edited boundary and the seam view

**Files:**
- Modify: `web/static/lib/wave/view.js` (`paint()` → a new `paintBody()`, `hit()`, `tapAt()`)
- Modify: `web/static/lib/edit/gestures.js` (`wheel(e)`)

**Interfaces:**
- Consumes: page state (from `getState()`) gains `st.edit = null | { edge: 'start'|'end'|'downbeat', seam: boolean, side: 'start'|'end' }`; `seamHalves` (Task 2).
- Produces: view event `seamSide` `{ side: 'start'|'end' }` on a tap in a seam half; an optional wheel hook: if the surface has `this.onWheel` and it returns `true`, `wheel(e)` does nothing else.

- [ ] **Step 1: The wheel hook.** In `GestureSurface.wheel(e)`, after `e.preventDefault();` add:

```js
    // A surface can take the wheel over (the take page's boundary editor
    // moves its point with it).
    if (this.onWheel && this.onWheel(e)) return;
```

- [ ] **Step 2: The edited boundary.** In `WaveView.paint()`, after the grease-pencil selection edges and before the pending In/Out, add (using the window inks the reel PR 1 tokens define):

```js
    // The boundary being edited: a bright line through ruler and body, and
    // its name, so it reads at any zoom.
    const ed = st.edit;
    if (ed && !ed.seam) {
      const frame = ed.edge === 'start' ? sel?.start : ed.edge === 'end' ? sel?.end : st.grid.downbeat;
      if (frame != null) {
        const x = Math.round(frameToX(frame, view)) + 0.5;
        const c = ed.edge === 'downbeat' ? col('--warn', '#b58900') : col('--sel', '#268bd2');
        ctx.save();
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.font = `600 11px ${col('--font', 'system-ui')}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = c;
        const label = ed.edge === 'start' ? 'In' : ed.edge === 'end' ? 'Out' : '1';
        ctx.fillText(label, x + 4, top + 4);
        ctx.restore();
      }
    }
```

- [ ] **Step 3: The seam view.** Reel-to-reel PR 6 draws the body as a trace on tape: oxide painted once per size, then the grid lines, then each lane's trace (`traceLines` / `drawTrace` from `tape-strip.js`, levels from `this.tiles.columns(view, dpr)`, scaled by `this.gain`, the played part lit up to the cursor). Make that one method, so the seam view can draw it twice:

  1. Move the code in `paint()` from the comment `// Beat and bar lines in the body.` through the end of the trace lanes (the `ctx.restore()` after the lanes loop) into a new method that draws a given view into the strip `[x0, x0 + width)` of the canvas:

```js
  // paintBody draws the grid lines and the take's trace for v into the
  // canvas strip [x0, x0 + v.width), clipped to it: once for the whole
  // view, or once for each half of the seam view.
  paintBody(v, x0, top, bottom, col, st) {
    const { ctx, dpr } = this;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, top, v.width, bottom - top); ctx.clip();
    ctx.translate(x0, 0);
    // (the moved code, with every `view` replaced by `v` and every `W` that
    // meant the view's width replaced by `v.width`; the cursor's x is
    // frameToX(st.cursor, v), so in the seam view the lit part follows each
    // half's own frames)
    ctx.restore();
  }
```

  and in `paint()` call it where that code was: `this.paintBody(view, 0, top, bottom, col, st);`. Check the take page looks exactly as before (the demo, Task 7) — this step must not change any pixels outside the seam view.

  2. In `paint()`, when `st.edit?.seam && sel`, draw two halves instead, then the join:

```js
    if (st.edit?.seam && sel) {
      const { left, right } = seamHalves(sel, view.fpp, W);
      this.paintBody(left, 0, top, bottom, col, st);
      this.paintBody(right, W / 2, top, bottom, col, st);
      // The join, and a wash over the side the encoders move.
      const mid = Math.round(W / 2) + 0.5;
      ctx.strokeStyle = col('--sel', '#4ebeb4');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, bottom); ctx.stroke();
      ctx.fillStyle = withAlpha(col('--sel', '#4ebeb4'), 0.12);
      ctx.fillRect(st.edit.side === 'end' ? 0 : W / 2, top, W / 2, bottom - top);
      ctx.font = `600 11px ${col('--font', 'system-ui')}`;
      ctx.fillStyle = col('--well-dim', '#a39d90');
      ctx.textBaseline = 'top';
      ctx.fillText('…end', 6, top + 4);
      ctx.fillText('start…', W / 2 + 6, top + 4);
    } else {
      this.paintBody(view, 0, top, bottom, col, st);
    }
```

  `seamHalves` is from `./boundary.js` (Task 2). In the seam view, skip what belongs to a single continuous view: the selection band, the grease-pencil marks, the grips, the flags and the ruler's ticks (leave the ruler blank but for the two labels above). The oxide is drawn as now, across the whole body.

- [ ] **Step 4: Tapping a seam half.** In `hit(x, y)`, when `st.edit?.seam`, any point in the body returns `{ kind: 'seam', side: x < this.cssW / 2 ? 'end' : 'start' }`; in `tapAt(p, h)`, `if (h.kind === 'seam') { this.emit('seamSide', { side: h.side }); return; }`. Grips, pins and the downbeat handle are not hit-tested in seam view.

- [ ] **Step 5: Run the node tests** (all of them) — nothing in them covers drawing; they must still pass. `node --check web/static/lib/wave/view.js web/static/lib/edit/gestures.js`.

- [ ] **Step 6: Commit** — "Draw the boundary being edited, and the seam" (with the trailer).

---

### Task 5: The editor bar

**Files:**
- Modify: `web/static/wave.html` (after `#sel-row`, inside `.toolbar`)
- Modify: `web/static/styles.css`
- Modify: `web/static/lib/wave/page.js`
- Modify: `web/static/lib/wave/view.js` (`grabEnd`: a tap on bar 1 emits `downbeatTap`)

**Interfaces:**
- Consumes: Tasks 1–4. Existing page functions: `selectionChanged()`, `saveDownbeat()`, `renderSelection()`, `updateReadout()`, `redraw()`, `seekTo(frame)`, `togglePlay()`, `clock`, `state` (`region`, `grid`, `snap`, `loop`, `cursor`), `toast(msg, kind)`, `view` (a `WaveView`), `minLen`, `total`, `sr`, `file`, `MIN_FPP` from `../edit/gestures.js`, `snapFrame(frame, grid, snap)` and `snapStep(grid, snap)` from `./geometry.js`.
- Produces: `state.edit` as Task 4 describes.

- [ ] **Step 1: Markup.** After `#sel-row` in `wave.html`:

```html
      <div id="boundary-editor" class="boundary-editor" hidden>
        <div class="be-head">
          <span id="boundary-readout" class="mono be-readout"></span>
          <button id="be-done" class="icon-btn" type="button" data-tip="be-done">Done</button>
        </div>
        <div id="be-zoom" class="be-pad" role="slider" tabindex="0" aria-label="Zoom about the point" data-tip="be-zoom"><span>ZOOM</span></div>
        <div id="be-pos" class="be-pad" role="slider" tabindex="0" aria-label="Move the point" data-tip="be-pos"><span>POSITION</span></div>
        <div class="tb-row be-keys">
          <button id="be-attack" class="icon-btn" type="button" data-tip="be-attack">Attack</button>
          <button id="be-zero" class="icon-btn" type="button" data-tip="be-zero">Zero</button>
          <button id="be-grid" class="icon-btn" type="button" data-tip="be-grid">Grid</button>
          <button id="be-back" class="nudge" type="button" aria-label="Back one step" data-tip="be-step">◂</button>
          <span id="be-step" class="mono be-step"></span>
          <button id="be-fwd" class="nudge" type="button" aria-label="On one step" data-tip="be-step">▸</button>
          <button id="be-play" class="icon-btn" type="button" aria-label="Play from here" data-tip="be-play">▶</button>
          <button id="be-seam" class="icon-btn" type="button" aria-pressed="false" data-tip="be-seam">Seam</button>
        </div>
      </div>
```

  And make the In and Out readouts (`#sel-in`, `#sel-out`) buttons in effect: give them `role="button" tabindex="0"` and `data-tip="be-open"`.

- [ ] **Step 2: Styles** (`styles.css`, near the selection row's rules). The pads are wells (recessed), labelled small; the keys use the existing key classes; Seam's LED is yellow when latched; nothing orange. Every hover rule inside `@media (hover: hover)`; the editor's appearance (if animated) off under `prefers-reduced-motion`.

```css
.boundary-editor { display: grid; gap: 6px; }
.be-head { display: flex; align-items: center; gap: 8px; }
.be-readout { flex: 1; font-size: 13px; }
.be-pad {
  height: 40px; border-radius: 8px; background: var(--well); color: var(--well-dim);
  box-shadow: var(--inset, inset 0 1px 3px rgba(0,0,0,.4));
  display: flex; align-items: center; padding: 0 12px; font: 600 11px var(--font);
  letter-spacing: .08em; touch-action: none; user-select: none; -webkit-user-select: none; cursor: ew-resize;
}
.be-pad.active { color: var(--well-ink); }
.be-pad:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus); }
.be-keys { flex-wrap: wrap; }
.be-step { min-width: 46px; text-align: center; font-size: 12px; }
#be-seam[aria-pressed="true"]::before { background: var(--warn); box-shadow: 0 0 9px var(--warn-glow, transparent); }
```

  Match the LED pseudo-element pattern PR 1 uses for `#snap[aria-pressed="true"]::before` (copy its geometry rules for `#be-seam`). Where a token named here doesn't exist after PR 1, use PR 1's equivalent and say so in the report.

- [ ] **Step 3: Editing state.** In `page.js`, add `edit: null` to `state` and:

```js
  // --- the boundary editor ---------------------------------------------------
  // A boundary (In, Out or bar 1) selected for editing: the view centres on
  // it and follows it, and the editor bar's two encoders, snaps and steps
  // move it. See docs/superpowers/specs/2026-10-05-boundary-editor-design.md.
  const near = new NearAudio({ file, sampleRate: sr, total });
  const editFrame = () => {
    const e = state.edit;
    if (!e) return null;
    if (e.seam) return e.side === 'start' ? state.region?.start : state.region?.end;
    return e.edge === 'start' ? state.region?.start : e.edge === 'end' ? state.region?.end : state.grid.downbeat;
  };
  const editEdge = () => (state.edit?.seam ? state.edit.side : state.edit?.edge);
  function follow(fpp = view.view.fpp) {
    const f = editFrame();
    if (f == null) return;
    if (state.edit.seam) { view.view.fpp = Math.min(view.maxFpp(), Math.max(MIN_FPP, fpp)); view.clampView(); view.changed(); return; }
    Object.assign(view.view, viewAbout(f, fpp, view.view.width, total, MIN_FPP));
    view.changed();
  }
  function renderEditor() {
    const on = !!state.edit;
    $('boundary-editor').hidden = !on;
    $('sel-row').classList.toggle('editing', on);
    if (!on) return;
    const f = editFrame();
    const off = fmtOffset(beatOffset(f, state.grid));
    $('boundary-readout').textContent = `${editEdge() === 'start' ? 'In' : editEdge() === 'end' ? 'Out' : 'Bar 1'} ${fmtSample(f, sr)}${off ? ` · ${off}` : ''}`;
    $('be-step').textContent = stepLabel(stepFrames(view.view.fpp, sr), sr);
    $('be-grid').hidden = !state.grid.bpm;
    $('be-seam').hidden = !(state.region && state.loop);
    $('be-seam').setAttribute('aria-pressed', String(!!state.edit.seam));
  }
  function startEditing(edge) {
    if (edge === 'downbeat' && !state.grid.bpm) return;
    if (edge !== 'downbeat' && !state.region) return;
    state.edit = { edge, seam: false, side: edge === 'end' ? 'end' : 'start' };
    follow();
    renderEditor(); redraw();
  }
  function stopEditing() {
    if (!state.edit) return;
    state.edit = null;
    renderEditor(); redraw();
  }
  // Moves the edited boundary to frame; final saves (one undo step).
  function moveEdit(frame, final) {
    const edge = editEdge();
    const prev = editFrame();
    const f = placeEdge(edge, frame, { region: state.region, total, minLen });
    if (edge === 'downbeat') {
      state.grid.downbeat = f;
      updateReadout();
      if (final) saveDownbeat();
    } else {
      state.region = { ...state.region, [edge]: f };
      if (final) selectionChanged(); else renderSelection();
    }
    const step = snapStep(state.grid, state.snap === 'off' ? 'beat' : state.snap);
    if (step && crossedLine(prev, f, state.grid.downbeat, step) && navigator.vibrate) navigator.vibrate(5);
    if (!state.edit.seam) follow();
    renderEditor(); redraw();
  }
```

  Import `viewAbout, zoomBy, positionBy, stepFrames, stepLabel, placeEdge, fmtSample, beatOffset, fmtOffset, crossedLine` from `./boundary.js`, `NearAudio` from `./near.js`, `findAttack, findZero` from `./onset.js`, and `MIN_FPP` from `../edit/gestures.js` (export it there if it isn't exported; it is: `export const MIN_FPP`). Check how `snapStep` is named and exported in `./geometry.js` and use it.

- [ ] **Step 4: Opening and closing.** `#sel-in` / `#sel-out` click (and Enter/Space) → `startEditing('start' | 'end')`, or `stopEditing()` if that boundary is already being edited. The downbeat: in the `emit` handler, the view already reports a drag of bar 1 as `downbeatChange`; add a tap: in `view.js` `grabEnd`, when the grabbed thing is the downbeat and it did **not** move (`!g.moved`), `this.emit('downbeatTap', {})`; in the page, `case 'downbeatTap': startEditing('downbeat'); break;`. `#be-done` and Escape → `stopEditing()`. Clearing the selection, or the region becoming null, stops editing an In or Out (call `stopEditing()` in `clearSelection`). `case 'seamSide': if (state.edit?.seam) { state.edit.side = p.side; renderEditor(); redraw(); } break;`.

- [ ] **Step 5: The encoders.** One helper wires a pad as a relative knob:

```js
  // A pad turned by dragging sideways: fn(dx, padWidth, final) for each move,
  // and once more with final on release.
  function wirePad(pad, fn) {
    let last = null, id = null;
    pad.addEventListener('pointerdown', (e) => {
      if (!state.edit) return;
      id = e.pointerId; last = e.clientX;
      pad.setPointerCapture(id); pad.classList.add('active');
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - last; last = e.clientX;
      if (dx) fn(dx, pad.getBoundingClientRect().width, false);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; pad.classList.remove('active');
      fn(0, pad.getBoundingClientRect().width, true);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }
  let posAcc = 0; // fractional frames the POSITION pad has turned but not yet moved
  wirePad($('be-zoom'), (dx, w) => { follow(zoomBy(view.view.fpp, dx, w)); renderEditor(); });
  wirePad($('be-pos'), (dx, w, final) => {
    posAcc += positionBy(dx, w, view.view);
    const whole = Math.trunc(posAcc);
    posAcc -= whole;
    if (whole || final) moveEdit(editFrame() + whole, final);
  });
```

  Keyboard on a focused pad: ←/→ = one step on POSITION (or zoom ×½ / ×2 on ZOOM); Shift = ten.

- [ ] **Step 6: Snaps and steps.**

```js
  async function snapTo(kind) {
    const f = editFrame();
    if (f == null) return;
    if (kind === 'grid') { moveEdit(snapFrame(f, state.grid, state.snap === 'off' ? 'beat' : state.snap), true); return; }
    const btn = $(kind === 'attack' ? 'be-attack' : 'be-zero');
    btn.classList.add('waiting');
    try {
      const { x, from } = await near.around(f);
      const i = f - from;
      const radius = kind === 'attack'
        ? Math.min(Math.round(sr * 0.06), Math.round((view.view.width * view.view.fpp) / 2))
        : Math.round(sr * 0.005);
      const j = kind === 'attack' ? findAttack(x, sr, i, radius) : findZero(x, i, radius);
      if (j < 0) { toast(kind === 'attack' ? 'No hit near here' : 'No zero crossing near here'); return; }
      moveEdit(from + j, true);
    } catch (e) {
      toast(`Could not read the audio: ${e.message}`, 'bad');
    } finally {
      btn.classList.remove('waiting');
    }
  }
  $('be-attack').addEventListener('click', () => snapTo('attack'));
  $('be-zero').addEventListener('click', () => snapTo('zero'));
  $('be-grid').addEventListener('click', () => snapTo('grid'));
  const step = (sign, n = 1) => () => moveEdit(editFrame() + sign * n * stepFrames(view.view.fpp, sr), true);
  $('be-back').addEventListener('click', step(-1));
  $('be-fwd').addEventListener('click', step(1));
```

  Check `snapFrame`'s argument order in `geometry.js` (`snapFrame(frame, grid, snap)`) and use it as defined there.

- [ ] **Step 7: Hearing it, and the seam.** `#be-play`: In → `seekTo(region.start)`; Out → `seekTo(region.end - sr)` (not before 0); bar 1 → `seekTo(grid.downbeat)`; then start playback if it isn't playing (`if (!clock.playing) togglePlay()`). `#be-seam`: toggles `state.edit.seam` (only with a region and the loop on), setting `state.edit.side` to the edge being edited (`'start'` for bar 1); `follow()`; `renderEditor(); redraw();`. When the loop is turned off (`setLoop(false)`) or the region cleared, `state.edit.seam = false`.

- [ ] **Step 8: Keyboard and wheel while editing.** In the page's `keydown` handler, before the `switch`, when `state.edit`: `ArrowLeft`/`ArrowRight` → `step(∓1, e.shiftKey ? 10 : 1)()`, `Escape` → `stopEditing()`, and `preventDefault()`; other keys fall through. Set `view.onWheel = (e) => { if (!state.edit) return false; const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; if (e.metaKey || e.ctrlKey) follow(view.view.fpp * Math.exp(e.deltaY * k * 0.01)); else moveEdit(editFrame() + Math.round((e.deltaY + e.deltaX) * k * view.view.fpp), true); renderEditor(); return true; };`.

- [ ] **Step 9: Keep it right.** Call `renderEditor()` at the end of `renderSelection()` and wherever the page re-renders the header after a refresh (`applyTake`), and `stopEditing()` if an In/Out edit's region disappears. A resize keeps following (`follow()` from the view's resize path via the `viewChange` event when editing — only if the point has left the view).

- [ ] **Step 10: Run the node tests and check syntax.** `node --check web/static/lib/wave/page.js`; the full node command.

- [ ] **Step 11: Commit** — "Edit a boundary to the sample: two encoders, Attack, Zero, Grid and the seam" (with the trailer).

---

### Task 6: The guide and the tips

**Files:**
- Modify: `docs/guide.md` (§4, the take page; §9's tips table)
- Modify: `web/static/lib/help/tips.js`

- [ ] **Step 1:** In §4, after the selection bullets, add a short **"Placing a boundary exactly"** paragraph in the guide's voice: tap In's or Out's time (or tap bar 1) to edit it; the view centres on it; ZOOM and POSITION are two knobs you turn by dragging sideways — zoom out, get near, zoom in, get nearer; Attack, Zero and Grid snap it; ◂ ▸ step a millisecond or, zoomed right in, a sample; ▶ plays from it; Seam shows the end of the loop running into its start — a jump at the middle line is the click or stutter; Done (or Escape) closes it. On a computer, the wheel moves it, ⌘ or Ctrl with the wheel zooms, ←/→ step, Shift steps ten.
- [ ] **Step 2:** Add tips for `be-open`, `be-done`, `be-zoom`, `be-pos`, `be-attack`, `be-zero`, `be-grid`, `be-step`, `be-play`, `be-seam` to `tips.js` **and** the same rows, in the same order, to the guide's tips table.
- [ ] **Step 3:** The full node command (the help test checks the two match) and `CGO_ENABLED=0 go test ./internal/api/`.
- [ ] **Step 4: Commit** — "Guide: placing a boundary exactly" (with the trailer).

---

### Task 7: Check it in the demo

**Files:** none, unless a check fails.

Run the demo on an unused port (another session's demo often holds 15173): `RING_SECONDS=120 OUTPUT_DIR=<scratch> TAPE=true TAPE_DIR=<scratch> PORT=15199 CGO_ENABLED=0 go run ./cmd/hindsight --demo`. Confirm the page you test is this tree's (`lsof -nP -iTCP:15199 -sTCP:LISTEN` and the process's cwd). At 390 × 844:

- [ ] Capture 30 s, open the take, select about 2 bars, tap In's time → the view centres on In; the editor bar shows; the readout reads *In 0:0x.xxx +n · …*.
- [ ] ZOOM all the way out, POSITION In near a kick, ZOOM in, Attack → In sits on the kick's first sample (the readout's offset is the same, to 0.1 ms, for two different kicks: the demo's kicks are on its grid).
- [ ] Zero → In moves under 5 ms. ◂ ▸ step 1 ms; zoomed past 1 px/sample they step 1 sample.
- [ ] One POSITION drag then ↶ → In returns to where the drag began.
- [ ] Loop on, Seam → the end and start meet at the centre line; tap the left half, step → only Out moves.
- [ ] With playback looping, move Out → playback keeps going and the next pass uses the new Out.
- [ ] Tap bar 1 (no drag) → editing bar 1; Attack puts it on a kick; the grid moves with it.
- [ ] At the take's very start, In's editor still moves In (clamped at 0) and nothing throws (console clean).
- [ ] Nothing in the editor bar is cut off at 390 px; the waveform keeps at least half the screen.
- [ ] Stop the demo by its port only.
