import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greaseStroke } from './grease.js';

test('a grease mark runs the whole height, close to its line', () => {
  const pts = greaseStroke(100, 20, 220, 48000);
  assert.deepEqual(pts[0][1], 20);
  assert.deepEqual(pts[pts.length - 1][1], 220);
  for (const [x, y] of pts) {
    assert.ok(Math.abs(x - 100) <= 1.5, `x ${x} wanders too far`);
    assert.ok(y >= 20 && y <= 220);
  }
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][1] > pts[i - 1][1], 'top to bottom');
});

test('the same mark draws the same way every frame, and marks differ', () => {
  assert.deepEqual(greaseStroke(50, 0, 100, 7), greaseStroke(50, 0, 100, 7));
  assert.notDeepEqual(greaseStroke(50, 0, 100, 7).map((p) => p[0]), greaseStroke(50, 0, 100, 8).map((p) => p[0]));
});

test('it moves with its line, wobble and all', () => {
  const a = greaseStroke(50, 0, 100, 7), b = greaseStroke(80, 0, 100, 7);
  a.forEach((p, i) => assert.ok(Math.abs(b[i][0] - p[0] - 30) < 1e-9));
});

test('nothing to draw is one point, not an error', () => {
  assert.deepEqual(greaseStroke(10, 50, 50, 1).length, 1);
  assert.deepEqual(greaseStroke(10, 60, 50, 1).length, 1);
});

// labelPlaces: where IN and OUT are written beside their marks.
import { labelPlaces } from './grease.js';

const overlap = (a, aw, b, bw) => a.y === b.y && a.x < b.x + bw && b.x < a.x + aw;

test('a wide selection holds its labels inside', () => {
  const p = labelPlaces(100, 300, 20, 36, 600);
  assert.deepEqual(p.in, { x: 107, y: 0 });
  assert.deepEqual(p.out, { x: 300 - 7 - 36, y: 0 });
});

test('a narrow one puts them outside, either side', () => {
  const p = labelPlaces(200, 220, 20, 36, 600);
  assert.deepEqual(p.in, { x: 200 - 7 - 20, y: 0 });
  assert.deepEqual(p.out, { x: 227, y: 0 });
});

test('at the take\'s end both go left, one above the other, never over each other or a mark', () => {
  const W = 372, p = labelPlaces(347, 356, 20, 36, W);
  for (const l of [p.in, p.out]) assert.ok(l.x >= 2 && l.x <= W - 2);
  assert.ok(!overlap(p.in, 20, p.out, 36));
  assert.ok(p.in.x + 20 <= 347 && p.out.x + 36 <= 347, 'left of the IN mark');
});

test('at the take\'s start both go right', () => {
  const p = labelPlaces(1, 12, 20, 36, 372);
  assert.ok(p.in.x >= 12 && p.out.x >= 12);
  assert.ok(!overlap(p.in, 20, p.out, 36));
});

test('an edge off the canvas has no label', () => {
  assert.equal(labelPlaces(-50, 100, 20, 36, 600).in, null);
  assert.equal(labelPlaces(100, 700, 20, 36, 600).out, null);
});

// drawGrease: the marks and their words, as the take page draws them.
import { drawGrease } from './grease.js';

/** A 2d context that writes down what it is asked to do; text is 10 px a letter. */
function recorder() {
  const calls = [];
  return new Proxy({}, {
    get(_, k) {
      if (k === 'calls') return calls;
      if (k === 'measureText') return (s) => ({ width: 10 * s.length });
      return (...a) => calls.push([k, ...a]);
    },
    set(_, k, v) { calls.push([`${String(k)}=`, v]); return true; },
  });
}
const opts = { W: 600, markTop: 18, markBottom: 198, labelTop: 42, ink: '#f0c419', halo: '#0a0a0b', font: 'system-ui' };

test('drawGrease strokes both marks in pencil, then writes IN and OUT over a halo', () => {
  const ctx = recorder();
  drawGrease(ctx, { ...opts, sx0: 100, sx1: 300, start: 4800, end: 24000 });
  const c = ctx.calls;
  assert.deepEqual(c[0], ['save']);
  assert.deepEqual(c.at(-1), ['restore']);
  assert.equal(c.filter(([k]) => k === 'stroke').length, 2);
  // Each mark is the stroke greaseStroke gives for its frame.
  const moves = c.filter(([k]) => k === 'moveTo');
  assert.deepEqual(moves[0].slice(1), greaseStroke(100, 18, 198, 4800)[0]);
  assert.deepEqual(moves[1].slice(1), greaseStroke(300, 18, 198, 24000)[0]);
  // The words: in marker, the window's colour behind them, the pencil's over.
  assert.ok(c.some(([k, v]) => k === 'font=' && v === '18px "Permanent Marker", system-ui'));
  assert.ok(c.some(([k, v]) => k === 'strokeStyle=' && v === '#0a0a0b'));
  const words = c.filter(([k]) => k === 'fillText').map(([, t, x, y]) => [t, x, y]);
  // A 200 px selection holds both, inside it (labelPlaces).
  assert.deepEqual(words, [['IN', 107, 42], ['OUT', 300 - 7 - 30, 42]]);
  assert.equal(c.filter(([k]) => k === 'strokeText').length, 2);
});

test('a mark off the canvas is neither drawn nor named', () => {
  const ctx = recorder();
  drawGrease(ctx, { ...opts, sx0: -50, sx1: 300, start: 0, end: 24000 });
  assert.equal(ctx.calls.filter(([k]) => k === 'stroke').length, 1);
  assert.deepEqual(ctx.calls.filter(([k]) => k === 'fillText').map(([, t]) => t), ['OUT']);
});
