import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slideAmount, bendAmount, SLIDE_PX, BEND_PX } from './fx.js';

test('a finger sliding up a held pad turns its amount up, end to end over SLIDE_PX', () => {
  assert.equal(slideAmount(0.5, -SLIDE_PX / 2), 1);
  assert.equal(slideAmount(0.5, SLIDE_PX / 4), 0.25);
  assert.equal(slideAmount(0.2, 9 * SLIDE_PX), 0, 'never below nothing');
  assert.equal(slideAmount(0.9, -9 * SLIDE_PX), 1, 'never past full');
});

test('the bend follows the drag either way, a full bend at BEND_PX', () => {
  assert.equal(bendAmount(BEND_PX), 1);
  assert.equal(bendAmount(-BEND_PX / 2), -0.5);
  assert.equal(bendAmount(5 * BEND_PX), 1);
  assert.equal(bendAmount(0), 0);
});
