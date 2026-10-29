// web/static/lib/ui/sheet.test.js
// A sheet you drag (lib/ui/sheet.js): where a flick settles, how it gives
// past its top, and the sheet itself -- it follows the finger, settles on a
// spring at the detent the flick carries it to, goes away on a swipe down
// and on Back or Escape (its layer, the one way out), opens under a drag up
// from where it was put away, swallows the click a drag's lift sends, and
// fades instead of travelling with less motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { createLayers } from './layers.js';
import { Ticker, project } from '../objects/motion.js';
import { createSheet, settleAt, give, GIVE, STILL_MS } from './sheet.js';

// --- settleAt and give ------------------------------------------------------

test('settleAt: let go still, it goes to the nearest stop', () => {
  const s = (y) => settleAt({ y, detents: [0, 400], closed: 800 });
  assert.deepEqual(s(150), { y: 0, closing: false, detent: 0 });
  assert.deepEqual(s(260), { y: 400, closing: false, detent: 1 });
  assert.deepEqual(s(700), { y: 800, closing: true, detent: -1 });
});

test('settleAt: a flick carries it to where it would have coasted, not where the finger let go', () => {
  // Let go near the top, flicked down hard: away.
  const v = 2000;
  assert.ok(100 + project(v) > 600, 'the flick carries past half way');
  assert.equal(settleAt({ y: 100, velocity: v, detents: [0], closed: 800 }).closing, true);
  // Let go low, flicked up: all the way up.
  assert.equal(settleAt({ y: 600, velocity: -2000, detents: [0], closed: 800 }).detent, 0);
});

test('settleAt: a sheet that can’t be put away settles on a detent, however hard the flick', () => {
  assert.deepEqual(settleAt({ y: 500, velocity: 5000, detents: [0, 300], closed: 800, closable: false }), { y: 300, closing: false, detent: 1 });
});

test('give: below its top it follows the finger; above, it gives', () => {
  assert.equal(give(120), 120);
  assert.equal(give(-100), -100 * GIVE);
  assert.equal(give(40, 50), 50 + (40 - 50) * GIVE);
});

// --- the sheet ----------------------------------------------------------------

// A clock run by hand: each frame() steps 16 ms.
function aClock() {
  let t = 0;
  let next = null;
  const clock = new Ticker({ raf: (fn) => { next = fn; return 1; }, cancel: () => { next = null; }, now: () => t, reduced: false });
  return {
    clock,
    frame() { const f = next; next = null; t += 16; f?.(); },
    run(max = 400) { for (let i = 0; i < max && next; i++) this.frame(); },
    get running() { return !!next; },
  };
}

function aWindow() {
  return {
    addEventListener() {}, removeEventListener() {},
    fire() {},
  };
}

function setup({ reduced = false, detents = [0], closable = true, animate = false } = {}) {
  const doc = fakeDoc();
  const win = aWindow();
  const layers = createLayers({ doc, win, CloseWatcher: undefined, history: undefined });
  const el = doc.createElement('div');
  const handle = doc.createElement('div');
  const button = doc.createElement('button');
  handle.append(button);
  el.append(handle);
  doc.body.append(el);
  const fades = [];
  if (animate) {
    el.animate = (frames, opts) => {
      const a = { frames, opts, cancel() { this.cancelled = true; }, finish() { this.onfinish?.(); } };
      fades.push(a);
      return a;
    };
  }
  const ck = aClock();
  const log = [];
  const sheet = createSheet(el, {
    layers, kind: 'player', modal: true,
    detents: () => detents, closed: () => 800, closable,
    handles: [handle],
    onShow: () => log.push('show'),
    onHide: (why) => log.push(`hide:${why}`),
    onDetent: (i) => log.push(`detent:${i}`),
    clock: ck.clock, reduced: () => reduced,
  });
  let t = 0;
  const ev = (type, y, { x = 100, id = 1, dt = 16, target = handle } = {}) => {
    t += dt;
    const e = {
      type, clientX: x, clientY: y, pointerId: id, button: 0, timeStamp: t, target, currentTarget: handle,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const fn of handle.listeners.get(type) || []) fn(e);
    return e;
  };
  return { doc, layers, el, handle, button, ck, sheet, log, ev, fades, transform: () => el.style.transform };
}

