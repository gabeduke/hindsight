import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAP_PX, PULL_PX, snap, pull, lean } from './plug.js';

const hole = (id, x, y, box) => ({ id, x, y, ...(box ? { box } : {}) });

test('the numbers: a plug snaps within 24 px, and comes out with a pull of 48', () => {
  assert.equal(SNAP_PX, 24);
  assert.equal(PULL_PX, 48);
  assert.ok(PULL_PX > SNAP_PX, 'a plug let go inside the snap goes back in, so the pull must reach past it');
});

test('a plug snaps into a socket within 24 px of its hole, and not a hair further', () => {
  const t = [hole('kit.track.1', 100, 100)];
  assert.equal(snap({ x: 100, y: 100 }, t)?.id, 'kit.track.1');
  assert.equal(snap({ x: 124, y: 100 }, t)?.id, 'kit.track.1', 'at 24 px');
  assert.equal(snap({ x: 100, y: 124.01 }, t), null, 'at 24.01 px');
  // On a diagonal: 3-4-5 × 4.8 = 24.
  const o = [hole('kit.track.1', 0, 0)];
  assert.equal(snap({ x: 14.4, y: 19.2 }, o)?.id, 'kit.track.1');
  assert.equal(snap({ x: 14.5, y: 19.3 }, o), null);
});

test('between two sockets the nearer wins', () => {
  const t = [hole('a', 0, 0), hole('b', 30, 0)];
  assert.equal(snap({ x: 14, y: 0 }, t)?.id, 'a');
  assert.equal(snap({ x: 16, y: 0 }, t)?.id, 'b');
  assert.equal(snap({ x: 15, y: 0 }, t)?.id, 'a', 'a tie goes to the first');
});

test('anywhere over a socket’s button counts, as a drop on it did in P6', () => {
  // A track socket: the hole at the left of a button with its name beside.
  const t = [hole('kit.track.2', 110, 200, { left: 100, top: 180, right: 172, bottom: 228 })];
  assert.equal(snap({ x: 168, y: 220 }, t)?.id, 'kit.track.2', '58 px from the hole, but on the button');
  assert.equal(snap({ x: 173, y: 220 }, t), null, 'off the button and too far from the hole');
  // Over a button beats near another hole.
  const two = [hole('near', 160, 190), ...t];
  assert.equal(snap({ x: 150, y: 210 }, two)?.id, 'kit.track.2');
});

test('nothing to go into, nothing to snap to', () => {
  assert.equal(snap({ x: 0, y: 0 }, []), null);
});

test('a plug stays in until it’s pulled 48 px, then stays out until it’s brought back within 24', () => {
  const h = { x: 50, y: 50 };
  // In: a tug isn't a pull.
  assert.equal(pull(false, h, { x: 50, y: 50 + 8 }), false);
  assert.equal(pull(false, h, { x: 50 + 48, y: 50 }), false, 'at 48 px it is still in');
  assert.equal(pull(false, h, { x: 50 + 48.01, y: 50 }), true, 'past 48 px it comes out');
  // Out: it doesn't jump back in at 47 px.
  assert.equal(pull(true, h, { x: 50 + 47, y: 50 }), true);
  assert.equal(pull(true, h, { x: 50 + 24.01, y: 50 }), true);
  assert.equal(pull(true, h, { x: 50 + 24, y: 50 }), false, 'back within 24 px it goes in again');
});

test('a plug still in its socket leans toward the finger, a few pixels at most', () => {
  const h = { x: 0, y: 0 };
  assert.deepEqual(lean(h, { x: 0, y: 0 }), { x: 0, y: 0 });
  const small = lean(h, { x: 8, y: 0 });
  assert.ok(small.x > 0 && small.x < 8 && small.y === 0, 'toward the finger, not to it');
  const far = lean(h, { x: 40, y: 30 });
  assert.ok(Math.hypot(far.x, far.y) <= 6 + 1e-9);
  assert.ok(Math.abs(far.y / far.x - 30 / 40) < 1e-9, 'along the pull');
});
