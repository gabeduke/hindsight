import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { takeTitle } from './takename.js';

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime(); // Fri 16 Oct 2026

test('a take today is its time and its length; its own name wins, as on the spine', () => {
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 30, '', { now: NOW }), '01:31:01 · 0:30');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 119, '', { now: NOW }), '01:31:01 · 1:59');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', undefined, '', { now: NOW }), '01:31:01');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 0, '', { now: NOW }), '01:31:01');
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 30, 'Verse idea', { now: NOW }), 'Verse idea · 0:30');
});

test('a take from another day says the day, so two at 21:04 are two', () => {
  assert.equal(takeTitle('jam_2026-10-13_210412.wav', 30, '', { now: NOW }), 'Tue 13 Oct 21:04:12 · 0:30');
  assert.notEqual(takeTitle('jam_2026-10-13_210412.wav', 30, '', { now: NOW }), takeTitle('jam_2026-10-14_210412.wav', 30, '', { now: NOW }));
});

test('a cut or a bounce does not wear its source’s bare time; a phone take is not a .webm', () => {
  const src = takeTitle('jam_2026-10-16_013101.wav', 30, '', { now: NOW });
  assert.notEqual(takeTitle('jam_2026-10-16_013101.wav', 30, '', { kind: 'cut', now: NOW }), src);
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', 30, '', { kind: 'bounce', now: NOW }), '01:31:01 (bounce) · 0:30');
  assert.equal(takeTitle('phone_2026-10-16_013101.webm', 30, '', { now: NOW }), 'Phone 01:31:01 · 0:30');
  assert.equal(takeTitle('phone_mic.webm', 5), 'mic · 0:05');
});

test('a take with no name and no label is never " · 0:03"', () => {
  assert.equal(takeTitle('', 3), 'a take · 0:03');
  assert.equal(takeTitle(undefined, 3), 'a take · 0:03');
  assert.equal(takeTitle(null), 'a take');
});

test('the toasts of KEEP and of taking it back name the take, not its file, and carry its label', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['./studio.js', '../buffer/buffer.js', '../../app.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /toast\(`(Kept|Took back|Saved) \$\{(body\.)?name\}/, `${f}: a toast names a take by its file`);
    assert.match(src, /takeTitle\(/, `${f} names takes by takeTitle`);
  }
  assert.match(read('../buffer/buffer.js'), /untake\(k\.name, k\.label\)/, 'Took back carries the label');
  assert.match(read('./studio.js'), /takeTitle\(body\.name, body\.seconds, body\.label\)/, 'Kept carries the label');
  assert.match(read('../../app.js'), /roomsOn\(\) \? takeTitle/, 'Capture names a take so only with the rooms on');
});
