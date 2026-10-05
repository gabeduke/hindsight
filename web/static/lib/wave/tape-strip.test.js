// web/static/lib/wave/tape-strip.test.js
// The trace on tape: a smoothed line along the envelope over brown oxide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smooth, traceLines, grainXs, paintOxide, drawTrace, oxideColors } from './tape-strip.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('smooth weights each point twice its neighbours', () => {
  assert.deepEqual([...smooth([0, 4, 0])], [1, 2, 1]);
  assert.deepEqual([...smooth([2])], [2]);
});

test('traceLines lifts, smooths and centres each point on its pixel', () => {
  const { upper, lower } = traceLines([1, 1], [0.5, 0.5], { cy: 20, half: 10 });
  assert.deepEqual(upper, [[0.5, 10], [1.5, 10]]);
  near(lower[0][1], 20 + 0.5 ** 0.85 * 10);
  assert.equal(lower[1][0], 1.5);
});

test('grainXs puts a grain line every five pixels', () => {
  assert.deepEqual(grainXs(12), [0, 5, 10]);
});

// A context that records what it is asked to do, gradients included.
function recorder() {
  const calls = [];
  const grads = [];
  const ctx = { calls, grads, shadowBlur: 0, shadowColor: 'transparent', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
  ctx.createLinearGradient = (...a) => { const g = { a, stops: [], addColorStop: (o, c) => g.stops.push([o, c]) }; grads.push(g); return g; };
  for (const m of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'save', 'restore'])
    ctx[m] = (...a) => calls.push([m, ...a]);
  // save/restore keep the state that drawTrace changes.
  const stack = [];
  ctx.save = () => { calls.push(['save']); stack.push({ shadowBlur: ctx.shadowBlur, shadowColor: ctx.shadowColor, globalAlpha: ctx.globalAlpha }); };
  ctx.restore = () => { calls.push(['restore']); Object.assign(ctx, stack.pop()); };
  return ctx;
}

const COLORS = { edge: 'E', lo: 'L', mid: 'M', sheen: 'S', shade: 'D', grain: 'G' };

test('paintOxide lays the base, the sheen, the shade and the grain', () => {
  const ctx = recorder();
  paintOxide(ctx, 12, 40, COLORS);
  assert.deepEqual(ctx.grads[0].stops, [[0, 'E'], [0.14, 'L'], [0.5, 'M'], [0.86, 'L'], [1, 'E']]);
  assert.equal(ctx.grads.length, 3);
  assert.deepEqual(ctx.grads[1].stops[0], [0, 'S']);
  assert.deepEqual(ctx.grads[2].stops.at(-1), [1, 'D']);
  const grain = ctx.calls.filter((c) => c[0] === 'fillRect' && c[3] === 1);
  assert.equal(grain.length, grainXs(12).length);
});

test('oxideColors reads the tape tokens', () => {
  const seen = [];
  const c = oxideColors((name, fb) => { seen.push(name); return name + '!' + (fb ? '' : ''); });
  assert.equal(c.mid, '--oxide!');
  assert.deepEqual(seen.sort(), ['--oxide', '--oxide-edge', '--oxide-grain', '--oxide-lo', '--oxide-shade', '--oxide-sheen']);
});

test('drawTrace fills the envelope once and strokes both lines in one path', () => {
  const ctx = recorder();
  drawTrace(ctx, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], { cy: 10, half: 8, line: '#fff' });
  assert.equal(ctx.calls.filter((c) => c[0] === 'fill').length, 1);
  assert.equal(ctx.calls.filter((c) => c[0] === 'stroke').length, 1);
  // Two polylines: two moveTo in the stroked path, after the fill's own.
  assert.equal(ctx.calls.filter((c) => c[0] === 'moveTo').length, 3);
  assert.equal(ctx.shadowBlur, 0);
});

test('drawTrace glows only when asked, and leaves the context as it found it', () => {
  const ctx = recorder();
  let blurAtStroke = null;
  const stroke = ctx.stroke;
  ctx.stroke = () => { blurAtStroke = ctx.shadowBlur; stroke(); };
  drawTrace(ctx, [1], [1], { cy: 10, half: 8, line: '#fff', glow: 'gold', blur: 6 });
  assert.equal(blurAtStroke, 6);
  assert.equal(ctx.shadowBlur, 0);
  assert.equal(ctx.shadowColor, 'transparent');
});
