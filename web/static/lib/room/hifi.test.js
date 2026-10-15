import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vtName, HIFI_MODELS } from './hifi.js';
import { MODELS } from '../scene/models.js';

test('a View Transition name is a CSS identifier made from the take or the tape', () => {
  assert.equal(vtName('take:jam_2026-10-15_080128.wav'), 'take-jam_2026-10-15_080128-wav');
  assert.equal(vtName('tape:2026-10-15_tuesday-groove'), 'tape-2026-10-15_tuesday-groove');
  assert.match(vtName('take:a b/c:d'), /^take-[A-Za-z0-9_-]+$/);
});

// The deck and the flight are the room's, and the room is behind its flag:
// a page without the flag must not fetch them. So they are registered on
// the room's own scene, not in the scene's shared list every page loads.
test('only the room’s scene knows the deck and the flight', () => {
  assert.equal(typeof HIFI_MODELS.deck, 'function');
  assert.equal(typeof HIFI_MODELS.flight, 'function');
  for (const k of Object.keys(MODELS)) assert.equal(HIFI_MODELS[k], MODELS[k]);
  assert.equal(MODELS.deck, undefined);
  assert.equal(MODELS.flight, undefined);
  const shared = readFileSync(new URL('../scene/models.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/(flight|deck|choreo)\.js'/.test(shared), 'models.js imports none of them');
});
