import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftPct, ageAt, frameAt, ageOf, fmtAge } from './ribbonmath.js';

const A = 0.5, T = 900;

test('the axis puts the ring at 0% and the edge at 100%', () => {
  assert.equal(leftPct(T, A, T), 0);
  assert.equal(leftPct(A, A, T), 100);
  assert.equal(leftPct(0, A, T), 100); // younger than the edge is the edge
  assert.ok(leftPct(60, A, T) > leftPct(600, A, T));
});

test('a position and its age round-trip', () => {
  for (const age of [0.5, 1, 7.3, 60, 420, 899]) {
    assert.ok(Math.abs(ageAt(leftPct(age, A, T), A, T) - age) < 1e-6 * age, `age ${age}`);
  }
  assert.ok(Math.abs(ageAt(-5, A, T) - T) < 1e-9);  // clamped to the ring
  assert.ok(Math.abs(ageAt(120, A, T) - A) < 1e-12);
});

test('ages and absolute frames', () => {
  assert.equal(frameAt(2, 480000, 48000), 384000);
  assert.equal(frameAt(20, 480000, 48000), 0); // never before the first frame
  assert.equal(ageOf(384000, 480000, 48000), 2);
  assert.equal(ageOf(500000, 480000, 48000), 0);
});

test('ages read as m:ss, or h:mm:ss', () => {
  assert.equal(fmtAge(0), '0:00');
  assert.equal(fmtAge(92.4), '1:32');
  assert.equal(fmtAge(3725), '1:02:05');
});
