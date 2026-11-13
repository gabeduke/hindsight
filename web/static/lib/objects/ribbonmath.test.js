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

test('the mark\'s key moves it a step, inside the ring and a second short of now', async () => {
  const { nudgedMark } = await import('./ribbonmath.js');
  const sr = 48000, total = 100 * sr, oldest = 40 * sr;
  assert.equal(nudgedMark(50 * sr, sr, oldest, total, sr), 51 * sr);
  assert.equal(nudgedMark(50 * sr, -sr, oldest, total, sr), 49 * sr);
  assert.equal(nudgedMark(40.5 * sr, -sr, oldest, total, sr), oldest, 'no older than the ring');
  assert.equal(nudgedMark(98.5 * sr, sr, oldest, total, sr), 99 * sr, 'a second short of now');
  // A tap just inside the right edge leaves a mark under a second from now:
  // → once sent it a second back.
  assert.equal(nudgedMark(99.5 * sr, sr, oldest, total, sr), 99.5 * sr, '→ never moves the mark back');
});
