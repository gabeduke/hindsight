import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armPress } from './armpress.js';
import { HOLD_MS } from '../tape/clipgestures.js';

// ● on a track's header, with the rooms on (F7): a tap arms just this track,
// a hold or ⇧-click arms it as well. The press is a small machine so it is
// tested with a clock in the test's hand, not a finger.
function rig() {
  const log = [];
  let now = 0, next = 1;
  const timers = new Map();
  const press = armPress({
    onTap: () => log.push('tap'),
    onAdd: () => log.push('add'),
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  const swallowed = [];
  const ev = (o = {}) => ({ button: 0, detail: 1, shiftKey: false, pointerType: 'touch', preventDefault() { swallowed.push(true); }, ...o });
  return { press, log, advance, ev, swallowed, timers };
}

test('a short press is a tap, once', () => {
  const r = rig();
  r.press.down(r.ev());
  r.advance(HOLD_MS - 50);
  r.press.up(r.ev());
  r.press.click(r.ev());
  r.advance(HOLD_MS * 3);
  assert.deepEqual(r.log, ['tap']);
});

test('a press held for the hold time adds, once, while the finger is still down; its click is swallowed', () => {
  const r = rig();
  r.press.down(r.ev());
  r.advance(HOLD_MS);
  assert.deepEqual(r.log, ['add'], 'it fires at the hold, not at lift-off');
  r.press.up(r.ev());
  r.press.click(r.ev());
  assert.deepEqual(r.log, ['add'], 'the click after the lift is not a tap too');
  assert.equal(r.swallowed.length, 1);
});

test('the next press is a fresh one after a hold', () => {
  const r = rig();
  r.press.down(r.ev()); r.advance(HOLD_MS); r.press.up(r.ev()); r.press.click(r.ev());
  r.press.down(r.ev()); r.press.up(r.ev()); r.press.click(r.ev());
  assert.deepEqual(r.log, ['add', 'tap']);
});

test('⇧-click adds, on a laptop', () => {
  const r = rig();
  r.press.down(r.ev({ shiftKey: true }));
  r.press.up(r.ev({ shiftKey: true }));
  r.press.click(r.ev({ shiftKey: true }));
  assert.deepEqual(r.log, ['add']);
});

test('a press that leaves the ●, or is cancelled by a scroll, does nothing', () => {
  const r = rig();
  r.press.down(r.ev());
  r.press.cancel();
  r.advance(HOLD_MS * 3);
  assert.deepEqual(r.log, []);
  assert.equal(r.timers.size, 0, 'no timer is left running');
});

test('a hold whose finger slid off never swallows the next keyboard press', () => {
  const r = rig();
  r.press.down(r.ev());
  r.advance(HOLD_MS);
  r.press.cancel(); // slid off: no click will come
  r.press.click(r.ev({ detail: 0 })); // Enter on the focused ●
  assert.deepEqual(r.log, ['add', 'tap']);
});

// A finger's pointerleave comes after its pointerup and before the click:
// it must not make the hold's click look like a tap.
test('a pointerleave after the lift does not turn the hold’s click into a tap', () => {
  const r = rig();
  r.press.down(r.ev());
  r.advance(HOLD_MS);
  r.press.up(r.ev());
  r.press.cancel();
  r.press.click(r.ev());
  assert.deepEqual(r.log, ['add']);
});

test('Enter or Space on the ● (a click with no pointer) is a tap; ⇧-Enter adds', () => {
  const r = rig();
  r.press.click(r.ev({ detail: 0 }));
  r.press.click(r.ev({ detail: 0, shiftKey: true }));
  assert.deepEqual(r.log, ['tap', 'add']);
});

// Spec: "hold it (or ⇧-click)". A hold is a finger's or a pen's; a mouse adds
// with ⇧-click, and a slow click is only a tap (it used to arm or disarm
// when it lasted past the hold time).
test('a mouse press held past the hold time is still just a tap', () => {
  const r = rig();
  r.press.down(r.ev({ pointerType: 'mouse' }));
  r.advance(HOLD_MS * 3);
  assert.deepEqual(r.log, [], 'nothing fires while the button is down');
  assert.equal(r.timers.size, 0, 'no hold timer ran for a mouse');
  r.press.up(r.ev({ pointerType: 'mouse' }));
  r.press.click(r.ev({ pointerType: 'mouse' }));
  assert.deepEqual(r.log, ['tap']);
});

test('a mouse ⇧-click adds, as ever', () => {
  const r = rig();
  r.press.down(r.ev({ pointerType: 'mouse', shiftKey: true }));
  r.press.up(r.ev({ pointerType: 'mouse', shiftKey: true }));
  r.press.click(r.ev({ pointerType: 'mouse', shiftKey: true }));
  assert.deepEqual(r.log, ['add']);
});

test('a pen held for the hold time adds, like a finger', () => {
  const r = rig();
  r.press.down(r.ev({ pointerType: 'pen' }));
  r.advance(HOLD_MS);
  assert.deepEqual(r.log, ['add']);
});

test('a press with no pointer type is not a hold either', () => {
  const r = rig();
  r.press.down({ button: 0, detail: 1, preventDefault() {} });
  r.advance(HOLD_MS * 3);
  assert.deepEqual(r.log, []);
});

test('a right or middle button press neither taps nor holds', () => {
  const r = rig();
  r.press.down(r.ev({ button: 2 }));
  r.advance(HOLD_MS * 3);
  assert.deepEqual(r.log, []);
});
