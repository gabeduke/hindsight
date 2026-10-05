// web/static/lib/bar/reel-window.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFrac } from './reel-window.js';

test('a level bar is empty at −40 dBFS and full 3 dB over the reference', () => {
  assert.equal(levelFrac(-Infinity), 0);
  assert.equal(levelFrac(-60), 0);
  assert.equal(levelFrac(-40), 0);
  assert.equal(levelFrac(-7), 1);          // ref −10, +3
  assert.equal(levelFrac(0), 1);
  assert.ok(Math.abs(levelFrac(-23.5) - 0.5) < 1e-9);
  assert.equal(levelFrac(NaN), 0);
});
