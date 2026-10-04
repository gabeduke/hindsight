import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRange, xOf, frameAt, barLines, bpm, barBeat, fmtSecs, clipBuckets } from './geometry.js';

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
