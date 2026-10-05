import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gestureSave, EditorBar } from './editor-bar.js';

test('a gesture saves once, when it ends, if it moved anything', () => {
  const cases = [
    // [prev, next, final, dirty] -> { save, dirty }, why
    [[100, 101, false, false], { save: false, dirty: true }, 'a move that is not final marks the gesture and saves nothing'],
    [[100, 101, false, true], { save: false, dirty: true }, 'and stays marked'],
    [[100, 100, false, false], { save: false, dirty: false }, 'a move that goes nowhere marks nothing'],
    [[100, 100, false, true], { save: false, dirty: true }, 'nor clears the mark'],
    [[100, 100, true, false], { save: false, dirty: false }, 'a final with no change, after no move, saves nothing'],
    [[100, 100, true, true], { save: true, dirty: false }, 'a final with no change after a moved gesture saves it'],
    [[100, 101, true, false], { save: true, dirty: false }, 'a final change saves'],
    [[100, 101, true, true], { save: true, dirty: false }, 'and clears the mark'],
  ];
  for (const [args, want, why] of cases) assert.deepEqual(gestureSave(...args), want, why);
});

// --- the bar, on fakes ---------------------------------------------------------
// A pad, a button, a label: enough of an element for the bar's wiring.
class El extends EventTarget {
  constructor() {
    super();
    this.textContent = '';
    this.captured = null;
    this.active = false;
    this.classList = { add: () => { this.active = true; }, remove: () => { this.active = false; } };
  }
  setPointerCapture(id) { this.captured = id; }
  getBoundingClientRect() { return { width: 100 }; }
}
const ev = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), props);

// A point on a 0..1000 line, at 1 frame a pixel on a 400 px view.
function setup() {
  globalThis.document = new EventTarget();
  const els = { zoom: new El(), pos: new El(), back: new El(), fwd: new El(), step: new El() };
  const log = { places: [], follows: [], renders: 0, readouts: 0 };
  const host = {
    on: true, p: 500, z: 1,
    active: () => host.on,
    frame: () => (host.on ? host.p : null),
    land: (f) => Math.max(0, Math.min(1000, f)),
    place: (f, save) => { host.p = f; log.places.push([f, save]); },
    fpp: () => host.z, width: () => 400,
    follow: (fpp) => { log.follows.push(fpp); if (fpp != null) host.z = fpp; },
    sampleRate: 48000,
    render: () => { log.renders++; },
    readout: () => { log.readouts++; },
  };
  const bar = new EditorBar({ els, host });
  const saves = () => log.places.filter(([, s]) => s).length;
  return { els, host, log, bar, saves };
}

test('a POSITION drag moves the point as it goes and saves once, on release', () => {
  const { els, host, log, saves } = setup();
  els.pos.dispatchEvent(ev('pointerdown', { button: 0, pointerId: 1, clientX: 0 }));
  assert.equal(els.pos.captured, 1);
  assert.ok(els.pos.active);
  for (let x = 10; x <= 50; x += 10) els.pos.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: x }));
  assert.ok(host.p > 500, 'it moved');
  assert.equal(saves(), 0, 'nothing saved mid-drag');
  els.pos.dispatchEvent(ev('pointerup', { pointerId: 1 }));
  assert.equal(saves(), 1, 'one save for the drag');
  assert.equal(log.places.at(-1)[0], host.p);
  assert.ok(!els.pos.active);
});

test('a second finger, a secondary button, or no edit open: the pad ignores it', () => {
  const { els, host, saves, log } = setup();
  els.pos.dispatchEvent(ev('pointerdown', { button: 2, pointerId: 1, clientX: 0 }));
  els.pos.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: 50 }));
  assert.equal(log.places.length, 0, 'a right button does nothing');
  els.pos.dispatchEvent(ev('pointerdown', { button: 0, pointerId: 1, clientX: 0 }));
  els.pos.dispatchEvent(ev('pointerdown', { button: 0, pointerId: 2, clientX: 0 }));
  els.pos.dispatchEvent(ev('pointermove', { pointerId: 2, clientX: 80 }));
  assert.equal(log.places.length, 0, 'the second finger moves nothing');
  // A lost capture ends the drag, and saves what it moved.
  els.pos.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: 50 }));
  els.pos.dispatchEvent(ev('lostpointercapture', { pointerId: 1 }));
  assert.equal(saves(), 1);
  host.on = false;
  els.pos.dispatchEvent(ev('pointerdown', { button: 0, pointerId: 3, clientX: 0 }));
  assert.equal(els.pos.captured, 1, 'not taken while nothing is edited');
});

