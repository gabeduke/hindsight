import test from 'node:test';
import assert from 'node:assert/strict';
import { keyState, windowFrames, takesPoll, HELD_MS, pulledTo } from './state.js';

const grab = { in: 0, out: 4, frames: 4 };
const board = (o = {}) => ({ created: 'b1', frames: 4, tracks: [[{}]], grab: { ...grab, ...o } });

test('while a grab is on its way, ↵ has nothing to drop', () => {
  // ↵ during GRAB's wait once dropped the new grab where a span had been
  // worked out for the old one, over the clips there.
  const st = { open: true, grabbing: true, board: board(), dropped: 'b1', droppedAt: 0 };
  assert.deepEqual(keyState(st, 100), { open: false, held: false });
  assert.deepEqual(keyState({ ...st, grabbing: false, dropped: '' }, 100), { open: true, held: false });
});

test('↵ drops again only just after a drop, and not after anything else', () => {
  const st = { open: false, grabbing: false, board: board(), dropped: 'b1', droppedAt: 1000 };
  assert.equal(keyState(st, 1000 + HELD_MS - 1).held, true);
  assert.equal(keyState(st, 1000 + HELD_MS + 1).held, false, 'it lapses');
  assert.equal(keyState({ ...st, dropped: '' }, 1001).held, false, 'another action let it go');
  assert.equal(keyState(st, 1001, true).held, false, 'clips selected: ↵ is theirs');
  assert.equal(keyState({ ...st, board: { ...board(), created: 'b2' } }, 1001).held, false, 'another buffer');
});

test('the length DROP works with is the window as it stands now', () => {
  // A quick ⇧] then ↵: the drop must fit the window as moved, not as the
  // Pi last said it was.
  const st = { board: board({ in: 0, out: 4 }), local: { in: 0, out: 6 } };
  assert.equal(windowFrames(st), 6);
  assert.equal(windowFrames({ board: { ...board({ in: 1, out: 3 }), frames: 2 }, local: null }), 2);
  assert.equal(windowFrames({ board: null }), 0);
});

test('a fetch begun while a grab is on its way is dropped', () => {
  // The 2 s poll's old clipboard closed the bench mid-grab.
  assert.equal(takesPoll({ gen: 3, local: null, grabbing: true }, 3), false);
  assert.equal(takesPoll({ gen: 3, local: null, grabbing: false }, 3), true);
  assert.equal(takesPoll({ gen: 4, local: null, grabbing: false }, 3), false);
  assert.equal(takesPoll({ gen: 3, local: { in: 0, out: 1 }, grabbing: false }, 3), false);
});

// Pulling the phone's sheet down closed the buffer (below 12% of the screen):
// a person who pulled it down to see the lanes lost the buffer instead, and
// only "Buffer ▴" brought it back. A pull settles at the nearest of peek,
// half and full, and never closes: the ✕ closes it.
test('a sheet pulled right down settles at its peek, it does not close', () => {
  assert.equal(pulledTo(0.02), 'peek');
  assert.equal(pulledTo(0.11), 'peek', 'where it used to close');
  assert.equal(pulledTo(0.24), 'peek');
});

test('a sheet let go higher settles at half or full', () => {
  assert.equal(pulledTo(0.25), 'half');
  assert.equal(pulledTo(0.61), 'half');
  assert.equal(pulledTo(0.62), 'full');
  assert.equal(pulledTo(0.95), 'full');
});
