// web/static/lib/rooms/keeplabel.test.js
// Every KEEP names what it keeps (docs/superpowers/specs/2026-10-15-flow-design.md,
// "The Studio: one selection, two verbs"): KEEP 2m on the feed's key, KEEP 4
// BARS on the buffer's, KEEP 30s on the instrument's pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lengthWords, keepLabel, feedKeepLength, bufferKeepLength, selectionKeepLength, keptByK, keepAria } from './keeplabel.js';

test('a length reads short: seconds, then minutes', () => {
  assert.equal(lengthWords(30), '30s');
  assert.equal(lengthWords(59), '59s');
  assert.equal(lengthWords(60), '1m');
  assert.equal(lengthWords(120), '2m');
  assert.equal(lengthWords(420), '7m');
  assert.equal(lengthWords(900), '15m');
  assert.equal(lengthWords(90), '1m30s', 'a part-minute keeps its seconds');
  assert.equal(lengthWords(3.6), '3.6s', 'under ten seconds, a decimal');
  assert.equal(lengthWords(12.4), '12s');
  assert.equal(lengthWords(0), '');
  assert.equal(lengthWords(NaN), '');
});

test('a sliver reads "<1s", never "0.0s"', () => {
  assert.equal(lengthWords(0.04), '<1s');
  assert.equal(lengthWords(0.5), '<1s');
  assert.equal(lengthWords(0.99), '<1s');
  assert.equal(lengthWords(1), '1.0s');
  assert.equal(keepLabel(selectionKeepLength(0.04)), 'KEEP <1s');
});

test('round first, then format: 9.96 and 10 both read "10s", and so on up', () => {
  assert.equal(lengthWords(9.96), '10s');
  assert.equal(lengthWords(10), '10s');
  assert.equal(lengthWords(9.94), '9.9s');
  assert.equal(lengthWords(59.6), '1m', '59.6 s is a minute');
  assert.equal(lengthWords(119.6), '2m');
  assert.equal(lengthWords(60), '1m');
});

test('an hour or more reads in hours: 3600 is "1h", not "60m"', () => {
  assert.equal(lengthWords(3600), '1h');
  assert.equal(lengthWords(3599.6), '1h');
  assert.equal(lengthWords(3660), '1h1m');
  assert.equal(lengthWords(5400), '1h30m');
  assert.equal(lengthWords(3590), '59m50s');
});

test('the key is KEEP and what it keeps', () => {
  assert.equal(keepLabel('2m'), 'KEEP 2m');
  assert.equal(keepLabel('4 BARS'), 'KEEP 4 BARS');
  assert.equal(keepLabel(''), 'KEEP', 'nothing to name: the bare word');
  assert.equal(keepLabel(null), 'KEEP');
});

test('the feed keeps the last 30s, 2m, 7m, or all the ring when the length is 0', () => {
  assert.equal(feedKeepLength(30, 900), '30s');
  assert.equal(feedKeepLength(120, 900), '2m');
  assert.equal(feedKeepLength(0, 900), '15m', 'the whole ring is as long as the ring');
  assert.equal(feedKeepLength(0, 120), '2m');
  assert.equal(feedKeepLength(30, 0), '30s');
});

test('the buffer keeps its window: in bars with a tempo, else seconds', () => {
  const sampleRate = 48000;
  const barFrames = 96000; // 120 BPM
  assert.equal(bufferKeepLength({ frames: 4 * barFrames, barFrames, sampleRate }), '4 BARS');
  assert.equal(bufferKeepLength({ frames: barFrames, barFrames, sampleRate }), '1 BAR');
  assert.equal(bufferKeepLength({ frames: Math.round(3.5 * barFrames), barFrames, sampleRate }), '3.5 BARS');
  assert.equal(bufferKeepLength({ frames: Math.round(2.63 * barFrames), barFrames, sampleRate }), '2.63 BARS');
  assert.equal(bufferKeepLength({ frames: 4 * sampleRate, barFrames: 0, sampleRate }), '4.0s', 'no tempo: seconds');
  assert.equal(bufferKeepLength({ frames: 17 * sampleRate, sampleRate }), '17s');
  assert.equal(bufferKeepLength({ frames: 0, barFrames, sampleRate }), '');
});

test('a selection of the feed keeps its own length', () => {
  assert.equal(selectionKeepLength(41.2), '41s');
  assert.equal(selectionKeepLength(95), '1m35s');
  assert.equal(selectionKeepLength(7.84), '7.8s');
  assert.equal(selectionKeepLength(0), '');
});

test('K keeps the open buffer, else the feed: the pad names the one it will', () => {
  assert.equal(keptByK({ feed: '2m', buffer: '4 BARS' }), '4 BARS');
  assert.equal(keptByK({ feed: '2m', buffer: null }), '2m');
  assert.equal(keptByK({ feed: '', buffer: '' }), '');
  assert.equal(keptByK({}), '');
});

test('the feed key’s accessible name contains what is written on it', () => {
  // WCAG label in name: the visible words are KEEP and the length.
  assert.equal(keepAria('30s'), 'KEEP 30s — keep the last 30s');
  assert.equal(keepAria('2m'), 'KEEP 2m — keep the last 2m');
  assert.ok(keepAria('30s').toLowerCase().includes(keepLabel('30s').toLowerCase()));
  assert.equal(keepAria(''), 'KEEP', 'no length: the bare word');
});
