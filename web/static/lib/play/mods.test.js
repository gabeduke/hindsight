import { test } from 'node:test';
import assert from 'node:assert/strict';

import { knobAngle, knobDrag, formulaOf, knobStep, KNOB_PX } from './mods.js';

test('a knob stands from -135° at nothing to 135° at full', () => {
  assert.equal(knobAngle(0), -135);
  assert.equal(knobAngle(0.5), 0);
  assert.equal(knobAngle(1), 135);
  assert.equal(knobAngle(4), 135);
});

test('a drag up turns a knob up, end to end over KNOB_PX', () => {
  assert.equal(knobDrag(0, -KNOB_PX), 1);
  assert.equal(knobDrag(0.5, KNOB_PX / 2), 0);
  assert.equal(knobDrag(0.3, 0), 0.3);
});

test('a tape with no style is clean; a knob moved off a formula reads custom', () => {
  assert.equal(formulaOf(null), 'clean');
  assert.equal(formulaOf({ formula: 'worn', wow: 0.5 }), 'worn');
  assert.equal(formulaOf({ formula: 'custom' }), 'custom');
});

test('the keys step a knob: arrows, ⇧ finer, page keys coarser, Home and End', () => {
  assert.deepEqual(knobStep('ArrowUp'), { by: 0.05 });
  assert.deepEqual(knobStep('ArrowLeft', true), { by: -0.01 });
  assert.deepEqual(knobStep('PageDown'), { by: -0.25 });
  assert.deepEqual(knobStep('End'), { to: 1 });
  assert.equal(knobStep('KeyT'), null, 'a pad’s key isn’t a knob’s');
});
