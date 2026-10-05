# One transport: the now-playing bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one now-playing bar on every page, docked at the bottom, and
move the Tape page's right-hand column into two pull-out drawers above it
(direction A, "Main window").

**Architecture:**
- The bar is static markup in each page (`<section id="np">`), styled in
  `styles.css`. Its parts:
  - a reel window (`lib/bar/reel-window.js`, on the existing `ReelMotion`);
  - an amber LCD whose text comes from pure functions (`lib/bar/lcd.js`);
  - the transport keys;
  - the page's own keys;
  - the overview as a full-width scrubber;
  - the OUT pill.
- The Tape page keeps its ids and its poll; it only moves the controls and
  feeds the new parts.
- Later PRs:
  - drawers on the Tape page;
  - the take page's `Clock` driving the bar;
  - `tape-source.js` and `take-source.js`, so Takes and Capture can show the
    tape or a take;
  - folding the bar into a phone's mini player.

**Tech stack:** vanilla ES modules, CSS (one `styles.css`), `node --test`,
Playwright smoke scripts, Go 1.23 (one constant in PR 5).

**Spec:** `docs/superpowers/specs/2026-10-05-transport-bar-design.md`
**Canvas:** https://claude.ai/artifact/Px2DTatuTRFMZwfPmVx8mw. The boards come
from `~/programming/hindsight-design/transport/gen.py`, which holds the design
values: sizes, gradients and the LCD's ambers.

## Global constraints

- **Delivery.** Five PRs. After its final review, each one is fast-forwarded
  into local `main` and deployed (memory: restyle-merge-deploy-each):
  - fast-forward with `git fetch . <branch>:main`;
  - `make pi-status`, then `make deploy-dry`, then `make deploy-static` (no Go
    changes) or `make deploy` (PR 5).

  Don't open a GitHub PR. Pushing `main` cuts a release; ask first.
- **Ids are kept:**
  - `#play`, `#loop`, `#rec`, `#click`, `#catch-pass`, `#position`,
    `#tape-overview`, `#tape-out`, `#out-strip`;
  - every control in the toolbar rows, with its `data-tip`.

  New elements in the bar are prefixed `np-`.
- **Every new `data-tip`** gets a row in `web/static/lib/help/tips.js`, and
  the same row, in the same order, in the table in `docs/guide.md` §9.
  `help.test.js` fails otherwise.
- **`:hover`** only inside `@media (hover: hover)` (`styles.test.js`).
- **Text contrast** is 4.5:1 or more in both schemes. New LCD inks are
  tested on `--lcd`.
- **The service worker.** Each PR that adds or removes a file under
  `web/static/lib/` updates `SHELL` in `web/static/sw.js`, and every PR bumps
  `CACHE` (v27 now).
- **Reduced motion:** the reels don't turn (as `ReelMotion` already does),
  the marquee doesn't scroll, and the status LED doesn't blink.
- **JS tests:** `node --test 'web/static/lib/*.test.js' 'web/static/lib/wave/*.test.js' 'web/static/lib/phone/*.test.js' 'web/static/lib/help/*.test.js' 'web/static/lib/tape/*.test.js' 'web/static/lib/edit/*.test.js' 'web/static/lib/bar/*.test.js'`.
  Add `web/static/lib/bar/*.test.js` to the glob in `.github/workflows/ci.yml`
  and in `docs/development.md`.
- **Go:** `gofmt -l .` is empty; `go vet ./...` and `go test -race ./...`
  pass.
- **The demo, for every check by hand:**

  ```bash
  TAPE=true RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight PORT=15391 CGO_ENABLED=0 go run ./cmd/hindsight --demo
  ```

  Use a port of your own; other sessions' demos hold 15173 (memory: demo port
  collisions). Smoke scripts run with
  `HINDSIGHT_URL=http://127.0.0.1:15391 node scripts/smoke-tape.mjs`, after
  `npm install --no-save playwright@1.49.0 && npx playwright install chromium`.

## Review focus

- **The 1024 × 600 bench, every PR:** the bar, the lanes and (from PR 2) an
  open drawer all fit; no lane is under 48 px. Checked in `smoke-tape.mjs`.
- **A phone never loses Play or Catch:** upright or sideways, `#play` and
  `#catch-pass` are on screen and above the tabs. Checked in `smoke-tape.mjs`.
- **Phone output mode** (`output_mode: 'phone'`):
  - Catch still says it needs the jam room and opens `#jam-only`;
  - the Record drawer (PR 2) shows only the note and Overdub.

  Checked in `smoke-tape.mjs`.
- **No drawing loop runs while hidden or stopped:** `ReelWindow` stops its
  rAF when the reels stop moving and while the page is hidden, as
  `TapeMachine` did.
- **The LCD's messages** (count-in, mixing down, the tail, saving, no output)
  read exactly as `#position` did. Unit-tested in `lcd.test.js`.

---

## File map (PR 1)

| File | What changes |
|---|---|
| `web/static/lib/bar/lcd.js` (new) | Pure: the tape's counter, status and marquee |
| `web/static/lib/bar/lcd.test.js` (new) | Its tests |
| `web/static/lib/bar/reel-window.js` (new) | Two reels, the tape between them, the level bars |
| `web/static/lib/bar/reel-window.test.js` (new) | `levelFrac` |
| `web/static/tape.html` | The bar's markup; the deck and `.tape-where` go; `#play`…`#click`, `#catch-pass`, `#tape-overview`, `#tape-out`, `#out-strip`, `#position` and `#clock-out` move into it; a second OUT pill in the header for phones |
| `web/static/lib/tape/page.js` | `ReelWindow` instead of `TapeMachine`; `render()` uses `lcd.js`; `#to-start`; the scrubber's keys and `aria-valuetext`; the resize observer watches the scrubber |
| `web/static/lib/tape/output-ui.js` | Renders and wires every `.tape-out` |
| `web/static/lib/tape/machine.js` | Deleted |
| `web/static/styles.css` | The bar; the deck's CSS goes; the ≥1000 px grid loses the machine and overview rows; the phone dock becomes the bar |
| `web/static/lib/styles.test.js` | The deck test becomes a bar test; the dock test follows the bar |
| `web/static/lib/help/tips.js`, `docs/guide.md` | `to-start`; §8.2 rewritten for the bar |
| `scripts/smoke-tape.mjs` | The bench check measures to the bar; 1024 × 768 and 1470 × 900 added |
| `web/static/sw.js` | `SHELL` gets `lib/bar/*.js` and loses `machine.js`; `CACHE` v28 |
| `.github/workflows/ci.yml`, `docs/development.md` | The `lib/bar` test glob |

---

## PR 1: the bar on the Tape page (branch `claude/bar-1-tape`)

### Task 1: The LCD's words, `lib/bar/lcd.js`

**Files:**
- Create: `web/static/lib/bar/lcd.js`
- Test: `web/static/lib/bar/lcd.test.js`

**Interfaces:**
- **Produces:**
  - `tapeCounter(tape, live, md)` → `{big, small, status, unit}`. `status` is
    one of `'play' | 'stop' | 'rec' | 'armed'`; `unit` is `'BAR'` or `''`.
  - `tapeMarquee(tape, live)` → string.
- **Consumes:** `barBeat`, `fmtSecs` and `bpm` from `../tape/geometry.js`.

- [ ] **Step 1: Write the failing tests**

