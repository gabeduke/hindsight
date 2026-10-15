import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outIcon, OUT_MODES } from './icons.js';

test('each place has its own picture: a speaker, headphones, or both', () => {
  assert.match(outIcon('jam'), /M3 9\.5/);
  assert.doesNotMatch(outIcon('jam'), /a8 8/);
  assert.match(outIcon('phone'), /a8 8/);
  assert.doesNotMatch(outIcon('phone'), /M3 9\.5/);
  assert.match(outIcon('both'), /M3 9\.5/);
  assert.match(outIcon('both'), /a8 8/);
  assert.match(outIcon('both'), /width="38"/);
  assert.equal(outIcon('anything'), outIcon('jam'));
});

test('every place the tape plays has a picture of its own', () => {
  const pictures = OUT_MODES.map(outIcon);
  assert.equal(new Set(pictures).size, OUT_MODES.length);
  // Line art in the key's own ink, and hidden from a screen reader: the
  // button says the place's name.
  for (const p of pictures) {
    assert.match(p, /stroke="currentColor"/);
    assert.match(p, /aria-hidden="true"/);
  }
});
