import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveView, HOLD_MS, PIN_H, RULER_H, GRIP_H } from './view.js';
import { EDGE_MAX_STEP_PX } from './geometry.js';

// A WaveView without a canvas: the zones, the gestures and the events, driven
// with fake pointer events. 390 x 200 CSS px: the ruler is y 0-36, the body
// 36-170, the grip strip 170-200. At fpp 10 and start 5000, x=200 is frame 7000.
const H = 200;
const BODY_Y = 100;
const GRIP_Y = H - GRIP_H / 2;
const noGrid = { bpm: null, downbeat: 0, sampleRate: 48000 };

function harness({ region = null, flags = [], grid = noGrid, cursor = 0, snap = 'off', start = 5000 } = {}) {
  const v = Object.create(WaveView.prototype);
  const log = [];
  const state = { region, flags, grid, cursor, snap };
  Object.assign(v, {
    view: { start, fpp: 10, width: 390 },
    cssW: 390, cssH: H,
    total: 100000,
    minLen: 289,
    pointers: new Map(),
    gesture: null,
    lastTap: null,
    canvas: {
      setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: H }),
    },
    ro: { disconnect() {} },
    gestureAC: new AbortController(),
    raf: 0,
    destroyed: false,
    edgeRaf: 0,
    getState: () => state,
    emit: (ev, p) => {
      log.push([ev, p]);
      // Follow the page: provisional and final selections become the state.
      if (ev === 'regionChange') state.region = p.region;
      if (ev === 'downbeatChange') state.grid = { ...state.grid, downbeat: p.frame };
      if (ev === 'scrub' || ev === 'scrubEnd') state.cursor = p.frame;
    },
    draw() {},
  });
  v.changed = () => log.push(['viewChange', v.view.start]);
  return { v, log, state };
}
const at = (x, y = BODY_Y, id = 1) => ({ pointerId: id, clientX: x, clientY: y });
const only = (log, ev) => log.filter(([e]) => e === ev);
const x = (frame, v) => (frame - v.view.start) / v.view.fpp;

// --- zones ----------------------------------------------------------------

test('the ruler holds pins on top, the playhead handle and downbeat below', () => {
  const flag = { id: 'r1', frame: 7000 };
  const { v } = harness({ flags: [flag], cursor: 8000, grid: { bpm: 120, downbeat: 9000, sampleRate: 48000 } });
  assert.deepEqual(v.hit(205, 8), { kind: 'pin', grab: true, flag });
  assert.deepEqual(v.hit(250, 8), { kind: 'ruler' });
  assert.deepEqual(v.hit(300, PIN_H + 8), { kind: 'playhead', grab: true });
  assert.deepEqual(v.hit(400, PIN_H + 8), { kind: 'downbeat', grab: true });
  assert.deepEqual(v.hit(100, PIN_H + 8), { kind: 'ruler' });
  // The body never grabs anything: a drag there always pans.
  assert.deepEqual(v.hit(205, BODY_Y), { kind: 'body', select: true });
});

test('grips sit outside the selection ends, the move handle between them', () => {
  const { v } = harness({ region: { start: 7000, end: 12000 } }); // x 200..700, wider than the canvas
  assert.deepEqual(v.hit(190, GRIP_Y), { kind: 'grip', grab: true, edge: 'start' });
  assert.deepEqual(v.hit(205, GRIP_Y), { kind: 'grip', grab: true, edge: 'start' });
  assert.deepEqual(v.hit(450, GRIP_Y), { kind: 'move', grab: true }); // the middle, x=450
  assert.deepEqual(v.hit(300, GRIP_Y), { kind: 'body', select: true });
  // Inside the selection in the body, nothing grabs.
  assert.deepEqual(v.hit(300, BODY_Y), { kind: 'body', select: true });
});

test('a selection a pixel wide still has two grips and no move handle', () => {
  const { v } = harness({ region: { start: 7000, end: 7010 } }); // x 200..201
  assert.equal(v.hit(185, GRIP_Y).edge, 'start');
  assert.equal(v.hit(215, GRIP_Y).edge, 'end');
  assert.equal(v.moveHandleShown(200, 201), false);
});

