// web/static/lib/room/press.test.js
// What a press on a take is in the Listening Room (docs/superpowers/specs/
// 2026-10-15-flow-design.md, "A tap plays"): a tap plays, a hold selects -- a
// finger's hold, not a mouse's -- a ⇧-click selects too, and with a selection
// on, a tap picks the take into it. The clock and the pointer are stand-ins,
// so no finger is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SELECT_HOLD_MS } from '../shelf.js';
import { pressMachine } from './press.js';

// A clock the test turns by hand.
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    advance(ms) {
      now += ms;
      for (const [i, t] of [...timers]) if (t.at <= now) { timers.delete(i); t.fn(); }
    },
    pending: () => timers.size,
  };
}

function rig(opts = {}) {
  const c = clock();
  const log = [];
  const m = pressMachine({
    onTap: () => log.push('tap'),
    onSelect: () => log.push('select'),
    selecting: () => !!opts.selecting,
    setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  return { m, c, log };
}
const touch = (x = 10, y = 10) => ({ pointerType: 'touch', button: 0, clientX: x, clientY: y });
const pen = () => ({ pointerType: 'pen', button: 0, clientX: 10, clientY: 10 });
const mouse = () => ({ pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
const click = (extra = {}) => ({ detail: 1, shiftKey: false, preventDefault() { this.prevented = true; }, ...extra });

test('the hold is the app’s own: the list’s Select hold', () => {
  const { m, c, log } = rig();
  m.down(touch());
  c.advance(SELECT_HOLD_MS - 1);
  assert.deepEqual(log, [], 'not yet');
  c.advance(1);
  assert.deepEqual(log, ['select']);
});

test('a tap plays: a quick press and its click is a tap, and nothing is selected', () => {
  const { m, c, log } = rig();
  m.down(touch());
  c.advance(120);
  m.up();
  m.click(click());
  assert.deepEqual(log, ['tap']);
  assert.equal(c.pending(), 0, 'no timer left to select it later');
});

test('a hold selects, and the click that ends it does not also play', () => {
  const { m, c, log } = rig();
  m.down(touch());
  c.advance(SELECT_HOLD_MS);
  m.up();
  const e = click();
  m.click(e);
  assert.deepEqual(log, ['select']);
  assert.ok(e.prevented, 'the lift’s click is swallowed');
  // The next tap is a tap again.
  m.down(touch());
  m.up();
  m.click(click());
  assert.deepEqual(log, ['select', 'tap']);
});

test('a pen holds like a finger', () => {
  const { m, c, log } = rig();
  m.down(pen());
  c.advance(SELECT_HOLD_MS);
  assert.deepEqual(log, ['select']);
});

test('a mouse’s press never holds: it would catch a slow click', () => {
  const { m, c, log } = rig();
  m.down(mouse());
  assert.equal(c.pending(), 0);
  c.advance(SELECT_HOLD_MS * 4);
  m.up();
  m.click(click());
  assert.deepEqual(log, ['tap']);
});

test('a finger that moves, a scroll that takes the touch, or a cancel selects nothing', () => {
  for (const end of [
    (m) => m.move({ clientX: 40, clientY: 10 }), // more than 8 px
    (m) => m.cancel(),
  ]) {
    const { m, c, log } = rig();
    m.down(touch());
    c.advance(SELECT_HOLD_MS - 50);
    end(m);
    c.advance(SELECT_HOLD_MS);
    assert.deepEqual(log, []);
  }
  // A small wobble is still a hold.
  const { m, c, log } = rig();
  m.down(touch());
  m.move({ clientX: 14, clientY: 12 });
  c.advance(SELECT_HOLD_MS);
  assert.deepEqual(log, ['select']);
});

test('a right or middle button is not a press', () => {
  const { m, c } = rig();
  m.down({ ...touch(), button: 2 });
  assert.equal(c.pending(), 0);
});

test('⇧-click selects (a mouse’s way in, and ⇧-Enter on a focused spine: a click with no pointer)', () => {
  const { m, log } = rig();
  m.click(click({ shiftKey: true }));
  m.click(click({ shiftKey: true, detail: 0 }));
  assert.deepEqual(log, ['select', 'select']);
});

test('Enter and Space on a focused spine are a tap (a click with no pointer)', () => {
  const { m, log } = rig();
  m.click(click({ detail: 0 }));
  assert.deepEqual(log, ['tap']);
});

test('with a selection on, a hold does nothing new and a tap is the tap that picks', () => {
  const { m, c, log } = rig({ selecting: true });
  m.down(touch());
  assert.equal(c.pending(), 0, 'no hold to wait for: the selection is already on');
  m.up();
  m.click(click());
  m.click(click({ shiftKey: true }));
  assert.deepEqual(log, ['tap', 'select'], 'the caller turns both into a toggle');
});

test('a hold whose lift never clicks does not swallow the next tap', () => {
  const { m, c, log } = rig();
  m.down(touch());
  c.advance(SELECT_HOLD_MS);
  m.up(); // the phone sent no click
  m.down(touch());
  m.up();
  m.click(click());
  assert.deepEqual(log, ['select', 'tap']);
});

test('a keyboard click is never the swallowed lift of a hold', () => {
  const { m, c, log } = rig();
  m.down(touch());
  c.advance(SELECT_HOLD_MS);
  m.up();
  m.click(click({ detail: 0 }));
  assert.deepEqual(log, ['select', 'tap']);
});

test('active says a finger is on the take (or a hold just fired), so a long-press menu is held back; a mouse never is', () => {
  const { m, c } = rig();
  assert.equal(m.active(), false);
  m.down(touch());
  assert.equal(m.active(), true);
  c.advance(SELECT_HOLD_MS);
  m.up();
  assert.equal(m.active(), true, 'the hold fired: its lift and its menu are still to come');
  m.click(click());
  assert.equal(m.active(), false);
  m.down(mouse());
  assert.equal(m.active(), false);
});
