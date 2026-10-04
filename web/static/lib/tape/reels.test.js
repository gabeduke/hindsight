import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRadii, ReelMotion, EASE_MS } from './reels.js';

const SR = 48000;
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('the tape moves from the left reel to the right, and none goes missing', () => {
  const L = 100 * SR;
  const start = packRadii(0, L), end = packRadii(L, L), mid = packRadii(L / 2, L);
  near(start.left, 64, 1e-9); near(start.right, 17, 1e-9);
  near(end.left, 17, 1e-9); near(end.right, 64, 1e-9);
  for (const r of [start, end, mid]) near(r.left ** 2 + r.right ** 2, 64 ** 2 + 17 ** 2, 1e-6);
  assert.deepEqual(packRadii(-5, L), start);
  assert.deepEqual(packRadii(2 * L, L), end);
  assert.deepEqual(packRadii(10, 0), start); // an empty tape has nothing to wind
});

test('between polls a playing tape runs on at its sample rate', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(SR, true, 1000);
  near(m.frame(1250).pos, SR + 0.25 * SR, 1);
  assert.equal(m.frame(1300).moving, 'play');
});

test('a late poll does not let the reels run away', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(SR, true, 1000);
  assert.ok(m.frame(1000 + 5000).pos <= SR + 0.5 * SR + 1);
});

test('a stopped tape stays put', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(10 * SR, false, 0);
  const a = m.frame(0), b = m.frame(2000);
  assert.equal(b.pos, 10 * SR);
  assert.equal(b.moving, 'stop');
  assert.equal(b.angleL, a.angleL);
});

test('playing turns the reels one way; a jump back spins them the other, then plays on', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(8 * SR, true, 0);
  const p0 = m.frame(0), p1 = m.frame(100);
  const playTurn = Math.sign(p1.angleL - p0.angleL);
  assert.notEqual(playTurn, 0);

  m.poll(0, true, 100); // the loop came round to bar 1
  const r = m.frame(200);
  assert.equal(r.moving, 'rewind');
  assert.equal(Math.sign(r.angleL - p1.angleL), -playTurn);
  assert.ok(r.pos < p1.pos && r.pos > 0, 'on its way back, not there in one jump');

  const after = m.frame(100 + EASE_MS + 50);
  assert.equal(after.moving, 'play');
  near(after.pos, (EASE_MS + 50) / 1000 * SR, SR * 0.02);
});

test('a jump forward winds', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(0, false, 0);
  m.frame(0);
  m.poll(60 * SR, false, 10);
  assert.equal(m.frame(100).moving, 'wind');
  assert.equal(m.frame(10 + EASE_MS + 1).pos, 60 * SR);
});

test('the tape never runs past its end', () => {
  const L = 10 * SR;
  const m = new ReelMotion({ sampleRate: SR, length: L });
  m.poll(L - 100, true, 0);
  assert.ok(m.frame(400).pos <= L);
});

test('with reduced motion the reels jump instead of spinning', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR, reduced: true });
  m.poll(8 * SR, false, 0);
  m.frame(0);
  m.poll(0, false, 10);
  const r = m.frame(20);
  assert.equal(r.pos, 0);
  assert.equal(r.moving, 'stop');
});

test('when the polls stop coming, the machine stops rather than run on forever', () => {
  const m = new ReelMotion({ sampleRate: SR, length: 600 * SR });
  m.poll(SR, true, 0);
  assert.equal(m.frame(500).moving, 'play');
  const late = m.frame(3000);
  assert.equal(late.moving, 'stop');
  assert.ok(late.pos <= SR + 0.5 * SR + 1);
});
