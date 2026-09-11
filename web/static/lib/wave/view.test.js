import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveView, HOLD_MS } from './view.js';
import { EDGE_MAX_STEP_PX } from './geometry.js';

// hit() reads only this.view, this.chipRects and the state it is handed, so a
// stubbed instance tests it without a canvas.
function stubView(view) {
  const v = Object.create(WaveView.prototype);
  Object.assign(v, { view, chipRects: [], cssH: 200 });
  return v;
}

const noGrid = { bpm: null, downbeat: 0 };

test('a wide region keeps full-size handle zones', () => {
  const v = stubView({ start: 0, fpp: 1, width: 400 }); // 1 frame per px
  const st = { grid: noGrid, region: { start: 100, end: 300 }, flags: [] }; // 200px wide
  assert.deepEqual(v.hit(100, 100, st), { kind: 'handle', edge: 'start' });
  assert.deepEqual(v.hit(120, 100, st), { kind: 'handle', edge: 'start' }); // 20px out, inside HANDLE_HIT
  assert.deepEqual(v.hit(300, 100, st), { kind: 'handle', edge: 'end' });
  assert.deepEqual(v.hit(200, 100, st), { kind: 'region' });
  assert.deepEqual(v.hit(70, 100, st), { kind: 'wave' });
});

test('a region only a few pixels wide shrinks its handle zones', () => {
  // Zoomed out hard: a 400-frame region is 4px on screen.
  const v = stubView({ start: 0, fpp: 100, width: 400 });
  const st = { grid: noGrid, region: { start: 10000, end: 10400 }, flags: [] }; // x 100..104
  // The floor is 6px, not the full 24: there is room to press-and-hold nearby.
  assert.deepEqual(v.hit(106, 100, st), { kind: 'handle', edge: 'start' });
  assert.deepEqual(v.hit(115, 100, st), { kind: 'wave' });
  assert.deepEqual(v.hit(85, 100, st), { kind: 'wave' });
  // The edges themselves are still grabbable.
  assert.deepEqual(v.hit(100, 100, st), { kind: 'handle', edge: 'start' });
  assert.deepEqual(v.hit(104, 100, st), { kind: 'handle', edge: 'start' });
});

test('a middling region scales the grab to a quarter of its width', () => {
  const v = stubView({ start: 0, fpp: 1, width: 400 });
  const st = { grid: noGrid, region: { start: 100, end: 140 }, flags: [] }; // 40px < 2*HANDLE_HIT
  // grab = 40/4 = 10px
  assert.deepEqual(v.hit(110, 100, st), { kind: 'handle', edge: 'start' });
  assert.deepEqual(v.hit(89, 100, st), { kind: 'wave' });
  assert.deepEqual(v.hit(150, 100, st), { kind: 'handle', edge: 'end' });
  assert.deepEqual(v.hit(151, 100, st), { kind: 'wave' });
});

// up() drives the tap/double-tap machinery end to end, so these exercise it
// on a stubbed instance rather than hit() alone.
test('a double-tap inside the region adds a flag, same as bare waveform', () => {
  const v = stubView({ start: 0, fpp: 10, width: 390 }); // x=200 -> frame 2000
  v.total = 100000;
  v.minLen = 289;
  v.pointers = new Map();
  v.lastTap = null;
  v.getState = () => ({ region: { start: 1000, end: 3000 }, flags: [], grid: noGrid, cursor: 0 });
  const log = [];
  v.emit = (ev, p) => log.push([ev, p]);
  v.pt = () => ({ x: 200, y: 50 }); // inside the region

  v.gesture = { kind: 'moveRegion', region: { start: 1000, end: 3000 }, x0: 200, y0: 50, t0: performance.now(), moved: false };
  v.up({ pointerId: 1 });
  assert.deepEqual(log.at(-1), ['seek', { frame: 2000 }]);

  v.gesture = { kind: 'moveRegion', region: { start: 1000, end: 3000 }, x0: 200, y0: 50, t0: performance.now(), moved: false };
  v.up({ pointerId: 1 });
  assert.deepEqual(log.at(-1), ['addFlag', { frame: 2000 }]);
});