```js
// web/static/lib/bar/lcd.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeCounter, tapeMarquee } from './lcd.js';

const SR = 48000;
// 96 BPM, 4/4: a bar is 2.5 s. Sixteen bars on the grid, the loop bars 5–8.
const BAR = 2.5 * SR;
const tape = (over = {}) => ({
  id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR,
  grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 4 * BAR, out: 8 * BAR, on: true }, ...over,
});
const live = (over = {}) => ({ playing: false, heard: 0, out: 0, delivered: 0, count_in: 0, output: 'demo', output_mode: 'jam', ...over });

test('a stopped tape reads bar.beat large and the time small', () => {
  // 13.2 s is bar 6, beat 2 (a beat is 0.625 s).
  const c = tapeCounter(tape(), live({ heard: Math.round(13.2 * SR) }), null);
  assert.equal(c.big, '6.2');
  assert.equal(c.small, '0:13.2');
  assert.equal(c.status, 'stop');
  assert.equal(c.unit, 'BAR');
});

test('playing, recording and armed each have their status', () => {
  assert.equal(tapeCounter(tape(), live({ playing: true }), null).status, 'play');
  assert.equal(tapeCounter(tape(), live({ playing: true, record: { tape: 't1', track: 4, state: 'on' } }), null).status, 'rec');
  assert.equal(tapeCounter(tape(), live({ record: { tape: 't1', track: 4, state: 'armed' } }), null).status, 'armed');
  // A punch on another tape is not this tape's.
  assert.equal(tapeCounter(tape(), live({ playing: true, record: { tape: 't2', track: 1, state: 'on' } }), null).status, 'play');
});

test('a count-in takes over the position, as #position read', () => {
  const beat = BAR / 4;
  const c = tapeCounter(tape(), live({ playing: true, count_in: 3 * beat }), null);
  assert.equal(c.big, 'count-in 2 of 4');
  assert.equal(c.small, '');
  assert.equal(c.status, 'play');
});

test('a mixdown takes over the position, with the words #position had', () => {
  const md = { tape: 't1', state: 'playing', from: 0, to: 8 * BAR };
  const c = tapeCounter(tape(), live({ playing: true, heard: 2 * BAR }), md);
  assert.equal(c.big, 'mixing down');
  assert.equal(c.small, '0:05.0 of 0:20.0 · ■ cancels');
  assert.equal(tapeCounter(tape(), live(), { ...md, state: 'tail' }).small, 'letting it ring out · ■ cancels');
  assert.equal(tapeCounter(tape(), live(), { ...md, state: 'saving' }).big, 'saving');
});

test('no output says so where the time was', () => {
  assert.equal(tapeCounter(tape(), live({ output: '' }), null).small, 'no output');
});

test('a tape with no tempo shows its time large, with no unit', () => {
  const c = tapeCounter(tape({ grid: null }), live({ heard: 3 * SR }), null);
  assert.equal(c.big, '0:03.0');
  assert.equal(c.small, '');
  assert.equal(c.unit, '');
});

test('nothing polled yet: blank', () => {
  const c = tapeCounter(tape(), null, null);
  assert.deepEqual([c.big, c.small, c.status], ['', '', 'stop']);
});

test('the marquee names the tape, the tempo, the loop, the output and the punch', () => {
  assert.equal(tapeMarquee(tape(), live()), 'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM');
  assert.equal(tapeMarquee(tape({ loop: { in: 4 * BAR, out: 8 * BAR, on: false } }), live({ output_mode: 'phone' })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP OFF · ON A PHONE');
  assert.equal(tapeMarquee(tape(), live({ output_mode: 'both', record: { tape: 't1', track: 4, state: 'armed' } })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM AND ON A PHONE · TRACK 4 ARMED');
  assert.equal(tapeMarquee(tape(), live({ playing: true, record: { tape: 't1', track: 2, state: 'on' } })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM · RECORDING TRACK 2');
  assert.equal(tapeMarquee(tape({ grid: null }), null), 'TAPE 1 · NO TEMPO YET · IN THE JAM ROOM');
  // A one-bar loop reads as one bar.
  assert.equal(tapeMarquee(tape({ loop: { in: 4 * BAR, out: 5 * BAR, on: true } }), live()), 'TAPE 1 · 96.0 BPM · 4/4 · LOOP BAR 5 · IN THE JAM ROOM');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test web/static/lib/bar/lcd.test.js`
Expected: FAIL, `Cannot find module './lcd.js'`.

- [ ] **Step 3: Implement**

```js
// web/static/lib/bar/lcd.js
// What the now-playing bar's LCD says, apart from any drawing: the position
// (large), the line beside it (small), the status lamp, and the line that
// scrolls under them naming what's loaded. Pure, so every state is tested.
//
// The tape's messages -- the count-in, a mixdown and its tail, saving, no
// output -- are the ones #position used to show, word for word.

import { barBeat, fmtSecs, bpm } from '../tape/geometry.js';

const OUT_WORDS = { jam: 'IN THE JAM ROOM', phone: 'ON A PHONE', both: 'IN THE JAM ROOM AND ON A PHONE' };

/**
 * tapeCounter is the LCD for the tape at one poll. md is the live mixdown
 * when it is this tape's (else null).
 */
export function tapeCounter(tape, live, md) {
  const sr = tape.sample_rate;
  const rec = live && live.record && live.record.tape === tape.id ? live.record : null;
  const counting = !!(live && live.count_in > 0);
  const mixing = !!(md && (md.state === 'playing' || md.state === 'tail'));
  const playing = !!(live && (live.playing || counting)) || mixing;
  const status = rec && rec.state === 'on' && !counting ? 'rec' : rec && rec.state === 'armed' ? 'armed' : playing ? 'play' : 'stop';
  const unit = tape.grid ? 'BAR' : '';
  if (!live) return { big: '', small: '', status, unit };
  const heard = live.heard;
  if (counting && tape.grid) {
    // The render head is ahead of what's heard by what's rendered ahead.
    const beat = tape.grid.frames / tape.grid.bars / 4;
    const left = Math.min(tape.grid.frames / tape.grid.bars, live.count_in + Math.max(0, live.out - live.delivered));
    return { big: `count-in ${Math.min(4, Math.max(1, 4 - Math.floor((left - 1) / beat)))} of 4`, small: '', status, unit: '' };
  }
  if (md && md.state === 'playing') {
    return { big: 'mixing down', small: `${fmtSecs(Math.max(0, heard - md.from), sr)} of ${fmtSecs(md.to - md.from, sr)} · ■ cancels`, status, unit: '' };
  }
  if (md && md.state === 'tail') return { big: 'mixing down', small: 'letting it ring out · ■ cancels', status, unit: '' };
  if (md && md.state === 'saving') return { big: 'saving', small: 'the mixdown, as a take…', status, unit: '' };
  const time = fmtSecs(heard, sr);
  const big = tape.grid ? barBeat(heard, tape.grid) : time;
  const small = !live.output ? 'no output' : tape.grid ? time : '';
  return { big, small, status, unit };
}

/** tapeMarquee is the scrolling line: the tape, its tempo and loop, where it plays, and a punch. */
export function tapeMarquee(tape, live) {
  const parts = [tape.name.toUpperCase()];
  if (tape.grid) {
    const barLen = tape.grid.frames / tape.grid.bars;
    parts.push(`${bpm(tape.grid, tape.sample_rate).toFixed(1)} BPM`, '4/4');
    if (tape.loop.out > tape.loop.in && tape.loop.on) {
      const a = Math.floor(tape.loop.in / barLen + 1e-9) + 1;
      const b = Math.ceil(tape.loop.out / barLen - 1e-9);
      parts.push(a === b ? `LOOP BAR ${a}` : `LOOP BARS ${a}–${b}`);
    } else if (tape.loop.out > tape.loop.in) {
      parts.push('LOOP OFF');
    }
  } else {
    parts.push('NO TEMPO YET');
  }
  parts.push(OUT_WORDS[(live && live.output_mode) || 'jam'] || OUT_WORDS.jam);
  const rec = live && live.record && live.record.tape === tape.id ? live.record : null;
  if (rec) parts.push(rec.state === 'on' ? `RECORDING TRACK ${rec.track}` : `TRACK ${rec.track} ARMED`);
  return parts.join(' · ');
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `node --test web/static/lib/bar/lcd.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/bar/lcd.js web/static/lib/bar/lcd.test.js
git commit -m "Bar: the LCD's words for the tape, pure and tested"
```

---

### Task 2: The reel window, `lib/bar/reel-window.js`

**Files:**
- Create: `web/static/lib/bar/reel-window.js`
- Test: `web/static/lib/bar/reel-window.test.js`

**Interfaces:**
- **Produces:**
  - `levelFrac(db, ref = -10)` → 0..1;
  - `class ReelWindow`, with:
    - `new ReelWindow({left, right, levels})`: two `<svg viewBox="0 0 160 160">` elements and the levels `<span>`;
    - `setLevels(colours, fn)`: `colours` is CSS colours, one per bar; `fn(frame)` gives dBFS per bar;
    - `poll({heard, playing, length, sampleRate})`;
    - `start()`, `stop()`.
- **Consumes:** `ReelMotion` from `../tape/reels.js`.

- [ ] **Step 1: Write the failing test**

```js
// web/static/lib/bar/reel-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFrac } from './reel-window.js';

