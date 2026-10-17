import test from 'node:test';
import assert from 'node:assert/strict';
import { FADE_SHAPES, fadeCurve, fadeOptions, fadeOption, gainText } from './curves.js';

test('FADE_SHAPES lists supported curve profiles', () => {
  assert.deepEqual(FADE_SHAPES.map((s) => s.id), ['', 'linear', 's', 'exp']);
  assert.equal(FADE_SHAPES[0].label, 'Equal power');
});

test('fadeCurve evaluates endpoints and monotonicity', () => {
  for (const { id } of FADE_SHAPES) {
    assert.equal(fadeCurve(id, 0), 0, `${id} starts at 0`);
    assert.ok(Math.abs(fadeCurve(id, 1) - 1) < 1e-6, `${id} ends at 1`);
    assert.ok(fadeCurve(id, 0.25) < fadeCurve(id, 0.75), `${id} is strictly monotonic`);
  }
  // Linear checks
  assert.equal(fadeCurve('linear', 0.5), 0.5);
  // Equal power at mid-point is sqrt(0.5) ~ 0.707
  assert.ok(Math.abs(fadeCurve('', 0.5) - Math.sin(Math.PI / 4)) < 1e-6);
});

test('gainText formats decibels with correct sign and precision', () => {
  assert.equal(gainText(0), '0 dB');
  assert.equal(gainText(null), '0 dB');
  assert.equal(gainText(3.2), '+3.2 dB');
  assert.equal(gainText(-1.5), '−1.5 dB');
  assert.equal(gainText(-0.01), '−0.0 dB');
});

test('fadeOptions computes frame counts for sample rate and tempo', () => {
  const opts = fadeOptions({ frames: 96000, bars: 1 }, 48000);
  assert.equal(opts.find((o) => o.id === 'off').frames, 0);
  assert.equal(opts.find((o) => o.id === '10ms').frames, 480);
  assert.equal(opts.find((o) => o.id === 'bar').frames, 96000);
  assert.equal(opts.find((o) => o.id === 'beat').frames, 24000);

  // Without tempo grid
  const noTempo = fadeOptions(null, 48000);
  assert.equal(noTempo.find((o) => o.id === '10ms').frames, 480);
  assert.equal(noTempo.find((o) => o.id === 'bar').frames, null);
});

test('fadeOption matches existing frame lengths within 1 frame tolerance', () => {
  const grid = { frames: 96000, bars: 1 };
  assert.equal(fadeOption(480, grid, 48000)?.id, '10ms');
  assert.equal(fadeOption(481, grid, 48000)?.id, '10ms');
  assert.equal(fadeOption(9999, grid, 48000), null);
});