test('a tap on a handle neither seeks nor flags', () => {
  const v = stubView({ start: 0, fpp: 10, width: 390 });
  v.total = 100000;
  v.minLen = 289;
  v.pointers = new Map();
  v.lastTap = null;
  v.getState = () => ({ region: { start: 1000, end: 3000 }, flags: [], grid: noGrid, cursor: 0 });
  const log = [];
  v.emit = (ev, p) => log.push([ev, p]);
  v.pt = () => ({ x: 100, y: 50 });

  v.gesture = { kind: 'handle', edge: 'start', region: { start: 1000, end: 3000 }, grabOffset: 0, x0: 100, y0: 50, t0: performance.now(), moved: false };
  v.up({ pointerId: 1 });
  assert.deepEqual(log, []);
});

// A press that travelled past TAP_MOVE before the hold fired became a pan.
// Releasing it must do nothing at all: no region, and no stray seek that would
// yank the cursor to wherever the pan happened to end.
test('a press that panned emits nothing on release', () => {
  const v = stubView({ start: 0, fpp: 10, width: 390 }); // x=200 -> frame 2000
  v.total = 100000;
  v.minLen = 289;
  v.pointers = new Map();
  v.lastTap = null;
  v.getState = () => ({ region: null, flags: [], grid: noGrid, cursor: 0 });
  const log = [];
  v.emit = (ev, p) => log.push([ev, p]);
  v.pt = () => ({ x: 210, y: 50 }); // 10px from x0: past TAP_MOVE

  v.gesture = { kind: 'select', anchor: 2000, prev: null, x0: 200, y0: 50, t0: performance.now(), moved: true, selecting: false, start: 0 };
  v.up({ pointerId: 1 });
  assert.deepEqual(log, []);
});

// Once the hold has armed selecting, a release that snaps back below
// MIN_REGION_PX / minLen must roll back to prev and never emit a tap on top.
test('a held select released under the region minimum rolls back', () => {
  const v = stubView({ start: 0, fpp: 10, width: 390 }); // x=200 -> frame 2000
  v.total = 100000;
  v.minLen = 289;
  v.pointers = new Map();
  v.lastTap = null;
  v.getState = () => ({ region: null, flags: [], grid: noGrid, cursor: 0 });
  const log = [];
  v.emit = (ev, p) => log.push([ev, p]);
  v.pt = () => ({ x: 210, y: 50 }); // anchor 2000 -> release frame 2100: 10px, 100 frames

  v.gesture = { kind: 'select', anchor: 2000, prev: null, x0: 200, y0: 50, t0: performance.now(), moved: true, selecting: true };
  v.up({ pointerId: 1 });
  assert.deepEqual(log, [['regionChange', { region: null, final: true }]]);
});

// A held select dragged past the region minimum commits.
test('a held select past the region minimum commits', () => {
  const v = stubView({ start: 0, fpp: 10, width: 390 }); // x=200 -> frame 2000
  v.total = 100000;
  v.minLen = 289;
  v.pointers = new Map();
  v.lastTap = null;
  v.getState = () => ({ region: null, flags: [], grid: noGrid, cursor: 0 });
  const log = [];
  v.emit = (ev, p) => log.push([ev, p]);
  v.pt = () => ({ x: 240, y: 50 }); // anchor 2000 -> release frame 2400: 40px, 400 frames

  v.gesture = { kind: 'select', anchor: 2000, prev: null, x0: 200, y0: 50, t0: performance.now(), moved: true, selecting: true };
  v.up({ pointerId: 1 });
  assert.deepEqual(log, [['regionChange', { region: { start: 2000, end: 2400 }, final: true }]]);
});


