import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { takeTitle } from './takename.js';

test('a take is named as its spine names it: the time it was caught, or its name, and its length', () => {
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 30), '01:31:01 · 0:30');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 119), '01:31:01 · 1:59');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav'), '01:31:01', 'without a length, just the title');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 0), '01:31:01', 'a zero length is not shown');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 30, 'Verse idea'), 'Verse idea · 0:30', 'a given name wins');
  assert.equal(takeTitle('mix.wav', 60), 'mix · 1:00');
});

test('the toasts of KEEP and of taking it back name the take, not its file', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['./studio.js', '../buffer/buffer.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /toast\(`(Kept|Took back) \$\{(body\.)?name\}/, `${f}: a toast names a take by its file`);
    assert.match(src, /takeTitle\(/, `${f} names takes by takeTitle`);
  }
});
