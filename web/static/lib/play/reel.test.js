import { test } from 'node:test';
import assert from 'node:assert/strict';

import { target, modeOf, BASE } from './reel.js';
import { spin } from '../objects/motion.js';

test('the reel follows the trick that is sounding, newest first', () => {
  assert.equal(modeOf([]), '');
  assert.equal(modeOf(['track2']), '', 'a track key doesn’t move the head');
  assert.equal(modeOf(['reverse', 'track1', 'chop']), 'chop');
  assert.equal(modeOf(['chop', 'reverse']), 'reverse');
});

test('REV runs backwards, ½× and 2× change speed, BREAK keeps turning', () => {
  assert.ok(target({ playing: true, mode: 'reverse' }).rate < 0);
  assert.equal(target({ playing: true, mode: 'half' }).rate, BASE / 2);
  assert.equal(target({ playing: true, mode: 'double' }).rate, BASE * 2);
  assert.equal(target({ playing: true, mode: 'break' }).rate, BASE);
  assert.equal(target({ playing: true }).rate, BASE);
  assert.equal(target({ playing: false }).rate, 0);
});

test('STOP winds down over the beat, with inertia', () => {
  // Stepped at 60 Hz from 1×: still turning a frame in, nearly still a beat in.
  const beatMs = 500;
  const t = target({ playing: true, mode: 'stop', beatMs });
  assert.equal(t.rate, 0);
  let s = { angle: 0, rate: BASE };
  s = spin(s.angle, s.rate, t.rate, t.inertia, 16);
  assert.ok(s.rate > BASE * 0.8, `one frame in: ${s.rate}`);
  for (let ms = 16; ms < beatMs; ms += 16) s = spin(s.angle, s.rate, t.rate, t.inertia, 16);
  assert.ok(s.rate < BASE * 0.1, `a beat in: ${s.rate}`);
  // A slower tempo winds down more slowly.
  const slow = target({ playing: true, mode: 'stop', beatMs: 1000 });
  assert.ok(slow.inertia > t.inertia);
});

test('CHOP rocks: forward a slice, back a slice', () => {
  const at = (now) => target({ playing: true, mode: 'chop', now, sliceMs: 125 }).rate;
  assert.ok(at(10) > 0);
  assert.ok(at(130) < 0);
  assert.ok(at(260) > 0);
});
