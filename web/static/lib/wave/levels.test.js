// web/static/lib/wave/levels.test.js
// Levels for the bars and the trace: the loudest moment of each slice, scaled
// to the take's own peak and lifted the way the design draws them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelsFor, takeGain, lift } from './draw.js';

// Two channels, eight buckets of min,max pairs.
const pd = {
  channels: 2,
  buckets: 8,
  data: [
    Float32Array.from([-0.1, 0.2, -0.05, 0.1, -0.6, 0.3, 0, 0, -0.2, 0.2, -0.1, 0.4, 0, 0.05, -0.01, 0.01]),
    Float32Array.from([-0.3, 0.1, 0, 0, 0, 0, -0.1, 0.1, -0.7, 0.2, 0, 0, 0, 0, 0, 0.02]),
  ],
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const same = (got, want) => { assert.equal(got.length, want.length); want.forEach((w, i) => near(got[i], w)); };

test('levelsFor takes the loudest moment of each slice across channels', () => {
  // A negative min outweighs the max (bucket 2's -0.6, bucket 4's -0.7).
  same(levelsFor(pd, 4), [0.3, 0.6, 0.7, 0.05]);
});

test('levelsFor can read one channel', () => {
  same(levelsFor(pd, 4, { channel: 1 }), [0.3, 0.1, 0.7, 0.02]);
});

test('levelsFor gives every slice a bucket when there are more slices than buckets', () => {
  const lv = levelsFor(pd, 16);
  assert.equal(lv.length, 16);
  for (const v of lv) assert.ok(v > 0);
});

test('levelsFor covers only the buckets asked for', () => {
  same(levelsFor(pd, 2, { b0: 4, b1: 8 }), [0.7, 0.05]);
});

test('levelsFor of no slices is empty', () => {
  assert.equal(levelsFor(pd, 0).length, 0);
});

test("takeGain scales the take's loudest peak to full, at most eight times", () => {
  const one = (v) => ({ channels: 1, buckets: 1, data: [Float32Array.from([-v, v])] });
  near(takeGain(one(0.5)), 2);
  near(takeGain(one(0.01)), 8);
  near(takeGain(one(1.2)), 1);
  near(takeGain(one(0)), 1);
});

test('lift scales, clamps and bends a level like the design', () => {
  near(lift(0.5, 2), 1);
  near(lift(0.25), 0.25 ** 0.85);
  near(lift(-0.1), 0);
});