test('open: it comes up from where it was put away and settles at the top, on the ticker', () => {
  const { sheet, ck, log, transform, layers } = setup();
  sheet.open();
  assert.deepEqual(log, ['show']);
  assert.equal(layers.top()?.kind, 'player', 'it is on the stack');
  assert.ok(sheet.y > 700, 'it starts where it was put away');
  ck.frame();
  assert.ok(sheet.y < 800, 'and moves up');
  ck.run();
  assert.equal(sheet.y, 0);
  assert.equal(transform(), '', 'at rest at the top it carries no transform');
  assert.deepEqual(log, ['show', 'detent:0']);
  assert.equal(ck.running, false, 'and parks the ticker');
});

test('a drag down follows the finger, and a short one settles back up', () => {
  const { sheet, ck, ev, log } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100);
  ev('pointermove', 105);
  assert.equal(sheet.y, 0, 'within the slop it hasn’t moved');
  ev('pointermove', 120);
  ev('pointermove', 180);
  assert.equal(sheet.y, 72, 'past the slop, it follows from the slop’s edge');
  ev('pointerup', 180, { dt: STILL_MS + 50 });
  ck.run();
  assert.equal(sheet.y, 0);
  assert.equal(log.at(-1), 'detent:0');
  assert.equal(sheet.isOpen, true);
});

test('a swipe down puts it away: its layer closes, it slides out, then the owner hides it', () => {
  const { sheet, ck, ev, log, layers } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100);
  ev('pointermove', 120);
  for (let y = 160; y <= 400; y += 60) ev('pointermove', y, { dt: 16 });
  ev('pointerup', 400, { dt: 8 });
  assert.equal(layers.top(), null, 'off the stack at once');
  assert.equal(log.includes('hide:program'), false, 'still on screen, sliding');
  ck.run();
  assert.equal(log.at(-1), 'hide:program');
  assert.equal(sheet.y, null);
  assert.equal(sheet.isOpen, false);
});

test('the click a drag’s lift sends is swallowed; a tap’s is not', () => {
  const { sheet, ck, ev, handle } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100);
  ev('pointermove', 130);
  ev('pointerup', 130, { dt: STILL_MS + 50 });
  const c = ev('click', 130);
  assert.equal(c.defaultPrevented && c.stopped, true);
  ck.run();
  ev('pointerdown', 100);
  ev('pointerup', 100);
  const tap = ev('click', 100);
  assert.equal(tap.stopped, false);
  assert.ok(handle.listenerCount('click') >= 1);
});

test('above its top it gives, and comes back', () => {
  const { sheet, ck, ev } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 300);
  ev('pointermove', 290);
  ev('pointermove', 200);
  assert.equal(sheet.y, (200 - 292) * GIVE);
  ev('pointerup', 200, { dt: STILL_MS + 50 });
  ck.run();
  assert.equal(sheet.y, 0);
});

test('Back or Escape (its layer closing) slides it out, then the owner hides it', () => {
  const { sheet, ck, log, layers } = setup();
  sheet.open(); ck.run();
  layers.top().close('escape');
  assert.equal(sheet.isOpen, false, 'it is going');
  ck.run();
  assert.equal(log.at(-1), 'hide:escape');
});

test('the owner’s close goes through the layer too: one way out', () => {
  const { sheet, ck, log, layers } = setup();
  sheet.open(); ck.run();
  sheet.close();
  assert.equal(layers.top(), null);
  ck.run();
  assert.equal(log.at(-1), 'hide:program');
});

test('put away, a drag up from a handle opens it under the finger; a drag down there does nothing', () => {
  const { sheet, ck, ev, log, layers } = setup();
  ev('pointerdown', 780);
  ev('pointermove', 790);
  ev('pointermove', 800);
  assert.equal(sheet.isOpen, false, 'a drag down from the mini player opens nothing');
  ev('pointerup', 800);
  ev('pointerdown', 780);
  ev('pointermove', 760);
  assert.deepEqual(log, ['show'], 'past the slop, it is laid out');
  assert.equal(layers.top()?.kind, 'player');
  ev('pointermove', 500);
  assert.equal(sheet.y, 800 - (772 - 500), 'it follows the finger up from where it was put away');
  ev('pointermove', 300, { dt: 16 });
  ev('pointerup', 300, { dt: 8 });
  ck.run();
  assert.equal(sheet.y, 0);
  assert.equal(log.at(-1), 'detent:0');
});

test('caught on its way out, it follows the finger again and stays open', () => {
  const { sheet, ck, ev, log, layers } = setup();
  sheet.open(); ck.run();
  sheet.close();
  ck.frame(); ck.frame();
  const y = sheet.y;
  assert.ok(y > 0 && y < 800);
  ev('pointerdown', 400);
  ev('pointermove', 380);
  ev('pointermove', 300);
  assert.ok(sheet.y < y, 'held, it moves with the finger');
  assert.equal(layers.top()?.kind, 'player', 'back on the stack');
  ev('pointerup', 300, { dt: STILL_MS + 50 });
  ck.run();
  assert.equal(sheet.isOpen, true);
  assert.equal(log.includes('hide:program'), false);
});

