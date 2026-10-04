import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vuAngle, vuScale, VU_SWING } from './vu.js';

const near = (a, b, eps = 0.2) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('0 VU sits where a VU meter puts it, two thirds of the way over', () => {
  near(vuAngle(-18), 17.8);
});

test('the needle stays on the scale, whatever arrives', () => {
  assert.equal(vuAngle(-38), -VU_SWING);
  assert.equal(vuAngle(-Infinity), -VU_SWING);
  assert.equal(vuAngle(NaN), -VU_SWING);
  assert.equal(vuAngle(0), VU_SWING);
  assert.equal(vuAngle(12), VU_SWING);
});

test('louder is always further right', () => {
  let last = -Infinity;
  for (let db = -40; db <= 0; db += 0.5) {
    const a = vuAngle(db);
    assert.ok(a >= last, `${db} dBFS went backwards`);
    last = a;
  }
});

test('the reference level moves 0 VU', () => {
  near(vuAngle(-20, -20), 17.8);
});

test('the scale names its marks, the red ones from 0 VU up', () => {
  const s = vuScale();
  assert.deepEqual(s.labels.map((l) => l.t), ['20', '10', '7', '5', '3', '0', '+3']);
  assert.deepEqual(s.labels.filter((l) => l.red).map((l) => l.t), ['0', '+3']);
  for (const k of ['arc', 'redArc', 'ticks', 'redTicks']) assert.match(s[k], /^M[\d.]+ [\d.]+/);
});
