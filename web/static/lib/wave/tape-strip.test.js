// web/static/lib/wave/tape-strip.test.js
// The trace on tape: a smoothed line along the envelope over brown oxide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceLines, grainXs, paintOxide, drawTrace, oxideColors, sliceLines } from './tape-strip.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('traceLines scales by the gain, smooths, and centres each point on its slot', () => {
  const { x, upper, lower } = traceLines([1, 1], [0.5, 0.5], { cy: 20, half: 10 });
  assert.deepEqual([...x], [0.5, 1.5]);
  assert.deepEqual([...upper], [10, 10]);
  // The trace is drawn linear, as the boards draw it: no 0.85 lift.
  near(lower[0], 25);
});

test('traceLines spreads fewer points than pixels with x0 and dx', () => {
  const { x } = traceLines([0.5, 0.5, 0.5], [0.5, 0.5, 0.5], { cy: 0, half: 1, x0: 10, dx: 4 });
  assert.deepEqual([...x], [12, 16, 20]);
});

test('traceLines reads a gap in the data as silence, not a bridge', () => {
  const { upper } = traceLines([0.5, NaN, 0.5], [0, 0, 0], { cy: 10, half: 10 });
  for (const y of upper) assert.ok(Number.isFinite(y));
});

test('grainXs puts a grain line every five pixels', () => {
  assert.deepEqual(grainXs(12), [0, 5, 10]);
});

// A context that records what it is asked to do, gradients included.
function recorder({ scale = 1 } = {}) {
  const calls = [];
  const grads = [];
  const ctx = { calls, grads, shadowBlur: 0, shadowColor: 'transparent', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1 };
  ctx.getTransform = () => ({ a: scale, b: 0, c: 0, d: scale });
  ctx.createLinearGradient = (...a) => { const g = { a, stops: [], addColorStop: (o, c) => g.stops.push([o, c]) }; grads.push(g); return g; };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fillRect'])
    ctx[m] = (...a) => calls.push([m, ...a]);
  ctx.fill = () => calls.push(['fill', ctx.globalAlpha, ctx.shadowBlur]);
  ctx.stroke = () => calls.push(['stroke', ctx.shadowColor, ctx.shadowBlur]);
  const stack = [];
  const KEYS = ['shadowBlur', 'shadowColor', 'globalAlpha', 'fillStyle', 'strokeStyle', 'lineWidth'];
  ctx.save = () => { calls.push(['save']); stack.push(Object.fromEntries(KEYS.map((k) => [k, ctx[k]]))); };
  ctx.restore = () => { calls.push(['restore']); Object.assign(ctx, stack.pop()); };
  return ctx;
}

const COLORS = { edge: 'E', lo: 'L', mid: 'M', sheen: 'rgba(255,236,210,.12)', shade: 'rgba(0,0,0,.18)', grain: 'G' };

test('paintOxide lays the base, the sheen, the shade and the grain', () => {
  const ctx = recorder();
  paintOxide(ctx, 12, 40, COLORS);
  assert.deepEqual(ctx.grads[0].stops, [[0, 'E'], [0.14, 'L'], [0.5, 'M'], [0.86, 'L'], [1, 'E']]);
  // The sheen and the shade fade to their own colour at no alpha, not to black.
  assert.deepEqual(ctx.grads[1].stops, [[0, COLORS.sheen], [0.3, 'rgba(255,236,210,0)']]);
  assert.deepEqual(ctx.grads[2].stops, [[0.7, 'rgba(0,0,0,0)'], [1, COLORS.shade]]);
  const grain = ctx.calls.filter((c) => c[0] === 'fillRect' && c[3] === 1);
  assert.deepEqual(grain.map((c) => c[1]), grainXs(12));
});

test('paintOxide hands the context back as it found it', () => {
  const ctx = recorder();
  paintOxide(ctx, 12, 40, COLORS);
  assert.equal(ctx.fillStyle, '#000');
});

test('oxideColors reads the tape tokens', () => {
  const seen = [];
  const c = oxideColors((name) => { seen.push(name); return name + '!'; });
  assert.equal(c.mid, '--oxide!');
  assert.deepEqual(seen.sort(), ['--oxide', '--oxide-edge', '--oxide-grain', '--oxide-lo', '--oxide-shade', '--oxide-sheen']);
});

test('drawTrace fills the envelope once, faint, then strokes both edges', () => {
  const ctx = recorder();
  drawTrace(ctx, [0.5, 0.5, 0.5], [0.25, 0.25, 0.25], { cy: 10, half: 8, line: '#fff' });
  const fills = ctx.calls.filter((c) => c[0] === 'fill');
  assert.equal(fills.length, 1);
  near(fills[0][1], 0.07);
  assert.equal(fills[0][2], 0); // no glow on the fill
  assert.equal(ctx.calls.filter((c) => c[0] === 'stroke').length, 1);
  // The fill runs out along the top edge and back along the bottom one.
  const fillPath = ctx.calls.slice(0, ctx.calls.findIndex((c) => c[0] === 'fill'));
  const ys = fillPath.filter((c) => c[0] === 'lineTo').map((c) => c[2]);
  near(ys[0], 6);
  near(ys.at(-1), 12);
});

test('drawTrace strokes once per glow, each blur in device pixels', () => {
  const ctx = recorder({ scale: 3 });
  drawTrace(ctx, [1], [1], { cy: 10, half: 8, line: '#fff', glow: [{ color: 'a', blur: 2 }, { color: 'b', blur: 8 }] });
  const strokes = ctx.calls.filter((c) => c[0] === 'stroke');
  assert.deepEqual(strokes, [['stroke', 'a', 6], ['stroke', 'b', 24]]);
  assert.equal(ctx.calls.filter((c) => c[0] === 'fill').length, 1);
});

test('drawTrace leaves the context as it found it', () => {
  const ctx = recorder();
  ctx.globalAlpha = 0.55;
  drawTrace(ctx, [1], [1], { cy: 10, half: 8, line: '#fff', glow: [{ color: 'gold', blur: 6 }] });
  assert.equal(ctx.shadowBlur, 0);
  assert.equal(ctx.shadowColor, 'transparent');
  assert.equal(ctx.globalAlpha, 0.55);
  // The caller's alpha carries through to the fill.
  near(ctx.calls.find((c) => c[0] === 'fill')[1], 0.55 * 0.07);
});

test('drawTrace draws as many points as both edges have', () => {
  const ctx = recorder();
  drawTrace(ctx, [0.5, 0.5, 0.5], [0.5], { cy: 10, half: 8, line: '#fff' });
  assert.equal(ctx.calls.filter((c) => c[0] === 'stroke').length, 1);
});

test('drawTrace draws lines it is handed, without working them out again', () => {
  const ctx = recorder();
  const lines = { x: Float32Array.from([7, 8]), upper: Float32Array.from([1, 2]), lower: Float32Array.from([3, 4]) };
  drawTrace(ctx, null, null, { cy: 10, half: 8, line: '#fff', lines });
  const moves = ctx.calls.filter((c) => c[0] === 'moveTo').map((c) => c.slice(1));
  assert.deepEqual(moves.slice(1), [[7, 1], [7, 3]]);
});

test('sliceLines keeps the points up to an x, for the part played', () => {
  const lines = traceLines([0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], { cy: 10, half: 8 });
  const cut = sliceLines(lines, 2);
  assert.deepEqual([...cut.x], [0.5, 1.5, 2.5]);
  assert.equal(cut.upper.length, 3);
});