// --- the hold-to-select gesture, driven end to end -------------------------
// These drive down/move/up with fake pointer events instead of planting a
// gesture, because the whole point of the change is *when* the gesture becomes
// a select: that lives in the hold timer, not in up().
function pointerView({ region = null, start = 5000 } = {}) {
  const v = Object.create(WaveView.prototype);
  const log = [];
  Object.assign(v, {
    view: { start, fpp: 10, width: 390 }, // x=200 -> frame start+2000
    chipRects: [], cssH: 200,
    total: 100000,
    minLen: 289,
    pointers: new Map(),
    gesture: null,
    lastTap: null,
    canvas: {
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 200 }),
    },
    // destroy() reaches for these; the harness never builds a real canvas.
    ro: { disconnect() {} },
    ac: new AbortController(),
    raf: 0,
    destroyed: false,
    edgeRaf: 0,
    getState: () => ({ region, flags: [], grid: noGrid, cursor: 0 }),
    emit: (ev, p) => log.push([ev, p]),
    draw() {},
  });
  // clampView, maxFpp and lostCapture stay real: the pan has to be clamped
  // like the page's, and losing the capture has to route through the real
  // guard rather than a stub that always cancels.
  v.changed = () => log.push(['viewChange', v.view.start]);
  return { v, log };
}
const at = (x, id = 1) => ({ pointerId: id, clientX: x, clientY: 50 });
const regions = (log) => log.filter(([ev]) => ev === 'regionChange');

test('press, hold, then drag selects from the press point', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  v.down(at(200));                    // anchor = 7000
  assert.deepEqual(regions(log), []); // nothing until the hold fires
  t.mock.timers.tick(HOLD_MS);
  // The hold announces itself with a minLen band under the finger.
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7289 }, final: false }]);
  v.move(at(240));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7400 }, final: false }]);
  v.up(at(240));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7400 }, final: true }]);
});

test('a drag before the hold fires pans instead of selecting', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  v.down(at(200));
  v.move(at(230)); // 30px right: content follows the finger, start goes back
  assert.equal(v.view.start, 5000 - 30 * 10);
  assert.deepEqual(regions(log), []);
  // The hold is dead, not merely late: ticking past it must not start a region.
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(regions(log), []);
  v.up(at(230));
  assert.deepEqual(regions(log), []);
});

test('a second finger during a held select rolls the region back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prev = { start: 1000, end: 3000 };
  const { v, log } = pointerView({ region: prev });
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  assert.equal(log.length, 1); // the provisional band
  v.down(at(300, 2));          // pinch takes over
  assert.deepEqual(log.at(-1), ['regionChange', { region: prev, final: true }]);
  assert.equal(v.gesture.kind, 'pinch');
  // Pinching moves the viewport, never the abandoned region.
  v.move(at(340, 2));
  assert.deepEqual(regions(log), [
    ['regionChange', { region: { start: 7000, end: 7289 }, final: false }],
    ['regionChange', { region: prev, final: true }],
  ]);
});

test('a press released before the hold still seeks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  v.down(at(200));
  v.move(at(205)); // 5px: under TAP_MOVE, so still undecided
  v.up(at(205));
  assert.deepEqual(log, [['seek', { frame: 7050 }]]);
});

// A pan is never half of a double-tap: it must clear lastTap, or a later tap
// landing near the original spot within TAP_MS would wrongly pair up and add
// a flag instead of seeking.
test('a pan between two taps breaks the double-tap', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  // First tap: seeks and arms lastTap.
  v.down(at(200));
  v.up(at(200));
  assert.deepEqual(log.at(-1), ['seek', { frame: 7000 }]);
  // A 30px pan on the next press: it must clear lastTap, not leave it armed.
  v.down(at(200));
  v.move(at(230));
  v.up(at(230));
  // A tap back at the original x, still within TAP_MS: without the fix this
  // pairs with the first tap (same spot, well under DOUBLE_TAP_MOVE) and adds
  // a stray flag instead of seeking.
  v.down(at(200));
  v.up(at(200));
  assert.deepEqual(log.at(-1), ['seek', { frame: 6700 }]);
});