// --- the body ----------------------------------------------------------------

test('press, hold, then drag selects from the press point', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness();
  v.down(at(200));
  assert.deepEqual(only(log, 'regionChange'), []);
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7289 }, final: false }]);
  v.move(at(240));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7400 }, final: false }]);
  v.up(at(240));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 7000, end: 7400 }, final: true }]);
});

test('with snap on, a held select lands on beats', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // 120 BPM at 48 kHz: a beat is 24000 frames; fpp 100 so a beat is 240 px.
  const { v, log } = harness({ grid: { bpm: 120, downbeat: 0, sampleRate: 48000 }, snap: 'beat', start: 0 });
  v.view.fpp = 100;
  v.down(at(50));                      // frame 5000 -> snaps to 0
  t.mock.timers.tick(HOLD_MS);
  v.move(at(300)); v.up(at(300));      // frame 30000 -> snaps to 24000
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 0, end: 24000 }, final: true }]);
});

test('a drag pans, inside the selection too', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness({ region: { start: 6000, end: 9000 } });
  v.down(at(200));                     // inside the selection
  v.move(at(230));
  assert.equal(v.view.start, 5000 - 30 * 10);
  t.mock.timers.tick(HOLD_MS);         // the hold is dead, not late
  v.up(at(230));
  assert.deepEqual(only(log, 'regionChange'), []);
});

test('a second finger during a held select rolls it back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const prev = { start: 1000, end: 3000 };
  const { v, log } = harness({ region: prev });
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  v.down(at(300, BODY_Y, 2));
  assert.deepEqual(log.at(-1), ['regionChange', { region: prev, final: true }]);
  assert.equal(v.gesture.kind, 'pinch');
});

test('a tap moves the playhead, snapped; two taps add a flag', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness();
  v.down(at(200)); v.up(at(200));
  assert.deepEqual(log.at(-1), ['seek', { frame: 7000 }]);
  v.down(at(202)); v.up(at(202));
  assert.deepEqual(log.at(-1), ['addFlag', { frame: 7020 }]);
});

test('two taps on the ruler only seek', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness();
  v.down(at(100, PIN_H + 8)); v.up(at(100, PIN_H + 8));
  v.down(at(100, PIN_H + 8)); v.up(at(100, PIN_H + 8));
  assert.deepEqual(only(log, 'addFlag'), []);
  assert.equal(only(log, 'seek').length, 2);
});

test('a pan between two taps breaks the double-tap', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness();
  v.down(at(200)); v.up(at(200));
  v.down(at(200)); v.move(at(260)); v.up(at(260));
  v.down(at(200)); v.up(at(200));
  assert.deepEqual(only(log, 'addFlag'), []);
});

test('a still press held past a tap but under the hold still seeks', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
  const { v, log } = harness();
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS - 10);
  v.up(at(200));
  assert.deepEqual(only(log, 'seek').length + only(log, 'regionChange').length, 1);
});

test('a select held against the right edge scrolls the view under it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  const { v, log } = harness();
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  v.move(at(389)); // in the margin
  const before = v.view.start;
  frames.shift()();
  assert.ok(v.view.start > before);
  assert.ok(v.view.start - before <= EDGE_MAX_STEP_PX * v.view.fpp);
  assert.equal(log.at(-1)[0], 'regionChange');
  v.up(at(389));
});

test('a release from another pointer is ignored', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { v, log } = harness();
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  v.up(at(300, BODY_Y, 9));
  assert.equal(only(log, 'regionChange').filter(([, p]) => p.final).length, 0);
});

// --- grips and the move handle ------------------------------------------------

test('dragging the Out grip moves the end, and lands on beats with snap', () => {
  const { v, log } = harness({ region: { start: 0, end: 24000 }, grid: { bpm: 120, downbeat: 0, sampleRate: 48000 }, snap: 'beat', start: 0 });
  v.view.fpp = 100; // a beat is 240 px; the Out grip is at x 240..262
  v.down(at(250, GRIP_Y));
  v.move(at(380, GRIP_Y)); // +130 px -> 37000 -> nearest beat 48000
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 0, end: 48000 }, final: false }]);
  v.up(at(380, GRIP_Y));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 0, end: 48000 }, final: true }]);
});

