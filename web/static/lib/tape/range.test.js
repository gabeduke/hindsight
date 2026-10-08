import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeOf, tracksOf, covers, isLoop, rangeText, spanText, pasteFits, resize } from './range.js';

// 4 bars of 48000 frames.
const grid = { frames: 192000, bars: 4 };

test('a drag makes whole bars across the tracks it crossed, either way round', () => {
  assert.deepEqual(rangeOf(grid, 1, 60000, 100000, 3, 2, 1e9), { from: 48000, to: 144000, t0: 2, t1: 3 });
  assert.deepEqual(rangeOf(grid, 1, 100000, 60000, 2, 3, 1e9), { from: 48000, to: 144000, t0: 2, t1: 3 });
  // A still hold is one bar.
  assert.deepEqual(rangeOf(grid, 1, 50000, 50000, 1, 1, 1e9), { from: 48000, to: 96000, t0: 1, t1: 1 });
});

test('a range snaps to the snap: beats, or nothing with the snap off', () => {
  // A beat is 12000 frames.
  assert.deepEqual(rangeOf(grid, 4, 13000, 30000, 1, 1, 1e9), { from: 12000, to: 36000, t0: 1, t1: 1 });
  assert.deepEqual(rangeOf(grid, 0, 13000, 30000, 1, 1, 1e9), { from: 13000, to: 30000, t0: 1, t1: 1 });
  assert.equal(spanText(60000, 84000, grid, 48000), '2 beats from 2.2');
  assert.equal(spanText(0, 120000, grid, 48000), '2.5 bars from 1.1');
});

test('with no tempo a range is the frames dragged across, and never past the tape', () => {
  assert.deepEqual(rangeOf(null, 1, 9000, 1000, 1, 1, 1e9), { from: 1000, to: 9000, t0: 1, t1: 1 });
  assert.deepEqual(rangeOf(grid, 1, 0, 200000, 1, 4, 150000), { from: 0, to: 150000, t0: 1, t1: 4 });
});

test('a range lists and covers its tracks', () => {
  const r = { from: 0, to: 1, t0: 2, t1: 4 };
  assert.deepEqual(tracksOf(r), [2, 3, 4]);
  assert.ok(covers(r, 3) && !covers(r, 1) && !covers(null, 2));
});

test('a range is the loop when its bars are', () => {
  assert.ok(isLoop({ from: 48000, to: 96000, t0: 1, t1: 1 }, { in: 48000, out: 96000 }));
  assert.ok(!isLoop({ from: 48000, to: 96000, t0: 1, t1: 1 }, { in: 0, out: 96000 }));
  assert.ok(!isLoop(null, { in: 0, out: 1 }));
});

test('the action bar names a range by its tracks and bars', () => {
  assert.equal(rangeText({ from: 48000, to: 144000, t0: 2, t1: 3 }, 4, grid, 48000), 'Tracks 2–3 · bars 2–3');
  assert.equal(rangeText({ from: 0, to: 48000, t0: 1, t1: 4 }, 4, grid, 48000), 'All tracks · bar 1');
  assert.equal(rangeText({ from: 0, to: 96000, t0: 2, t1: 2 }, 4, null, 48000), 'Track 2 · 2.0 s');
  assert.equal(spanText(0, 192000, grid, 48000), 'bars 1–4');
});

test('a paste fits when its tracks do, from the range’s first', () => {
  assert.ok(pasteFits(3, 2, 4));
  assert.ok(!pasteFits(4, 2, 4));
  assert.ok(!pasteFits(1, 0, 4));
});

test('an edge dragged lands on the snap, and never crosses the other', () => {
  const r = { from: 48000, to: 144000, t0: 1, t1: 2 };
  assert.deepEqual(resize(r, 'to', 100000, grid, 1, 1e9), { ...r, to: 96000 });
  assert.deepEqual(resize(r, 'from', 0, grid, 4, 1e9), { ...r, from: 0 });
  assert.deepEqual(resize(r, 'from', 200000, grid, 1, 1e9), { ...r, from: 96000 }); // a bar short of its end
  assert.deepEqual(resize(r, 'to', 1000, grid, 1, 1e9), { ...r, to: 96000 });
  assert.deepEqual(resize(r, 'to', 150001.4, null, 0, 1e9), { ...r, to: 150001 });
  assert.deepEqual(resize(r, 'to', 2e9, grid, 1, 160000), { ...r, to: 160000 });
});
