// web/static/lib/bar/reel-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFrac, peakDbAt } from './reel-window.js';

test('a level bar is empty at −40 dBFS and full 3 dB over the reference', () => {
  assert.equal(levelFrac(-Infinity), 0);
  assert.equal(levelFrac(-60), 0);
  assert.equal(levelFrac(-40), 0);
  assert.equal(levelFrac(-7), 1);          // ref −10, +3
  assert.equal(levelFrac(0), 1);
  assert.ok(Math.abs(levelFrac(-23.5) - 0.5) < 1e-9);
  assert.equal(levelFrac(NaN), 0);
});

test('a take\'s level at a point: each channel\'s loudest edge in that bucket, in dBFS', () => {
  // Two buckets of min/max pairs per channel.
  const pd = { buckets: 2, channels: 2, data: [new Float32Array([-0.1, 0.1, -0.5, 0.25]), new Float32Array([0, 0, -1, 1])] };
  const [l0, r0] = peakDbAt(pd, 0.2);
  assert.ok(Math.abs(l0 - -20) < 1e-6);
  assert.equal(r0, -Infinity);
  const [l1, r1] = peakDbAt(pd, 0.99);
  assert.ok(Math.abs(l1 - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(Math.abs(r1 - 0) < 1e-6);
  // The end of the take reads the last bucket; a gain lifts it.
  assert.ok(Math.abs(peakDbAt(pd, 1)[0] - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(Math.abs(peakDbAt(pd, 0.2, 2)[0] - 20 * Math.log10(0.2)) < 1e-6);
});