test('a fraction of a frame on POSITION adds up rather than being lost', () => {
  const { els, host } = setup();
  host.z = 0.125; // 8 px a frame: a pad of 100 px moves 25 frames, so 1 px is a quarter
  els.pos.dispatchEvent(ev('pointerdown', { button: 0, pointerId: 1, clientX: 0 }));
  for (let x = 1; x <= 4; x++) els.pos.dispatchEvent(ev('pointermove', { pointerId: 1, clientX: x }));
  assert.equal(host.p, 501);
});

test('a held arrow on POSITION steps and saves when it lets go; the document does not see the key', () => {
  const { els, host, saves } = setup();
  let stopped = 0;
  const down = (props) => {
    const e = ev('keydown', props);
    e.stopPropagation = () => { stopped++; };
    els.pos.dispatchEvent(e);
    return e;
  };
  const e = down({ key: 'ArrowRight', repeat: false });
  assert.ok(e.defaultPrevented);
  assert.equal(host.p, 548, 'a millisecond at 1 frame a pixel');
  assert.equal(saves(), 1, 'a single press saves');
  down({ key: 'ArrowLeft', repeat: true, shiftKey: true });
  down({ key: 'ArrowRight', repeat: true });
  assert.equal(host.p, 548 - 480 + 48, 'Shift is ten steps');
  assert.equal(saves(), 1, 'a held key saves nothing yet');
  document.dispatchEvent(ev('keyup', { key: 'ArrowRight' }));
  assert.equal(saves(), 2, 'letting go saves');
  document.dispatchEvent(ev('keyup', { key: 'ArrowRight' }));
  assert.equal(saves(), 2, 'once');
  assert.equal(stopped, 3);
});

test('ZOOM keys halve or double the zoom, Shift ten times', () => {
  const { els, log } = setup();
  els.zoom.dispatchEvent(ev('keydown', { key: 'ArrowRight' }));
  els.zoom.dispatchEvent(ev('keydown', { key: 'ArrowLeft', shiftKey: true }));
  assert.deepEqual(log.follows, [0.5, 5]);
  assert.equal(log.readouts, 2);
  assert.equal(log.renders, 0, 'a zoom redraws the readout, not the view');
});

test('the steps: a final that changes nothing saves nothing', () => {
  const { els, host, saves } = setup();
  host.p = 1000;
  els.fwd.dispatchEvent(ev('click'));
  assert.equal(host.p, 1000);
  assert.equal(saves(), 0);
  els.back.dispatchEvent(ev('click'));
  assert.equal(host.p, 952);
  assert.equal(saves(), 1);
});

test('a burst of wheel notches is one save, 250 ms after the last; commit saves it at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { bar, host, saves, log } = setup();
  host.z = 0.25;
  for (let i = 0; i < 6; i++) assert.equal(bar.wheel({ deltaY: 1, deltaX: 0, deltaMode: 0 }), true);
  assert.equal(host.p, 501, 'six quarter-frames: one whole frame, the rest kept');
  t.mock.timers.tick(249);
  assert.equal(saves(), 0);
  t.mock.timers.tick(1);
  assert.equal(saves(), 1);
  bar.wheel({ deltaY: 8, deltaX: 0, deltaMode: 0 });
  bar.commit();
  assert.equal(saves(), 2, 'commit saves the burst in flight');
  t.mock.timers.tick(250);
  assert.equal(saves(), 2, 'and its timer is gone');
  const before = log.places.length;
  assert.equal(bar.wheel({ deltaY: 100, deltaX: 0, deltaMode: 0, metaKey: true }), true);
  assert.equal(log.places.length, before, '⌘ zooms, it does not move');
  assert.equal(log.follows.at(-1), 0.25 * Math.exp(1));
  host.on = false;
  assert.equal(bar.wheel({ deltaY: 1, deltaX: 0, deltaMode: 0 }), false, 'not taken while nothing is edited');
});

test('the step label follows the zoom', () => {
  const { bar, els, host } = setup();
  bar.renderStep();
  assert.equal(els.step.textContent, '1 ms');
  host.z = 0.5;
  bar.renderStep();
  assert.equal(els.step.textContent, '1 smp');
});
