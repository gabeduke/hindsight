// web/static/lib/meter-phrase.test.js
// What the Capture key says it will catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierPhrase } from './meter.js';

test('tierPhrase says how much the Capture key catches', () => {
  assert.equal(tierPhrase(30, 900), 'the last 30 seconds');
  assert.equal(tierPhrase(60, 900), 'the last minute');
  assert.equal(tierPhrase(120, 900), 'the last 2 minutes');
  assert.equal(tierPhrase(90, 900), 'the last 1.5 minutes');
  assert.equal(tierPhrase(0, 900), 'the last 15 minutes');
  assert.equal(tierPhrase(0, 120), 'the last 2 minutes');
});
