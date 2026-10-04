import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRange, editView, barSpan, nearestBar, xOf, frameAt, barLines, bpm, barBeat, fmtSecs, clipBuckets, snapFrame, slideTo, splitAt, joinPartner, fitsDoubled, zoomView, panView, followView } from './geometry.js';

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

test('a pinch zooms about the frame under the fingers, within the tape', () => {
  const v = { from: 1000, to: 3000 };
  // Twice as close about 2000: that frame stays where it was on screen.
  assert.deepEqual(zoomView(v, 2000, 0.5, 100000, 10), { from: 1500, to: 2500 });
  // Anchored off-centre, the anchor keeps its fraction across the view.
  assert.deepEqual(zoomView(v, 1500, 2, 100000, 10), { from: 500, to: 4500 });
  // No closer than minSpan, no wider than the tape, never off either end.
  assert.deepEqual(zoomView(v, 2000, 0.001, 100000, 400), { from: 1800, to: 2200 });
  assert.deepEqual(zoomView(v, 2000, 1000, 100000, 10), { from: 0, to: 100000 });
  assert.deepEqual(zoomView({ from: 0, to: 2000 }, 0, 2, 100000, 10), { from: 0, to: 4000 });
});

test('a drag pans the view, and stops at the tape\'s ends', () => {
  const v = { from: 1000, to: 3000 };
  assert.deepEqual(panView(v, 500, 10000), { from: 1500, to: 3500 });
  assert.deepEqual(panView(v, -5000, 10000), { from: 0, to: 2000 });
  assert.deepEqual(panView(v, 50000, 10000), { from: 8000, to: 10000 });
});

test('the view pages to follow a playhead that leaves it', () => {
  const v = { from: 1000, to: 3000 };
  assert.equal(followView(v, 2000, 100000), v, 'in view: unchanged, the same object');
  assert.equal(followView(v, 3000, 100000), v);
  // Past the right edge: the playhead lands a tenth of the way in.
  assert.deepEqual(followView(v, 3001, 100000), { from: 2801, to: 4801 });
  // Before the left edge (a wrap, a locate): the same.
  assert.deepEqual(followView(v, 100, 100000), { from: 0, to: 2000 });
  // At the tape's end the view stops there.
  assert.deepEqual(followView(v, 99900, 100000), { from: 98000, to: 100000 });
});