test('the move handle moves the whole selection and keeps its length', () => {
  const { v, log } = harness({ region: { start: 6000, end: 10000 } }); // x 100..500
  v.down(at(300, GRIP_Y));
  v.move(at(350, GRIP_Y)); // +50 px = +500 frames
  v.up(at(350, GRIP_Y));
  assert.deepEqual(log.at(-1), ['regionChange', { region: { start: 6500, end: 10500 }, final: true }]);
});

test('a grip drag interrupted by a lost capture goes back', () => {
  const prev = { start: 6000, end: 10000 };
  const { v, log } = harness({ region: { ...prev } });
  v.down(at(90, GRIP_Y));
  v.move(at(60, GRIP_Y));
  v.lostCapture({ pointerId: 1 });
  assert.deepEqual(log.at(-1), ['regionChange', { region: prev, final: true }]);
  assert.equal(v.pointers.size, 0);
});

// --- pins, the playhead and the downbeat ------------------------------------

test('a tap on a pin opens its flag; a drag moves it', () => {
  const flag = { id: 'r1', frame: 7000 };
  const { v, log } = harness({ flags: [flag] });
  v.down(at(201, 8)); v.up(at(201, 8));
  assert.deepEqual(log.at(-1), ['selectFlag', { flag }]);
  v.down(at(201, 8));
  v.move(at(251, 8));
  assert.deepEqual(log.at(-1), ['flagMove', { flag, frame: 7500, final: false }]);
});

test('a cancelled pin drag puts the flag back', () => {
  const flag = { id: 'r1', frame: 7000 };
  const { v, log } = harness({ flags: [flag] });
  v.down(at(201, 8));
  v.move(at(251, 8));
  v.cancel({ pointerId: 1 });
  assert.deepEqual(log.at(-1), ['flagMove', { flag, frame: 7000, final: true }]);
});

test('the playhead handle scrubs silently and hands back where it stopped', () => {
  const { v, log } = harness({ cursor: 7000 });
  v.down(at(200, PIN_H + 8));
  assert.deepEqual(log.at(-1), ['scrubStart', {}]);
  v.move(at(260, PIN_H + 8));
  assert.deepEqual(log.at(-1), ['scrub', { frame: 7600 }]);
  v.up(at(260, PIN_H + 8));
  assert.deepEqual(log.at(-1), ['scrubEnd', { frame: 7600 }]);
});

test('bar 1 drags the downbeat', () => {
  const { v, log } = harness({ grid: { bpm: 120, downbeat: 9000, sampleRate: 48000 } }); // x=400
  v.down(at(400, PIN_H + 8));
  v.move(at(420, PIN_H + 8));
  v.up(at(420, PIN_H + 8));
  assert.deepEqual(log.at(-1), ['downbeatChange', { frame: 9200, final: true }]);
});

test('the hold buzzes where it can, and arms anyway where it cannot', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const saved = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate() { throw new Error('no'); } }, configurable: true });
  try {
    const { v, log } = harness();
    v.down(at(200));
    t.mock.timers.tick(HOLD_MS);
    assert.equal(only(log, 'regionChange').length, 1);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: saved, configurable: true });
  }
});

test('destroy during an edge scroll stops it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = 0;
  globalThis.requestAnimationFrame = () => 7;
  globalThis.cancelAnimationFrame = () => { cancelled++; };
  const { v } = harness();
  v.ro = { disconnect() {} };
  v.down(at(200));
  t.mock.timers.tick(HOLD_MS);
  v.move(at(389));
  v.destroy();
  assert.ok(cancelled >= 1);
  assert.equal(v.edgeRaf, 0);
});

test('the zones leave the body its height', () => {
  assert.ok(RULER_H + GRIP_H < 120, 'ruler and grips leave most of a phone-height canvas to the waveform');
});
