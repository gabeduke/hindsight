// web/static/lib/wave/levels.test.js
// Levels for the bars and the trace: the loudest moment of each slice, scaled
// to the take's own peak and lifted the way the design draws them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelsFor, takeGain, lift, smooth, barSegments, drawBars } from './draw.js';

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
  // Two slices per bucket: each bucket's level, twice.
  same(levelsFor(pd, 16), [0.3, 0.3, 0.1, 0.1, 0.6, 0.6, 0.1, 0.1, 0.7, 0.7, 0.4, 0.4, 0.05, 0.05, 0.02, 0.02]);
});

test('levelsFor reads a channel the take lacks as silence, and whole buckets only', () => {
  same(levelsFor(pd, 2, { channel: 5 }), [0, 0]);
  same(levelsFor(pd, 2, { b0: 3.5, b1: 8 }), levelsFor(pd, 2, { b0: 3, b1: 8 }));
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
  // Every channel and every bucket counts, not just the first.
  near(takeGain(pd), 1 / 0.7);
});

test('lift scales, clamps and bends a level like the design', () => {
  near(lift(0.5, 2), 1);
  near(lift(0.25), 0.25 ** 0.85);
  near(lift(-0.1), 0);
  near(lift(NaN), 0);
  near(lift(0.25, 1, 1), 0.25);
});

test('smooth weights each point twice its neighbours', () => {
  assert.deepEqual([...smooth([0, 4, 0])], [1, 2, 1]);
  assert.deepEqual([...smooth([2])], [2]);
});

test('barSegments puts one rounded bar per pitch, never thinner than a dot', () => {
  const segs = barSegments([0, 1, 0.25], { x0: 3, pitch: 4, cy: 10, half: 8 });
  assert.deepEqual(segs.map((s) => s.x), [3, 7, 11]);
  near(segs[0].y0, 9.4); near(segs[0].y1, 10.6);
  near(segs[1].y0, 2); near(segs[1].y1, 18);
  near(segs[2].y1 - 10, 0.25 ** 0.85 * 8);
});

test("barSegments scales by the take's gain", () => {
  const [s] = barSegments([0.25], { pitch: 4, cy: 10, half: 8, gain: 4 });
  near(s.y0, 2);
});

// A context that records what it is asked to do.
function recorder() {
  const calls = [];
  const ctx = { calls, lineCap: 'butt', lineWidth: 1, strokeStyle: '#000' };
  for (const m of ['beginPath', 'moveTo', 'lineTo'])
    ctx[m] = (...a) => calls.push([m, ...a]);
  ctx.stroke = () => calls.push(['stroke', ctx.strokeStyle, ctx.lineCap, ctx.lineWidth]);
  const stack = [];
  ctx.save = () => stack.push({ lineCap: ctx.lineCap, lineWidth: ctx.lineWidth, strokeStyle: ctx.strokeStyle });
  ctx.restore = () => Object.assign(ctx, stack.pop());
  return ctx;
}

test('drawBars strokes one path per colour run, with round caps', () => {
  const ctx = recorder();
  drawBars(ctx, [0.5, 0.5, 0.5, 0.5], { pitch: 4, cy: 10, half: 8, color: (i) => (i < 2 ? 'a' : 'b') });
  const strokes = ctx.calls.filter((c) => c[0] === 'stroke');
  assert.deepEqual(strokes, [['stroke', 'a', 'round', 2.2], ['stroke', 'b', 'round', 2.2]]);
  const moves = ctx.calls.filter((c) => c[0] === 'moveTo');
  const lines = ctx.calls.filter((c) => c[0] === 'lineTo');
  assert.deepEqual(moves.map((c) => c[1]), [0, 4, 8, 12]);
  const a = 0.5 ** 0.85 * 8;
  for (const c of moves) near(c[2], 10 - a);
  for (const c of lines) near(c[2], 10 + a);
});

test('drawBars hands the context back as it found it', () => {
  const ctx = recorder();
  drawBars(ctx, [0.5], { pitch: 4, cy: 10, half: 8, color: 'a' });
  assert.equal(ctx.lineCap, 'butt');
  assert.equal(ctx.lineWidth, 1);
  assert.equal(ctx.strokeStyle, '#000');
});
