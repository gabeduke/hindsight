import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VuModel, vuAngle, VU_SWING } from './vu.js';

/** run steps a fresh needle toward `level` at `hz` for `ms`. */
function run(hz, ms, level = -6) {
  const m = new VuModel();
  const dt = 1000 / hz;
  for (let i = 0; i < Math.round((ms / 1000) * hz); i++) m.step({ level }, dt);
  return m.view;
}

test('the needle is where it would be at 20 Hz or 120 Hz', () => {
  // motion.js's promise, kept through the model: a phone dropping frames
  // mid-swing must not move the needle.
  for (const ms of [150, 300, 500]) {
    const at = [20, 40, 60, 120].map((hz) => run(hz, ms).angle);
    for (const a of at) assert.ok(Math.abs(a - at[0]) < 1e-9, `${ms} ms: ${a} != ${at[0]}`);
  }
});

test('a silent meter rests on its left stop and asks for nothing', () => {
  const m = new VuModel();
  assert.equal(m.step({}, 16), false);
  assert.deepEqual(m.view, { angle: -VU_SWING, velocity: 0, target: -VU_SWING });
});

test('it parks exactly on target once settled, and says so', () => {
  const m = new VuModel();
  let frames = 0;
  while (m.step({ level: -18 }, 16) && frames < 500) frames++;
  assert.ok(frames < 120, `${frames} frames`);
  assert.equal(m.view.angle, vuAngle(-18));
  assert.equal(m.view.velocity, 0);
  const v = m.view;
  assert.equal(m.step({ level: -18 }, 16), false);
  assert.equal(m.view, v, 'the same view, so the renderer has nothing to do');
});

test('reduced motion, dt = Infinity, lands at once', () => {
  const m = new VuModel();
  m.step({ level: -6 }, Infinity);
  assert.equal(m.view.angle, vuAngle(-6));
  assert.equal(m.step({ level: -6 }, Infinity), false);
});

test('the reference level moves 0 VU', () => {
  const a = new VuModel(), b = new VuModel();
  a.step({ level: -20, ref: -20 }, Infinity);
  b.step({ level: -18 }, Infinity);
  assert.equal(a.view.angle, b.view.angle);
});

test('a new level mid-swing keeps the needle\'s momentum', () => {
  const m = new VuModel();
  for (let i = 0; i < 6; i++) m.step({ level: -6 }, 16);
  const { velocity } = m.view;
  assert.ok(velocity > 0);
  m.step({ level: -40 }, 16);
  assert.ok(m.view.velocity < velocity && m.view.angle > -VU_SWING, 'slowing, not restarting');
});