test('a level bar is empty at −40 dBFS and full 3 dB over the reference', () => {
  assert.equal(levelFrac(-Infinity), 0);
  assert.equal(levelFrac(-60), 0);
  assert.equal(levelFrac(-40), 0);
  assert.equal(levelFrac(-7), 1);          // ref −10, +3
  assert.equal(levelFrac(0), 1);
  assert.ok(Math.abs(levelFrac(-23.5) - 0.5) < 1e-9);
  assert.equal(levelFrac(NaN), 0);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test web/static/lib/bar/reel-window.test.js`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement.** The reels are `machine.js`'s, at the same
  geometry, centred in a 160 × 160 viewBox, so `packRadii`' defaults (hub 17,
  full 64) fit the flange (74) unchanged. The module must not touch `document`
  at import time, because the test imports it under node.

```js
// web/static/lib/bar/reel-window.js
// The bar's reel window: two reels either side of the LCD, turning with the
// playhead (lib/tape/reels.js), their packs filling and emptying over the
// tape, and the LCD's level bars, one per track. A picture of the
// transport, like the deck it replaces: hidden from assistive tech, sized by
// CSS.

import { ReelMotion } from '../tape/reels.js';

const NS = 'http://www.w3.org/2000/svg';
const C = 80, FLANGE = 74;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const circ = (cx, cy, r) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z `;

/** levelFrac is how full a level bar is for dBFS: empty at −40, full 3 dB over ref. */
export function levelFrac(db, ref = -10) {
  if (!(db > -40)) return 0;
  return clamp((db + 40) / (ref + 3 + 40), 0, 1);
}

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent.appendChild(n);
  return n;
}

// One reel: the well, the pack, and the flange that turns, with three
// windows the pack shows through.
function reel(svg) {
  el('circle', { class: 'np-well', cx: C, cy: C, r: FLANGE + 4 }, svg);
  const pack = el('circle', { class: 'np-pack', cx: C, cy: C, r: 40 }, svg);
  const turn = el('g', { class: 'np-turn' }, svg);
  let d = circ(C, C, FLANGE);
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 - 90) * Math.PI) / 180;
    d += circ(+(C + 42 * Math.cos(a)).toFixed(1), +(C + 42 * Math.sin(a)).toFixed(1), 21);
  }
  el('path', { class: 'np-flange', d, 'fill-rule': 'evenodd' }, turn);
  el('circle', { class: 'np-hub', cx: C, cy: C, r: 15 }, turn);
  turn.style.transformOrigin = `${C}px ${C}px`;
  return { pack, turn };
}

export class ReelWindow {
  constructor({ left, right, levels }) {
    this.left = reel(left);
    this.right = reel(right);
    this.levelsEl = levels;
    this.bars = [];
    this.levels = () => [];
    this.motion = null;
    this.raf = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  /** setLevels makes one bar per colour; fn(frame) gives each one's dBFS. */
  setLevels(colours, fn) {
    this.levels = fn;
    if (this.bars.length !== colours.length) {
      this.bars = colours.map(() => document.createElement('i'));
      this.levelsEl.replaceChildren(...this.bars);
    }
    // color too: the glow is currentColor.
    colours.forEach((c, i) => { this.bars[i].style.background = c; this.bars[i].style.color = c; });
  }

  poll({ heard, playing, length, sampleRate }) {
    if (!this.motion || this.motion.sr !== sampleRate) this.motion = new ReelMotion({ sampleRate, length, reduced: this.reduced });
    this.motion.setLength(length);
    this.motion.poll(heard, playing, performance.now());
    this.start();
  }

  start() {
    if (this.raf || document.hidden || !this.motion) return;
    const tick = (now) => {
      this.raf = 0;
      if (this.draw(now) && !document.hidden) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** draw paints the reels and the levels at `now`; it says whether anything still moves. */
  draw(now) {
    const m = this.motion.frame(now);
    this.left.pack.setAttribute('r', m.left.toFixed(1));
    this.right.pack.setAttribute('r', m.right.toFixed(1));
    this.left.turn.style.transform = `rotate(${m.angleL.toFixed(1)}deg)`;
    this.right.turn.style.transform = `rotate(${m.angleR.toFixed(1)}deg)`;
    const lv = m.moving === 'play' ? this.levels(m.pos) : [];
    this.bars.forEach((b, i) => { b.style.transform = `scaleY(${Math.max(0.08, levelFrac(lv[i])).toFixed(3)})`; });
    return m.moving !== 'stop';
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --test web/static/lib/bar/reel-window.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/static/lib/bar/reel-window.js web/static/lib/bar/reel-window.test.js
git commit -m "Bar: the reel window and its level bars"
```

---

### Task 3: The bar's markup on the Tape page

**Files:**
- Modify: `web/static/tape.html`

- [ ] **Step 1: Delete the deck.** Remove the comment and
  `<div id="tape-machine" class="tape-machine" aria-hidden="true"></div>`
  (`tape.html:93-95`).
- [ ] **Step 2: Take out what moves.** Remove these from their current
  places; Step 4 puts them back inside the bar:
  - `#out-strip` (`:96-101`), `canvas#tape-overview` (`:102`), the
    `.tb-row.transport` row (`:134-139`) and the `.tb-row.tape-where` row
    (`:140-143`);
  - `#catch-pass` from `.tb-row.catch`. The row keeps `#catch-bars` and
    `#catch-mode`; put a label before them:
    `<span class="tb-label">Catch the last</span>`.
- [ ] **Step 3: The header's OUT pill becomes the phone's.** Change
  `id="tape-out"` to `id="tape-out-top"`, and
  `<span id="tape-out-text" class="pill-text">` to
  `<span class="pill-text tape-out-text">`. Keep its classes, including
  `tape-out`, and `data-tip="tape-out"`.
- [ ] **Step 4: The bar.** Insert it after `</main>` and before the
  `#jam-only` dialog:

```html
<!-- The now-playing bar (docs/superpowers/specs/2026-10-05-transport-bar-design.md):
     the reel window and its LCD, the transport, the page's own keys, the
     whole tape as a scrubber, and OUT. Docked at the bottom. -->
<section id="np" class="np" aria-label="Now playing">
  <div id="out-strip" class="out-strip" role="status" hidden>
    <span id="out-strip-led" class="out-led"></span>
    <span id="out-strip-text">Ready on this phone</span>
    <span id="out-strip-right" class="mono"></span>
    <button id="out-strip-resume" class="chip" type="button" aria-label="Tap to play here on this phone" hidden>Tap to play here</button>
  </div>
  <div class="np-row np-row-1">
    <div class="np-window">
      <svg id="np-reel-l" class="np-reel" viewBox="0 0 160 160" aria-hidden="true"></svg>
      <div class="np-lcd">
        <div class="np-lcd-top">
          <span id="np-status" class="np-status" data-state="stop" aria-hidden="true"></span>
          <span id="np-unit" class="np-unit" aria-hidden="true">BAR</span>
          <span id="position" class="np-pos"></span>
          <span id="np-time" class="np-time"></span>
          <span id="clock-out" class="np-clock" hidden data-tip="tape-clock"></span>
          <span id="np-levels" class="np-levels" aria-hidden="true"></span>
        </div>
        <div class="np-marquee" aria-hidden="true"><span id="np-marquee"></span></div>
      </div>
      <svg id="np-reel-r" class="np-reel" viewBox="0 0 160 160" aria-hidden="true"></svg>
    </div>
    <div class="np-keys tb-row transport" role="group" aria-label="Transport">
      <button id="to-start" class="icon-btn np-start" type="button" aria-label="Back to the loop’s start" data-tip="to-start"><svg width="18" height="16" viewBox="0 0 24 22" aria-hidden="true"><rect x="4" y="3" width="3" height="16" rx="1" fill="currentColor"/><path d="M20 4.2v13.6a1 1 0 0 1-1.55.84L9 12.84a1 1 0 0 1 0-1.68l9.45-6.8A1 1 0 0 1 20 4.2z" fill="currentColor"/></svg></button>
      <button id="play" class="icon-btn tb-play" type="button" aria-label="Play" aria-keyshortcuts="Space" data-tip="tape-play">▶</button>
      <button id="loop" class="icon-btn tb-loop" type="button" aria-pressed="false" aria-keyshortcuts="L" data-tip="tape-loop">⟲ Loop</button>
      <button id="rec" class="icon-btn tb-rec" type="button" aria-pressed="false" aria-keyshortcuts="R" data-tip="tape-rec">● Rec</button>
      <button id="click" class="icon-btn tb-click" type="button" aria-pressed="false" aria-label="Click" aria-keyshortcuts="K" data-tip="tape-click">♩</button>
    </div>
    <div class="np-own">
      <button id="catch-pass" class="icon-btn primary np-catch" type="button" data-tip="catch"><span class="np-catch-word">Catch</span><span class="np-catch-sub">the last pass</span></button>
    </div>
  </div>
  <div class="np-row np-row-2">
    <span id="np-mini" class="np-mini" aria-hidden="true"></span>
    <canvas id="tape-overview" class="tape-overview np-scrub" role="slider" tabindex="0" aria-label="The whole tape: tap to move the playhead, drag the box to move the view" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" data-tip="tape-overview"></canvas>
    <span class="menu-anchor out-anchor np-out">
      <button id="tape-out" class="tape-pill tape-out" type="button" aria-label="Output" aria-haspopup="dialog" data-tip="tape-out"><span class="pill-ico pill-out" aria-hidden="true">OUT</span><span class="pill-text tape-out-text">Jam room</span><span class="pill-chev" aria-hidden="true">▾</span></button>
    </span>
  </div>
</section>
```

  The bar keeps `tb-row transport` on `.np-keys`, so `styles.test.js`'s
  pressed-key rules (`.tb-row.transport .icon-btn[aria-pressed="true"]`) and
  the LEDs (`.tb-play::before` …) still apply. `.toolbar.editing > .tb-row`
  no longer reaches it, because it isn't in `.toolbar`, so the clip editor
  stops hiding the transport. That is wanted.

- [ ] **Step 5: Commit**

```bash
git add web/static/tape.html
git commit -m "Tape: the now-playing bar's markup; the deck goes"
```

---

### Task 4: The page drives the bar

**Files:**
- Modify: `web/static/lib/tape/page.js`, `web/static/lib/tape/output-ui.js`
- Delete: `web/static/lib/tape/machine.js`

- [ ] **Step 1: Imports.** Replace `import { TapeMachine } from './machine.js';`
  with:

```js
import { ReelWindow } from '../bar/reel-window.js';
import { tapeCounter, tapeMarquee } from '../bar/lcd.js';
```

- [ ] **Step 2: Feed the reels** instead of the machine (`feedMachine`,
  `page.js:253-299`). Rename it to `feedReels`, and its caller in `apply()`
  with it. Its comment says the bar's reel window and the LCD's level bars
  read what this poll said.

```js
let reels = null;

function feedReels() {
  const t = state.tape, live = state.live;
  if (!t) return;
  reels ??= new ReelWindow({ left: $('np-reel-l'), right: $('np-reel-r'), levels: $('np-levels') });
  const tracks = heardTracks();
  const anySolo = tracks.some((tr) => tr.solo);
  const peaksOf = (f) => peaks.get(f);
  const css = getComputedStyle(document.body);
  const col = (n, d) => css.getPropertyValue(n).trim() || d;
  reels.setLevels(t.tracks.map((tr) => trackColor(tr.n, col)),
    (frame) => tracks.map((tr) => levelAt(tr, frame, peaksOf, t.sample_rate, anySolo)));
  reels.poll({
    heard: live ? live.heard : 0,
    playing: !!(live && live.playing && !(live.count_in > 0)),
    length: t.length,
    sampleRate: t.sample_rate,
  });
}
```

  `heardTracks()` and `tracks` must be in the same order as `t.tracks`. Check
  that `heardTracks` maps `t.tracks` and doesn't filter it; if it filters,
  pass its colours in the same order instead.

- [ ] **Step 3: The LCD in `render()`.** Replace the block that writes
  `$('position')` (`page.js:405-420`, from `const heard = …` through the
  final `else`) with:

```js
  const lcd = tapeCounter(t, live, md);
  setText($('position'), lcd.big);
  setText($('np-mini'), lcd.big);   // the phone's small LCD (Task 5)
  setText($('np-time'), lcd.small);
  setText($('np-unit'), lcd.unit);
  setIf($('np-status'), 'data-state', lcd.status);
  setText($('np-marquee'), tapeMarquee(t, live));
  const ov = $('tape-overview');
  setIf(ov, 'aria-valuemax', String(t.length));
  setIf(ov, 'aria-valuenow', String(live ? live.heard : 0));
  setIf(ov, 'aria-valuetext', live ? `${t.grid ? `bar ${barBeat(live.heard, t.grid)}, ` : ''}${fmtSecs(live.heard, sr)}` : '');
```

  Add the helper beside `setIf`:

```js
function setText(el, v) {
  if (el.textContent !== v) el.textContent = v;
}
```

  `counting` is still used below this block (by `#rec`). Keep
  `const counting = !!(live && live.count_in > 0);` above the Rec code.

- [ ] **Step 4: Catch keeps its spans.** `page.js:455` sets
  `$('catch-pass').textContent`, which would wipe the two lines. Change it
  to:

```js
  setText($('catch-pass').querySelector('.np-catch-sub'), phoneOut ? 'jam room only' : 'the last pass');
  setIf($('catch-pass'), 'aria-label', phoneOut ? 'Catch: needs the jam room' : `Catch the last pass onto track ${state.track}`);
```

- [ ] **Step 5: |◂.** In `wire()`, beside the `#play` handler:

```js
  // |◂: to the loop's start while looping, else to the top of the tape.
  $('to-start').addEventListener('click', () => {
    const t = state.tape;
    if (!t) return;
    transport('locate', { pos: t.loop.on && t.loop.out > t.loop.in ? t.loop.in : 0 });
  });
```

  In `render()`, beside `#loop`:

```js
  $('to-start').disabled = !live;
  setIf($('to-start'), 'aria-label', t.loop.on && t.loop.out > t.loop.in ? 'Back to the loop’s start' : 'Back to the top of the tape');
```

- [ ] **Step 6: The scrubber's keys.** In `wireOverview()` (`page.js:1283`), on the overview canvas (`$('tape-overview')`; use the name `wireOverview` already gives it):

```js
  // A slider for the keyboard too: ← → a bar (a second with no tempo).
  cv.addEventListener('keydown', (e) => {
    const t = state.tape, live = state.live;
    if (!t || !live || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    e.stopPropagation();
    const step = t.grid ? t.grid.frames / t.grid.bars : t.sample_rate;
    const pos = Math.max(0, Math.min(t.length, live.heard + (e.key === 'ArrowRight' ? step : -step)));
    transport('locate', { pos });
  });
```

  `wire()`'s global keydown (`page.js:2178-2227`) uses ↑ and ↓ for tracks,
  not ← and →, so the two don't clash. Check that its early return for
  "typing in a field" doesn't also swallow a focused canvas.

- [ ] **Step 7: Redraw on the scrubber's resize too.** At `page.js:2300`:

```js
  const ro = new ResizeObserver(() => { drawLanes(); drawOverview(); drawRuler(); });
  ro.observe($('lanes'));
  ro.observe($('tape-overview'));
```

- [ ] **Step 8: Two OUT pills, one control.** In `output-ui.js`:
  - the click handler on `$('tape-out')` becomes
    `for (const b of document.querySelectorAll('.tape-out')) b.addEventListener('click', open)`,
    where `open` is the handler as it stands;
  - in `render(l)`, replace the two lines that set `$('tape-out')` and
    `$('tape-out-text')` with:

```js
    for (const b of document.querySelectorAll('.tape-out')) {
      b.hidden = !(l && l.output_mode);
      const txt = b.querySelector('.tape-out-text');
      if (txt.textContent !== NAMES[mode]) txt.textContent = NAMES[mode];
    }
```

  Grep `web/static` for `tape-out-text` and `getElementById('tape-out')`, and
  move any other use to the class.

- [ ] **Step 9: Delete `machine.js`.** Run `git rm web/static/lib/tape/machine.js`,
  then grep for `machine` in `web/static`: only `--machine-h` in
  `styles.css` should be left, and Task 5 removes it.

- [ ] **Step 10: Run the JS tests**

Run the suite from the global constraints.
Expected: PASS, apart from the `styles.test.js` deck and dock tests, which
Task 5 changes.

- [ ] **Step 11: Commit**

```bash
git add -A web/static/lib
git commit -m "Tape: the page drives the bar: reels, LCD, |◂, the scrubber's keys, both OUT pills"
```

---

### Task 5: The bar's look, and the Tape page's layout

**Files:**
- Modify: `web/static/styles.css`, `web/static/lib/styles.test.js`

Design values are from the canvas (`transport/gen.py`: `bar_a`,
`cass_window`, `counter`, `marquee`, `tape_overview`, `keyp`), mapped onto the
existing tokens:

- the bar's face is `linear-gradient(180deg, var(--face-hi), var(--face-lo))`
  under 1 px vertical brushing lines at 2.2 % white every 3 px;
- the window is the deck's metal (`--deck-hi` / `--deck-lo`) with the 3 px
  horizontal lines;
- the LCD is `--lcd` with `--lcd-ink` (#ffb547) glowing
  `0 0 7px rgba(255,181,71,.6)`; dim text is the same ink at 74 %.

- [ ] **Step 1: Update the stylesheet test first.** In `styles.test.js`:
  - in `'the tape deck tokens exist, and its lit legends read'`, keep the
    token and mute/solo checks, and replace the `.tm-state` loop with:

```js
  // The bar's LCD: its large position and its dim lines read on --lcd.
  for (const sel of ['.np-pos', '.np-time']) {
    const r = RULES.filter((x) => x.sel.includes(sel)).map((x) => /(?:^|;)\s*color:\s*([^;]+);/.exec(x.body)).filter(Boolean).at(-1);
    assert.ok(r, `${sel} has a colour`);
    for (const [scheme, t] of [['light', light], ['dark', dark]]) {
      const c = contrast(resolve(r[1], t), t['--lcd']);
      assert.ok(c >= 4.5, `${scheme} ${sel} on --lcd is ${c.toFixed(2)}:1`);
    }
  }
```

  - the phone-dock test becomes:

```js
// On a phone, upright or sideways, the bar is docked: Play, Loop, Rec and
// Catch always on screen, whatever the page has scrolled to.
test('a phone docks the now-playing bar', () => {
  const at = css.indexOf('@media (max-width: 699.98px), (orientation: landscape) and (max-height: 440px)');
  assert.ok(at > 0, 'a media block for both phone shapes');
  assert.match(block(at), /\.np\s*\{[^}]*position:\s*fixed/);
});
```

  The bar's dim LCD text uses a new token, `--lcd-dim`. Add it to `:root`
  and to the dark block: the ink `#ffb547` at 74 % over that scheme's
  `--lcd`, computed and written as an opaque hex, so the contrast test can
  read it.

- [ ] **Step 2: Run it to see it fail.** Run `node --test web/static/lib/styles.test.js`.
  Expected: FAIL on `.np-pos has a colour` and on the dock block.

- [ ] **Step 3: Remove the deck's CSS:**
  - `styles.css:2427-2494`: `.tape-page { --machine-h … }`, `.tape-machine`,
    `.tm-*`, and `.tm-bridge` with its `.vu` overrides;
  - every `var(--machine-h)` in the tape layout (`:1878`, `:1894`, `:1907`,
    `:1912`).

  Keep the reel tokens (`--reel-*`, `--tape-pack`, `--tape-sheen`, `--deck-*`).

- [ ] **Step 4: The page as a column with the bar at its foot.** Add this
  after the tape section's base rules (around `:1781`):

```css
/* The tape page is one column the height of the window: the header, then
   main (it scrolls), then the bar (and, from PR 2, a drawer). A drawer
   opening shrinks main, never the window. */
body.tape-page { min-height: 100svh; display: flex; flex-direction: column; }
body.tape-page > main.tape-main { flex: 1 1 auto; min-height: 0; }
body.tape-page { --np-h: 120px; }
```

  Then, in the `min-width: 700px` and `min-width: 1000px` blocks, replace
  each `var(--machine-h)` term with `var(--np-h)`, and delete
  `.tape-machine { grid-area: machine; … }` and the `.tape-overview`
  grid-area line. The `grid-template-areas` become
  `"empty side" "ruler side" "lanes side" ". side"`, with
  `grid-template-rows: auto auto auto 1fr`. In the ≥1000 block,
  `.tape-toolbar`'s `max-height` becomes
  `calc(100svh - var(--topbar-h) - var(--np-h) - 30px)`.

- [ ] **Step 5: The bar.** Add a new section after the tape page's rules,
  before the phone dock:

```css
/* ---------- the now-playing bar (spec: 2026-10-05-transport-bar) ---------- */
.np {
  position: sticky; bottom: 0; z-index: 18; flex: none;
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: repeating-linear-gradient(90deg, rgba(255,255,255,.022) 0 1px, transparent 1px 3px), linear-gradient(180deg, var(--face-hi), var(--face-lo));
  border-top: 1px solid var(--edge-strong);
  box-shadow: inset 0 1px 0 var(--hl), 0 -12px 24px -18px var(--sh-strong);
}
.np-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.np-row-1 { height: 52px; }
.np-row-2 { height: 40px; }
/* The reel window: the deck's metal, a reel either side of the LCD, the tape under it. */
.np-window {
  position: relative; flex: none; width: 316px; height: 52px; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px; padding: 0 4px;
  border-radius: 10px; border: 1px solid var(--edge);
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px), linear-gradient(180deg, var(--deck-hi), var(--deck-lo));
  box-shadow: inset 0 1px 0 var(--hl), 0 2px 6px -3px var(--sh-strong);
}
.np-window::after { content: ''; position: absolute; left: 26px; right: 26px; bottom: 3px; height: 2.5px; border-radius: 2px; background: var(--tape-pack); }
.np-reel { flex: none; width: 44px; height: 44px; position: relative; z-index: 1; }
.np-well { fill: rgba(0,0,0,.06); }
.np-pack { fill: var(--tape-pack); stroke: var(--tape-sheen); stroke-width: 1; }
.np-turn { transform-box: view-box; }
.np-flange { fill: var(--reel-metal); stroke: var(--reel-edge); stroke-width: 1.2; }
.np-hub { fill: var(--reel-hub); stroke: var(--reel-hub-edge); stroke-width: 1.5; }
.np-lcd {
  flex: 1; min-width: 0; align-self: stretch; margin: 5px 0 7px; position: relative; z-index: 1;
  display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 3px 9px; border-radius: 7px;
  background: var(--lcd); box-shadow: inset 0 2px 5px rgba(0,0,0,.7), inset 0 0 0 1px rgba(0,0,0,.7), 0 1px 0 var(--hl);
  font-family: var(--mono); overflow: hidden;
}
.np-lcd-top { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.np-pos { color: var(--lcd-ink); text-shadow: 0 0 7px rgba(255,181,71,.6); font-weight: 600; font-size: 21px; line-height: 1; overflow: hidden; text-overflow: ellipsis; }
.np-time, .np-unit, .np-clock, .np-marquee { color: var(--lcd-dim); text-shadow: 0 0 5px rgba(255,181,71,.35); font-size: 10.5px; }
.np-unit { font: 700 9.5px var(--label-font); letter-spacing: .14em; }
.np-status { flex: none; width: 10px; height: 10px; }
.np-status[data-state="play"] { background: var(--lcd-ink); clip-path: polygon(10% 0, 100% 50%, 10% 100%); }
.np-status[data-state="stop"] { background: var(--lcd-dim); clip-path: inset(10%); }
.np-status[data-state="rec"], .np-status[data-state="armed"] { border-radius: 50%; background: #ff4a3d; box-shadow: 0 0 8px rgba(255,74,61,.9); }
.np-status[data-state="rec"] { animation: np-blink 1s steps(1) infinite; }
@keyframes np-blink { 50% { opacity: .3; } }
.np-levels { margin-left: auto; flex: none; display: flex; align-items: flex-end; gap: 2px; height: 14px; }
.np-levels i { display: block; width: 3px; height: 100%; border-radius: 1px; transform-origin: bottom; transform: scaleY(.08); box-shadow: 0 0 5px currentColor; transition: transform .12s; }
.np-marquee { position: relative; overflow: hidden; white-space: nowrap; letter-spacing: .08em; }
.np-marquee span { display: inline-block; padding-left: 100%; animation: np-marq 18s linear infinite; }
@keyframes np-marq { to { transform: translateX(-100%); } }
.np-keys { display: flex; gap: 6px; margin: 0; padding: 0; }
.np-keys .icon-btn { width: 52px; height: 52px; min-height: 52px; padding: 0; flex-direction: column; gap: 4px; }
.np-own { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.np-catch { height: 52px; min-width: 112px; flex-direction: column; gap: 1px; padding: 0 18px; }
.np-catch-word { font-size: 15.5px; font-weight: 700; }
.np-catch-sub { font: 500 10.5px var(--mono); opacity: .88; }
.np-scrub { flex: 1; min-width: 0; height: 40px; border-radius: 8px; }
.np-out .tape-out { height: 40px; }
.tape-page .tape-top .out-anchor { display: none; }   /* the bar has OUT from 700 px */
@media (prefers-reduced-motion: reduce) {
  .np-marquee span { animation: none; padding-left: 0; }
  .np-marquee { text-overflow: ellipsis; }
  .np-status[data-state="rec"] { animation: none; }
}
```

  Check each class name against the keys' existing rules (`.tb-row.transport
  .icon-btn` sizes at `:2682-2706`). Where those fight the bar, scope the bar's
  rules under `.np`, and don't change the old ones: the take page will still
  use them until PR 3.

- [ ] **Step 6: The phone dock becomes the bar.** Replace the block
  `@media (max-width: 699.98px), (orientation: landscape) and (max-height: 440px)`
  and its two narrower tiers (`:2867-2905`) with the following. It keeps the
  same media query and `--dock-b`, docks the whole bar above the tabs, hides
  the reel window and the bar's OUT, and shows a small LCD beside the
  scrubber:

```css
@media (max-width: 699.98px), (orientation: landscape) and (max-height: 440px) {
  body.tape-page { --np-h: 104px; padding-bottom: calc(var(--dock-b, 0px) + var(--np-h)); }
  .np { position: fixed; left: 0; right: 0; bottom: var(--dock-b, 0px); height: var(--np-h); box-sizing: border-box; padding: 8px 12px; gap: 6px; }
  .np-window { display: none; }
  .np-row-1 { height: 48px; }
  .np-row-2 { height: 34px; }
  .np-keys .icon-btn { flex: 1 1 0; width: auto; height: 48px; min-height: 48px; }
  .np-own { flex: 0 0 30%; }
  .np-catch { width: 100%; min-width: 0; height: 48px; padding: 0 8px; }
  .np-out { display: none; }
  .tape-page .tape-top .out-anchor { display: inline-flex; }
  body.tape-page #toasts, body.tape-page .tip-pop { bottom: calc(var(--dock-b, 0px) + var(--np-h) + 12px); }
}
@media (max-width: 399.98px) {
  .np-keys { gap: 4px; }
  .np-keys .icon-btn { font-size: 13px; }
  .np-own { flex-basis: 26%; }
}
```

- [ ] **Step 7: The phone's small LCD and OUT.**
  - Below 700 px the reel window is hidden, so `#np-mini` (from Task 3,
    written by `render()` in Task 4) shows the position beside the scrubber.
    Style it for phones only: `.np-mini { display: none }` outside the phone
    block. Inside it, `.np-mini { display: inline-flex; height: 34px; padding: 0 8px; font-size: 13px }`,
    with the `.readout` LCD look (`:2615-2620`) as the base.
  - Grep `styles.css` for `#tape-out` and `#tape-out-text`, and change those
    selectors to `.tape-out` and `.tape-out-text`, so the header's pill
    (now `#tape-out-top`) keeps its look.

- [ ] **Step 8: Run the stylesheet test**

Run: `node --test web/static/lib/styles.test.js`
Expected: PASS.

- [ ] **Step 9: Look at it on the demo.** Open `/tape.html` at 1024 × 768,
  1024 × 600, 1470 × 900, 390 × 844 and 844 × 390, in both schemes, and play.
  Check that:
  - the reels turn and the packs move;
  - the LCD counts and its levels move;
  - ● Rec arms and the LED goes red;
  - the scrubber's playhead runs, and a tap on it moves the playhead;
  - Catch is orange;
  - on a phone, ▶ ⟲ ● ♩ and Catch sit above the tabs, with the small LCD and
    the scrubber under them.

- [ ] **Step 10: Commit**

```bash
git add web/static/styles.css web/static/lib/styles.test.js web/static/tape.html web/static/lib/tape/page.js
git commit -m "Tape: the bar's look; the page a column with the bar at its foot; a phone docks the bar"
```

---

### Task 6: Tips and the guide

**Files:**
- Modify: `web/static/lib/help/tips.js`, `docs/guide.md`

- [ ] **Step 1: The tip.** In `tips.js`, after the `'▶ (tape)'` row:

```js
  { control: '|◂ (tape)', ids: ['to-start'], tip: 'Back to the loop’s start; with Loop off, to the top of the tape' },
```

  Add the same row at the same place in the table in `docs/guide.md` §9:

```
| \|◂ (tape) | Back to the loop’s start; with Loop off, to the top of the tape |
```

  (Escape the pipe as the table's other rows do; check how `help.test.js`
  parses the cells, and match it.) Then update the existing rows' words where
  the control moved:
  - `'Overview'` / `tape-overview`: "The whole tape, in the bar: tap to move
    the playhead, drag the box to move the lanes, double-tap to go back to the
    loop. ← → a bar";
  - `catch`: "Catch the last pass onto the selected track. The bars and
    Layer/Replace are under Record". (Until PR 2: "…are beside the tracks".)
- [ ] **Step 2: §8.2.** Rewrite these items in `docs/guide.md` §8.2; leave
  the rest as it is:
  - the deck becomes **"The bar,"** at the foot of the page:
    - the reels either side of the amber LCD, which shows ▶ / ■ / ● (red,
      blinking while recording, steady while armed);
    - the position, large (bar.beat), with the time beside it;
    - a level bar per track in its colour;
    - a line naming the tape, tempo, loop, output and punch;
    - under them, the overview, which is now the bar's scrubber, with OUT at
      its end.
  - the transport item: **|◂** (to the loop's start), **▶ / ■**, **⟲ Loop**,
    **● Rec** and **♩** in the bar; **Catch** at the bar's right end.
  - the "On a phone" item: the bar docks above the tabs, with ▶ ⟲ ● ♩ and
    Catch, a small LCD and the scrubber.
- [ ] **Step 3: Run the help tests**

Run: `node --test web/static/lib/help/*.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/static/lib/help/tips.js docs/guide.md
git commit -m "Guide and tips: the now-playing bar on the tape page"
```

---

### Task 7: The smoke test follows the bar

**Files:**
- Modify: `scripts/smoke-tape.mjs`

- [ ] **Step 1: The bench check measures to the bar.** In the track-heads
  loop:
  - add `[1024, 768]` and `[1470, 900]` to the sizes;
  - return the bar's top as well:
    `const np = document.getElementById('np').getBoundingClientRect().top;`;
  - replace the 1024 × 600 check with one for every size of 700 px or wider:

```js
  if (w >= 700 && h > 440) check(`${w}x${h}: the lanes end above the bar`, r.last <= r.np + 1, `lanes ${r.last}, bar ${r.np}`);
```

- [ ] **Step 2: The bar's parts are drawn.** Add a check at 1024 × 768:
  - `#np-reel-l` has a `.np-pack`;
  - `#np-marquee` text starts with the tape's name in capitals;
  - after `#play` is clicked and 1.5 s pass, `#position`'s text has changed;
  - `#to-start`, clicked while looping, puts `#position` back at the loop's
    first bar.
- [ ] **Step 3: Run it against the demo.** It must print no `FAIL`.
- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-tape.mjs
git commit -m "Smoke: the tape's lanes end above the bar, and the bar runs"
```

---

### Task 8: Ship-ready

**Files:**
- Modify: `web/static/sw.js`, `.github/workflows/ci.yml`, `docs/development.md`

- [ ] **Step 1: The service worker.** In `SHELL`, remove
  `'/lib/tape/machine.js'` and add `'/lib/bar/lcd.js'` and
  `'/lib/bar/reel-window.js'`. Set `CACHE` to `'hindsight-shell-v28'`.
- [ ] **Step 2: The test glob.** Add `'web/static/lib/bar/*.test.js'` to the
  `node --test` line in `.github/workflows/ci.yml` and in
  `docs/development.md`'s "Testing".
- [ ] **Step 3: Everything.** Run `gofmt -l .` (empty), `go vet ./...`,
  `go test -race ./...`, the node suite and `smoke-tape.mjs`. All must pass.
- [ ] **Step 4: Screenshots for the review.** Take the Tape page at 390 × 844,
  844 × 390, 1024 × 600, 1024 × 768 and 1470 × 900, light and dark, stopped
  and playing. Save them under `.superpowers/sdd/2026-10-05-transport-bar/pr1/`
  and don't commit them.
- [ ] **Step 5: Commit**

```bash
git add web/static/sw.js .github/workflows/ci.yml docs/development.md
git commit -m "PR 1: cache v28, the bar's modules in the shell, its tests in CI"
```

- [ ] **Step 6: Review, merge, deploy.**
  - After the final review, fast-forward local `main`:
    `git fetch . claude/bar-1-tape:main`. First check that GitHub's `main`
    hasn't moved: `gh api repos/gabeduke/hindsight/commits/main`.
  - Then run `make pi-status`, then `make deploy-dry`, and read its
    `*deleting` lines.
  - Then run `make deploy-static`. There are no Go changes, so the ring is
    kept.
  - The guide's new text waits for the next full deploy (PR 5).

---

## PRs 2–5 (scoped; each is detailed here when it starts)

**PR 2: the drawers** (branch `claude/bar-2-drawers`; `tape.html`,
`page.js`, `styles.css`, `smoke-tape.mjs`, guide §8.2, tips)

- **Markup.** `.tape-toolbar` is split into two
  `<section class="np-drawer">` elements inside `#np`, before row 1 (which
  makes them dock above the bar):
  - `#drawer-rec`, holding sources, catch bars and mode, passes, away and
    `#jam-only-note`;
  - `#drawer-edit`, holding the clipboard, edit and snap rows.

  Each gets the window strip (grip lines, title, ✕ `.np-drawer-close`). The
  rows keep their classes and ids.
- **The keys.** `#np-drawer-rec` ("Record ▴") and `#np-drawer-edit`
  ("Edit ▴") sit in `.np-own`, before Catch. They carry `aria-expanded`
  and `aria-controls`, and an amber LED (`.led-amb`) that lights while their
  drawer is open.
- **State.** `state.drawer` is `'rec' | 'edit' | ''`, kept with
  `writePref('tape.drawer')`. Only one drawer is open at a time.
- **The clip editor.** `#clip-editor` moves into `#np` as a third drawer.
  `renderAlign()` hides the open drawer while it is there and restores it on
  close. The `.toolbar.editing` rules go, because there is no toolbar left.
- **Phone mode.** `render()`'s line 457 hides the whole rows (`.tb-row.sources`,
  `.tb-row.catch`, `.tb-row.passes`), not only their insides, so the drawer
  shows only the note and Overdub.
- **Layout.** The ≥1000 px grid goes: one column, the lanes full width, the
  heads 150 (200 from 1400). `.tt-lane` gets `min-height: 56px` and
  `flex: 1`, and `.tape-lanes` becomes a flex column filling `main`, so a
  drawer opening shrinks the lanes, then `main` scrolls.
- **The bench** (`max-height: 640px` and `min-width: 1000px`): the header's
  two rows fold into one, as on the `BenchA` board. ↷ and Help move into ⋯;
  add `#tape-redo-item` and `#help-item` to `#tape-actions`, shown only there.
- **Phones in PR 2.** Below 700 px the drawers stay in the page's flow
  above the docked bar, not fixed: one column, as the toolbar rows are
  today. PR 5 moves them into the player.
- **Smoke.** At 1024 × 600, with `#np-drawer-edit` clicked, every lane is at
  least 48 px tall and `#np` is on screen. At 1024 × 768 with both drawers
  closed, the lanes are full width and at least 100 px tall. In phone mode,
  opening Record shows `#jam-only-note` and hides `#sources`.
- **Tips.** `drawer-rec` and `drawer-edit`.

**PR 3: a take** (branch `claude/bar-3-take`; `wave.html`, `lib/wave/page.js`,
`lib/wave/overview.js`, `lib/bar/lcd.js`, `styles.css`, guide §4, tips)

- **`lcd.js`** gains `takeCounter(pos, duration, sampleRate)`, which gives
  `{big: 'm:ss.s', small: '/ m:ss'}`, and `takeMarquee(name, bpm, region)`.
  Both are tested.
- **The bar in `wave.html`**:
  - `#overview-canvas` moves into row 2;
  - `#play` and `#loop` move into the keys, with `#to-start` (to In);
  - `#set-in`, `#set-out` and `#flag-now` move into `.np-own`, as keys;
  - `#flag-prev` and `#flag-next` move into the edit strip;
  - the OUT label is `OUT · This device`, a `<span>`, not a button.
- **The take's `Overview`** gains a tap that seeks: `emit('seek', frame)` on a
  tap outside the window, and the window still pans. The two-line
  `docs/development.md` checklist now matches.
- **The reels** follow `clock.position()` through `ReelMotion`, polled from
  `onTick`. The levels are left and right from the tiles' peaks at the
  cursor.
- **The play glyph** is ▶ / ❚❚ (a take pauses).
- **`help.test.js`** requires every `<button>` and `<a>` in `wave.html` to
  carry `data-tip`. Give the new keys `to-start` (shared with the tape) and
  keep `in`, `out` and `flag`.

**PR 4: Takes and Capture** (branch `claude/bar-4-pages`; `takes.html`,
`index.html`, `lib/bar/tape-source.js` (new), `lib/bar/take-source.js` (new),
`lib/bar/bar.js` (new: mounts the shared parts on a page from a source),
`shelf-detail.js`, `takes.js`, `app.js`, `nav.js`, guide §3 and §3.x, tips)

- **`bar.js`** owns the reel window, the LCD and the keys on these two pages.
  It takes a source with this shape:
  `{kind, name, poll() → {pos, playing, length, sampleRate, …}, play(), stop(), locate(pos), setLoop(on), overview(canvas)}`.
- **`tape-source.js`**:
  - it gets the loaded id from `initNav`'s `/api/tapes` answer; make
    `initNav()` return a promise of it;
  - it polls `/api/tapes/state?id=` every 500 ms while visible;
  - it maps ▶ / ■ to `POST /api/tapes/transport` and Loop to
    `PATCH /api/tapes`;
  - it draws the overview like the tape page does. Share `drawOverview` by
    moving it into `lib/tape/overview.js` with the tape and the playhead as
    arguments.
- **`take-source.js`** wraps the `Audio` that `TakesList.player(name)`
  returns.
- **Takes:**
  - `.detail-play` goes;
  - `pick()` loads the take into the bar, except at load time while the tape
    is playing: the bar keeps the tape until the first pick by hand;
  - the cassette's `.playing` follows the bar's source.
- **Capture:**
  - a spine's press loads its take into the bar and plays it. Keep
    `spineAction: 'play'` and route it through the bar;
  - `#np-eject` returns the bar to the tape, and so does the take ending;
  - with the tape off, `#np` is hidden until a take is loaded.
- **Smoke:** `smoke-takes.mjs` and `smoke-capture.mjs` gain the bar:
  - a picked take plays from `#play`, and the cassette's hubs turn;
  - on Capture, a spine press shows its name in `#np-marquee`, and ⏏ brings
    back the tape's.

**PR 5: the phone** (branch `claude/bar-5-phone`; `lib/bar/player.js` (new),
`styles.css`, all four pages, `internal/tape/output.go` and its test,
`lib/tape/output-ui.js` / `stream-player.js`, guide, tips)

- **Below 700 px, and for phones on their side**, `#np` is the mini player:
  - small reels, the name and output, the bar and time, ▶, and Catch (tape
    only);
  - a 3 px progress line along its top.

  A tap on its middle (an `<a>`-like `<button class="np-open">`) adds
  `body.player-open`. CSS then turns `#np` into a full-height sheet with
  everything stacked:
  - the window, large;
  - the scrubber;
  - |◂ ▶ ⟲ ● ♩;
  - Catch, full width;
  - a two-way switch over the two drawers.

  ▾, Back (a history entry, like the cassette sheet's `sheetState`) or a
  swipe down closes it.
- **The header's OUT pill** (`#tape-out-top`) goes. OUT lives in the player.
- **The stream player** moves from `output-ui.js` into `lib/bar/stream.js`,
  started by `bar.js` on every page when the stored output mode is phone or
  both and this device was the listener. Remember that in localStorage
  `tape.listener` when `setMode('phone'|'both')` succeeds here. The LCD
  says `Reconnecting…` until the first packet.
- **The Pi's no-listener grace** is 2 s → 6 s in `internal/tape/output.go`,
  and its test moves with it. This is the one Go change, so this PR needs a
  full `make deploy`, which also ships the guide's text from PRs 1–4.
- **Smoke:**
  - at 390 × 844 and 844 × 390 on each page, `#play` is on screen and above
    the tabs, and on the tape so is `#catch-pass`;
  - opening the player shows `#rec` and `#np-drawer-rec`'s contents;
  - Back closes it.
- **The sideways phone**, the open item from the restyle, is fixed by the
  mini player. Check it at 844 × 390 on the take page.
