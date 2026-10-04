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
