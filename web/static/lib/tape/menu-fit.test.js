import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuShift } from './menu-fit.js';

// The ⋯ menu is right-aligned to its button, which is at a phone's left edge
// (and, with the rooms off, even nearer): its first item read "ame this
// tape…", 44 and 144 px short. A menu is moved back into the screen, with a
// margin, and left where it is when it fits.

test('a menu that fits stays where it is', () => {
  assert.equal(menuShift({ left: 20, right: 220 }, 390), 0);
  assert.equal(menuShift({ left: 8, right: 382 }, 390), 0, 'exactly at the margins');
});

test('a menu off the left edge moves right, to the margin', () => {
  assert.equal(menuShift({ left: -44, right: 156 }, 390), 52);
  assert.equal(menuShift({ left: -144, right: 56 }, 390), 152);
});

test('a menu off the right edge moves left, to the margin', () => {
  assert.equal(menuShift({ left: 250, right: 450 }, 390), -68);
});

test('a menu wider than the screen is lined up on its left edge, not cut at both', () => {
  assert.equal(menuShift({ left: -30, right: 380 }, 360), 38);
});