// The hold fires at HOLD_MS (350); a still press released between TAP_MS
// (300) and HOLD_MS never moved and never started selecting, so it must still
// be treated as a tap rather than falling into a dead zone.
test('a still press held past TAP_MS but under HOLD_MS still seeks', (t) => {
  let now = 1000;
  t.mock.method(performance, 'now', () => now);
  const { v, log } = pointerView();
  v.down(at(200));  // t0 = 1000
  now = 1000 + 320; // held 320ms: past TAP_MS, short of HOLD_MS
  v.up(at(200));
  assert.deepEqual(log, [['seek', { frame: 7000 }]]);
});

// --- edge auto-scroll, haptics and pointer-id robustness -------------------
// node has no requestAnimationFrame, and a real one would fire after the test
// had ended. Record the callbacks instead so a test runs exactly one frame by
// hand and can see whether the loop scheduled another.
function fakeRaf() {
  const realRaf = globalThis.requestAnimationFrame;
  const realCaf = globalThis.cancelAnimationFrame;
  const pending = new Map();
  let next = 1;
  globalThis.requestAnimationFrame = (cb) => { const id = next++; pending.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = (id) => { pending.delete(id); };
  return {
    get pending() { return pending.size; },
    runOne() {
      const [id, cb] = [...pending][0];
      pending.delete(id);
      cb(0);
    },
    restore() {
      if (realRaf === undefined) delete globalThis.requestAnimationFrame;
      else globalThis.requestAnimationFrame = realRaf;
      if (realCaf === undefined) delete globalThis.cancelAnimationFrame;
      else globalThis.cancelAnimationFrame = realCaf;
    },
  };
}

test('a select dragged into the right margin scrolls the view under it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const raf = fakeRaf();
  try {
    const { v, log } = pointerView();
    v.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    v.move(at(385)); // 5px from the right edge: inside EDGE_MARGIN_PX
    assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 8850 }, final: false }]);
    assert.equal(raf.pending, 1); // the loop is armed, but has not run yet
    assert.equal(v.view.start, 5000);

    const before = v.view.start;
    raf.runOne();
    const panned = v.view.start - before;
    assert.ok(panned > 0, `expected a pan, got ${panned}`);
    assert.ok(panned <= EDGE_MAX_STEP_PX * v.view.fpp, `pan ${panned} exceeds one full step`);
    // The region is re-derived under the unchanged finger, so it grows with
    // the scroll rather than staying pinned to the old frame.
    const [ev, payload] = log.at(-1);
    assert.equal(ev, 'regionChange');
    assert.equal(payload.final, false);
    assert.equal(payload.region.start, 7000);
    assert.ok(payload.region.end > 8850, `expected the region to grow past 8850, got ${payload.region.end}`);
    assert.equal(raf.pending, 1); // and it keeps going

    v.move(at(195)); // back out of the margin: the loop stops
    assert.equal(raf.pending, 0);
  } finally {
    raf.restore();
  }
});

// A stray release from a second pointer (a palm, a finger that never started
// this gesture) must not finalize someone else's selection.
test('a release from a foreign pointer id is ignored', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  v.move(at(240));
  const n = log.length;
  v.up(at(240, 2));
  assert.equal(log.length, n);       // nothing emitted
  assert.ok(v.gesture && v.gesture.selecting); // and the select survives
  v.up(at(240, 1));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7400 }, final: true }]);
  assert.equal(v.gesture, null);
});

