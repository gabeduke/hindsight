import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcile } from './held.js';

test('a release this page missed is put right from the Pi’s list, and a press too', () => {
  const r = reconcile({ tricks: ['echo', 'track2'], lit: ['stop', 'echo'] });
  assert.deepEqual(r, { on: ['track2'], off: ['stop'] });
});

test('what this hand plays, an at on its way, and what isn’t drawn are left alone', () => {
  const r = reconcile({
    tricks: ['filter', 'reverse', 'bend', 'crate.1'],
    lit: ['chop'],
    waiting: ['chop', 'reverse'],
    mine: (p) => p === 'filter',
    drawn: (p) => p !== 'crate.1',
  });
  assert.deepEqual(r, { on: ['bend'], off: [] });
});

test('no list from the Pi changes nothing', () => {
  assert.deepEqual(reconcile({ tricks: undefined, lit: ['stop'] }), { on: [], off: [] });
});
