import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRange, editView, barSpan, nearestBar, xOf, frameAt, barLines, bpm, barBeat, fmtSecs, clipBuckets, snapFrame, slideTo, splitAt, joinPartner, fitsDoubled } from './geometry.js';

test('the lanes show the loop, or everything recorded', () => {
  assert.deepEqual(viewRange({ sample_rate: 48000, loop: { in: 100, out: 900 }, tracks: [] }), { from: 100, to: 900 });
  const t = { sample_rate: 48000, loop: { in: 0, out: 0 }, tracks: [{ clips: [{ at: 0, frames: 48000 * 40 }] }] };
  assert.deepEqual(viewRange(t), { from: 0, to: 48000 * 40 });
  assert.deepEqual(viewRange({ sample_rate: 48000, loop: {}, tracks: [] }), { from: 0, to: 48000 * 30 });
});

test('frames and pixels round-trip', () => {
  const v = { from: 1000, to: 3000 };
  assert.equal(xOf(2000, v, 400), 200);
  assert.equal(frameAt(200, v, 400), 2000);
});

test('bar lines land where the Pi puts them, for tempos that are not whole frames', () => {
  // 84 BPM, 4 bars: a bar is 137142.857 frames; the Pi rounds n × that.
  const grid = { frames: 548571, bars: 4 };
  const lines = barLines(grid, { from: 0, to: 548571 });
  assert.deepEqual(lines.map((l) => l.frame), [0, 137143, 274286, 411428, 548571]);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(bpm(grid, 48000) - 84) < 0.01);
  assert.equal(barBeat(0, grid), '1.1');
  assert.equal(barBeat(137143 + 34286, grid), '2.2');
  assert.deepEqual(barLines(null, { from: 0, to: 10 }), []);
});

test('a clip draws the part of its file it plays', () => {
  const pd = { duration: 2, sample_rate: 48000, buckets: 1024 };
  assert.deepEqual(clipBuckets({ src: 480, frames: 48000 }, pd), [5, 518]);
  assert.equal(fmtSecs(48000 * 61.25, 48000), '1:01.3');
});

test('the lanes show the loop and a bar either side, to drag it wider', () => {
  const grid = { frames: 192000, bars: 4 }; // a bar is 48000
  assert.deepEqual(editView({ sample_rate: 48000, grid, loop: { in: 96000, out: 288000 }, tracks: [] }), { from: 48000, to: 336000 });
  assert.deepEqual(editView({ sample_rate: 48000, grid, loop: { in: 0, out: 192000 }, tracks: [] }), { from: 0, to: 240000 });
  assert.deepEqual(editView({ sample_rate: 48000, loop: {}, tracks: [] }), { from: 0, to: 48000 * 30 });
});

test('a drag on the ruler takes whole bars, whichever way it goes', () => {
  const grid = { frames: 548571, bars: 4 }; // 84 BPM
  assert.deepEqual(barSpan(grid, 150000, 20000), { from: 0, to: 274286 });
  assert.deepEqual(barSpan(grid, 137143, 137143), { from: 137143, to: 274286 });
  assert.equal(nearestBar(grid, 200000), 137143);
  assert.equal(nearestBar(grid, 210000), 274286);
});

test('a slid clip snaps to the lines the Pi draws', () => {
  // 84 BPM, 4 bars: a bar is 137142.857 frames.
  const grid = { frames: 548571, bars: 4 };
  assert.equal(snapFrame(grid, 137000, 'bar'), 137143);
  assert.equal(snapFrame(grid, 60000, 'bar'), 0);
  assert.equal(snapFrame(grid, 36000, 'beat'), 34286);
  assert.equal(snapFrame(grid, 17000, '8th'), 17143);
  assert.equal(snapFrame(grid, 12345.4, 'off'), 12345);
  assert.equal(snapFrame(null, 12345, 'bar'), 12345);
  assert.equal(snapFrame(grid, -5000, 'bar'), 0);
  assert.equal(snapFrame(grid, -5000, 'off'), 0);
});

test('split and join find what the Pi would', () => {
  const a = { id: 'a', file: 'f', src: 480, frames: 1000, at: 0, layer: 0, gain_db: 0 };
  const b = { id: 'b', file: 'f', src: 1480, frames: 500, at: 1000, layer: 0, gain_db: 0 };
  const top = { id: 'c', file: 'g', src: 0, frames: 2000, at: 0, layer: 1 };
  const tr = { clips: [a, b, top] };
  assert.equal(splitAt(tr, 500), 2);
  assert.equal(splitAt(tr, 1000), 1); // on a's end: only the layer above runs across
  assert.equal(splitAt(tr, 3000), 0);
  assert.equal(joinPartner(tr, a), b);
  assert.equal(joinPartner(tr, b), a, 'from the second half too');
  assert.equal(joinPartner(tr, top), null);
  assert.equal(joinPartner({ clips: [a, { ...b, src: 1500 }] }, a), null, 'not straight on');
  assert.equal(joinPartner({ clips: [a, { ...b, gain_db: -3 }] }, a), null, 'a different level');
  assert.equal(joinPartner({ clips: [a, { ...b, layer: 1 }] }, a), null, 'another layer');
});

test('a loop doubles only while it fits on the tape', () => {
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 0, out: 500 } }), true);
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 100, out: 600 } }), false);
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 0, out: 0 } }), false);
});

test('a nudged clip splits where it is heard', () => {
  // +100 ms at 48 kHz: it sounds from 4800 to 100800.
  const tr = { clips: [{ at: 0, frames: 96000, layer: 0, nudge_ms: 100 }] };
  assert.equal(splitAt(tr, 2000, 48000), 0);
  assert.equal(splitAt(tr, 98000, 48000), 1);
  assert.equal(splitAt(tr, 100800, 48000), 0);
});

test('a slid clip on the grid lands on a line; off it, keeps its offset', () => {
  const grid = { frames: 548571, bars: 4 }; // a bar is 137142.857 frames
  // On bar 2, dragged most of a bar: bar 3.
  assert.equal(slideTo(grid, 137143, 120000, 'bar'), 274286);
  // A little: stays.
  assert.equal(slideTo(grid, 137143, 30000, 'bar'), 137143);
  // On beat 2 of bar 1, by a bar: beat 2 of bar 2, with the bar snap.
  assert.equal(slideTo(grid, 34286, 140000, 'bar'), 34286 + 137143);
  // 1000 frames late, by a bar: still 1000 frames late.
  assert.equal(slideTo(grid, 138143, 137000, 'bar'), 138143 + 137143);
  // Never before the start: an off-grid clip goes back whole steps only.
  assert.equal(slideTo(grid, 1000, -200000, 'bar'), 1000);
  assert.equal(slideTo(grid, 137143, -400000, 'bar'), 0);
  assert.equal(slideTo(grid, 5000, 12.6, 'off'), 5013);
  assert.equal(slideTo(null, 5000, -9000, 'bar'), 0);
});