test('detents: a sheet stops half way, and snap moves it between them', () => {
  const { sheet, ck, ev } = setup({ detents: [0, 400] });
  sheet.open({ detent: 1 }); ck.run();
  assert.equal(sheet.y, 400);
  assert.equal(sheet.detent, 1);
  sheet.snap(0); ck.run();
  assert.equal(sheet.y, 0);
  ev('pointerdown', 100);
  ev('pointermove', 120);
  ev('pointermove', 420);
  ev('pointerup', 420, { dt: STILL_MS + 50 });
  ck.run();
  assert.equal(sheet.y, 400, 'let go near the half, it rests there');
});

test('a drag that goes far in one move is not lost: it follows from the slop’s edge', () => {
  const { sheet, ck, ev } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100);
  ev('pointermove', 500);
  assert.equal(sheet.y, 500 - 108);
});

test('a sideways drag, or one on what drags itself, is not the sheet’s', () => {
  const { sheet, ck, ev, doc, handle } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100, { x: 100 });
  ev('pointermove', 105, { x: 160 });
  ev('pointermove', 200, { x: 170 });
  assert.equal(sheet.y, 0, 'sideways first: someone else’s');
  ev('pointerup', 200);
  const strip = doc.createElement('canvas');
  handle.append(strip);
  ev('pointerdown', 100, { target: strip });
  ev('pointermove', 200, { target: strip });
  assert.equal(sheet.y, 0, 'the strip scrubs, it doesn’t drag the sheet');
});

test('with less motion it doesn’t travel: it is there at once, and fades in and out', () => {
  const { sheet, ck, log, fades, el } = setup({ reduced: true, animate: true });
  sheet.open();
  assert.equal(sheet.y, 0);
  assert.equal(ck.running, false, 'no spring');
  assert.deepEqual(log, ['show', 'detent:0']);
  assert.deepEqual(fades[0].frames.map((f) => f.opacity), [0, 1]);
  fades[0].finish();
  sheet.close();
  assert.deepEqual(fades[1].frames.map((f) => f.opacity), [1, 0]);
  assert.equal(log.includes('hide:program'), false, 'hidden once faded');
  fades[1].finish();
  assert.equal(log.at(-1), 'hide:program');
  assert.equal(el.style.opacity, '');
});

test('an opening drag the browser cancels drops back: the player doesn’t pop open', () => {
  const { sheet, ck, ev, log, layers } = setup();
  ev('pointerdown', 780);
  ev('pointermove', 760);
  ev('pointermove', 600);
  ev('pointercancel', 600);
  ck.run();
  assert.equal(layers.top(), null, 'off the stack');
  assert.equal(log.at(-1), 'hide:program', 'and put away again');
  assert.equal(sheet.isOpen, false);
});

test('with less motion, opened again while it fades out, it stays open', () => {
  const { sheet, log, fades, layers, el } = setup({ reduced: true, animate: true });
  sheet.open();
  fades[0].finish();
  sheet.close();
  sheet.open(); // within the fade
  fades[1].finish?.(); // the fade out, had it not been stopped, would hide it now
  assert.equal(sheet.isOpen, true);
  assert.equal(layers.top()?.kind, 'player');
  assert.equal(log.includes('hide:program'), false);
  assert.ok(fades[1].cancelled, 'the fade out is stopped');
  assert.notEqual(el.style.opacity, '0');
});

test('a keyboard’s click after a drag that sent none is not swallowed', () => {
  const { sheet, ck, ev, handle } = setup();
  sheet.open(); ck.run();
  ev('pointerdown', 100);
  ev('pointermove', 130);
  ev('pointerup', 130, { dt: STILL_MS + 50 });
  ck.run();
  const e = { type: 'click', detail: 0, stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
  for (const fn of handle.listeners.get('click') || []) fn(e);
  assert.equal(e.stopped, false);
});

test('destroy lets go of its handles and puts it away', () => {
  const { sheet, ck, handle, log } = setup();
  sheet.open(); ck.run();
  sheet.destroy();
  assert.equal(handle.listenerCount('pointerdown'), 0);
  assert.equal(log.at(-1), 'hide:program');
});

test('a sheet needs the page’s stack', () => {
  assert.throws(() => createSheet({}, {}), /stack/);
});