test('the hold buzzes where it can, and arms anyway where it cannot', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const buzzed = [];
  try {
    // node exposes navigator as a getter-only accessor, so defineProperty is
    // the only way to stand one up.
    Object.defineProperty(globalThis, 'navigator', {
      value: { vibrate: (ms) => buzzed.push(ms) }, configurable: true, writable: true,
    });
    const { v } = pointerView();
    v.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    assert.deepEqual(buzzed, [10]);

    // No navigator at all: the hold must still arm rather than throwing out
    // of the timer and leaving the gesture half-built.
    delete globalThis.navigator;
    const { v: v2, log } = pointerView();
    v2.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7289 }, final: false }]);
    assert.ok(v2.gesture.selecting);
  } finally {
    delete globalThis.navigator;
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
  }
});

test('a second finger during an edge scroll rolls back and stops the loop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const raf = fakeRaf();
  try {
    const prev = { start: 1000, end: 3000 };
    const { v, log } = pointerView({ region: prev });
    v.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    v.move(at(385));
    raf.runOne();
    assert.equal(raf.pending, 1);
    v.down(at(300, 2)); // pinch takes over
    assert.deepEqual(log.at(-1), ['regionChange', { region: prev, final: true }]);
    assert.equal(raf.pending, 0); // the loop dies with the gesture
    assert.equal(v.gesture.kind, 'pinch');
  } finally {
    raf.restore();
  }
});

// A view torn down mid-scroll must not leave a frame callback pointing at it.
test('destroy during an edge scroll cancels the loop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const raf = fakeRaf();
  try {
    const { v } = pointerView();
    v.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    v.move(at(385));
    assert.equal(raf.pending, 1);
    v.destroy();
    assert.equal(raf.pending, 0);
  } finally {
    raf.restore();
  }
});

// --- losing the pointer capture -------------------------------------------
// lostpointercapture also fires as the implicit release after every normal
// pointerup, so it is gated on the pointer still being one we track -- not on
// the gesture kind, which is what let a lost capture on a handle drag leave a
// phantom pointer in the map forever.

test('the implicit capture release after a tap leaves the tap alone', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = pointerView();
  v.down(at(200));
  v.up(at(200));
  assert.deepEqual(log, [['seek', { frame: 7000 }]]);
  const armed = v.lastTap;
  assert.ok(armed, 'the tap should have armed lastTap');
  // The browser now releases the capture it took at pointerdown. up() has
  // already dropped the pointer and nulled the gesture, so this must do
  // nothing: no rollback, no cleared lastTap.
  v.lostCapture({ pointerId: 1 });
  assert.equal(v.lastTap, armed);
  assert.deepEqual(log, [['seek', { frame: 7000 }]]);
});

test('a lost capture mid handle-drag rolls back and drops the pointer', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prev = { start: 7000, end: 9000 };   // x 200..400 in this viewport
  const { v, log } = pointerView({ region: prev });
  v.down(at(200));                            // grabs the start handle
  assert.equal(v.gesture.kind, 'handle');
  v.move(at(240));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7400, end: 9000 }, final: false }]);

  // A handle drag carries no 'select' kind, so the old id-on-select-only rule
  // never fired here and pointer 1 stayed in the map for good.
  v.lostCapture({ pointerId: 1 });
  assert.equal(v.pointers.size, 0);
  assert.equal(v.gesture, null);
  // Rolled back to the snapshot taken at pointerdown, not left at 7400.
  assert.deepEqual(log.at(-1), ['regionChange', { region: prev, final: true }]);
});

// The phantom pointer's real cost: down() calls anything with two entries in
// the map a pinch, so one leftover id turns every later single finger into a
// two-finger zoom that nothing can end.
test('the finger after a lost capture is a gesture, not a pinch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prev = { start: 7000, end: 9000 };
  const { v } = pointerView({ region: prev });
  v.down(at(200));
  v.move(at(240));
  v.lostCapture({ pointerId: 1 });

  v.down(at(100, 2));   // bare wave, well clear of the region's handles
  assert.equal(v.pointers.size, 1);
  assert.notEqual(v.gesture.kind, 'pinch');
  assert.equal(v.gesture.id, 2);
});
