import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { takeTitle, fmtLen } from './takename.js';

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime(); // Fri 16 Oct 2026

test('a take is its own name, or the time it was caught: what its spine prints', () => {
  assert.equal(takeTitle({ name: 'jam_2026-10-05_201512.wav', label: 'Verse' }), 'Verse');
  assert.equal(takeTitle({ name: 'jam_2026-10-05_201512.wav', label: '' }), '20:15:12');
  assert.equal(takeTitle({ name: 'jam_2026-10-05_201512.wav' }, { now: NOW }), '20:15:12', 'another day: the time, as the spine has it');
  assert.equal(takeTitle('jam_2026-10-05_201512.wav'), '20:15:12', 'a file’s name alone will do');
  assert.equal(takeTitle('jam_2026-10-05_201512.wav', { label: 'Verse' }), 'Verse');
  assert.equal(takeTitle({ name: 'phone_odd.wav' }), 'odd');
});

test('never the file or its date stamp, wherever it is named', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['../takes.js', '../trash.js', '../bar/take-source.js', '../shelf-detail.js', '../room/doorway.js', '../room/tap.js', '../room/deck.js', './bounce.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /replace\(\/\^jam_\|\\\.wav\$\/g?, ''\)/, `${f} makes a take's name from its file`);
    assert.doesNotMatch(src, /\b(spineTitle|stampOf)\(/, `${f} names a take by a helper that is gone`);
  }
});

test('in a toast, a take today is its time and its length; its own name wins, as on the spine', () => {
  const toast = (name, seconds, label = '', more = {}) => takeTitle(name, { seconds, label, day: true, now: NOW, ...more });
  assert.equal(toast('jam_2026-10-16_013101.wav', 30), '01:31:01 · 0:30');
  assert.equal(toast('jam_2026-10-16_013101.wav', 119), '01:31:01 · 1:59');
  assert.equal(toast('jam_2026-10-16_013101.wav', undefined), '01:31:01');
  assert.equal(toast('jam_2026-10-16_013101.wav', 0), '01:31:01');
  assert.equal(toast('jam_2026-10-16_013101.wav', 30, 'Verse idea'), 'Verse idea · 0:30');
});

test('where nothing says the day, a take from another day says it, so two at 21:04 are two', () => {
  const toast = (name) => takeTitle(name, { seconds: 30, day: true, now: NOW });
  assert.equal(toast('jam_2026-10-13_210412.wav'), 'Tue 13 Oct 21:04:12 · 0:30');
  assert.notEqual(toast('jam_2026-10-13_210412.wav'), toast('jam_2026-10-14_210412.wav'));
});

test('a cut or a bounce does not wear its source’s bare time; a phone take is not a .webm', () => {
  const src = takeTitle('jam_2026-10-16_013101.wav', { seconds: 30, now: NOW });
  assert.notEqual(takeTitle('jam_2026-10-16_013101.wav', { seconds: 30, kind: 'cut', now: NOW }), src);
  assert.equal(takeTitle('jam_2026-10-16_013101.wav', { seconds: 30, kind: 'bounce', now: NOW }), '01:31:01 (bounce) · 0:30');
  assert.equal(takeTitle('phone_2026-10-16_013101.webm', { seconds: 30, now: NOW }), 'Phone 01:31:01 · 0:30');
  assert.equal(takeTitle('phone_mic.webm', { seconds: 5 }), 'mic · 0:05');
});

test('a take with no name and no label is never " · 0:03"', () => {
  assert.equal(takeTitle('', { seconds: 3 }), 'a take · 0:03');
  assert.equal(takeTitle(undefined, { seconds: 3 }), 'a take · 0:03');
  assert.equal(takeTitle(null), 'a take');
});

test('lengths', () => {
  assert.equal(fmtLen(119), '1:59');
  assert.equal(fmtLen(59.6), '0:59', 'never 0:60, and never 0:00 for most of a minute');
  assert.equal(fmtLen(0), '0:00');
  assert.equal(fmtLen(NaN), '0:00');
});

test('the toasts of KEEP and of taking it back name the take, not its file, and carry its label', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['./studio.js', '../buffer/buffer.js', '../../app.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /toast\(`(Kept|Took back|Saved) \$\{(body\.)?name\}/, `${f}: a toast names a take by its file`);
    assert.match(src, /takeTitle\(/, `${f} names takes by takeTitle`);
  }
  assert.match(read('../buffer/buffer.js'), /untake\(k\.name, k\.label\)/, 'Took back carries the label');
  assert.match(read('./studio.js'), /takeTitle\(body, \{ seconds: body\.seconds, day: true \}\)/, 'Kept carries the label');
  assert.match(read('../../app.js'), /const nameOf = \(name, seconds\) => takeTitle\(name, \{ seconds, day: true \}\);/, 'Capture names a take as its spine does');
});
