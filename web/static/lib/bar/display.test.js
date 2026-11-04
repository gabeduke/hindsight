// What the bar's display says beside where it is (display.js): the tempo,
// the source and where it plays, for the tape, a take and the feed. What the
// source key's menu offers is the Transport's (source-menu.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeDisplay, takeDisplay, feedDisplay, tempoWords, OUT_WORDS, syncState } from './display.js';

const SR = 48000;
// 96 BPM: four bars of 4/4 are 10 s.
const tape = (over = {}) => ({
  name: 'Song sketch', sample_rate: SR,
  grid: { frames: 10 * SR, bars: 4 },
  loop: { in: 0, out: 10 * SR, on: true },
  ...over,
});

test('the tape: its tempo and its loop’s bars, TAPE and its name, and where it plays', () => {
  const d = tapeDisplay(tape(), 'jam');
  assert.deepEqual(d.tempo, { short: '96', long: '96 BPM · 4 BARS' });
  assert.deepEqual(d.source, { short: 'TAPE', long: 'TAPE · Song sketch' });
  assert.equal(d.out, 'JAM ROOM');
  assert.match(d.said.source, /Song sketch/, 'a screen reader hears the tape’s name');
  assert.equal(tapeDisplay(tape(), 'phone').out, 'PHONE');
  assert.equal(tapeDisplay(tape(), 'both').out, 'BOTH');
  assert.equal(tapeDisplay(tape(), null).out, 'JAM ROOM', 'before the Pi says, the jam room');
  // The loop's bars, not the grid's, when the ruler has moved it.
  assert.equal(tapeDisplay(tape({ loop: { in: 0, out: 5 * SR, on: true } })).tempo.long, '96 BPM · 2 BARS');
  assert.equal(tapeDisplay(tape({ loop: { in: 0, out: 2.5 * SR, on: true } })).tempo.long, '96 BPM · 1 BAR');
  // No tempo yet.
  const none = tapeDisplay(tape({ grid: null }));
  assert.deepEqual(none.tempo, { short: '–', long: 'NO TEMPO' });
  assert.match(none.said.tempo, /no tempo yet/);
});

test('a take: its tempo, if it has one, its name, and this device', () => {
  const d = takeDisplay({ title: '20:53:17', bpm: 129.94 }, 'THIS TABLET');
  assert.deepEqual(d.tempo, { short: '129.9', long: '129.9 BPM' });
  assert.deepEqual(d.source, { short: '20:53:17', long: 'TAKE · 20:53:17' });
  assert.equal(d.out, 'THIS TABLET');
  assert.equal(takeDisplay({ title: 'Blue bridge', bpm: null }, 'THIS PHONE').tempo.short, '–');
});

test('the feed: FEED, here, and no tempo', () => {
  const d = feedDisplay('THIS COMPUTER');
  assert.deepEqual(d.source, { short: 'FEED', long: 'THE LIVE FEED' });
  assert.equal(d.out, 'THIS COMPUTER');
  assert.equal(d.tempo.short, '–');
});

test('a tempo is a whole number when it is one, else to a tenth', () => {
  assert.equal(tempoWords(96), '96');
  assert.equal(tempoWords(95.98), '96');
  assert.equal(tempoWords(129.94), '129.9');
  assert.equal(tempoWords(0), '');
  assert.equal(tempoWords(null), '');
  assert.deepEqual(Object.keys(OUT_WORDS), ['jam', 'phone', 'both']);
});

test('SYNC, the tape’s annunciator: lit while the tape plays in the jam room, by how it lines up; out when there is nothing to line up', () => {
  assert.equal(syncState('exact').state, 'ok');
  assert.equal(syncState('locked').state, 'ok');
  assert.equal(syncState('estimated').state, 'wait');
  assert.equal(syncState('none').state, 'bad', 'playing, not lined up yet');
  assert.equal(syncState('none', { idle: true }).state, 'off', 'stopped: no alarm in a quiet room');
  assert.equal(syncState('exact', { phoneOut: true }).state, 'off', 'on a phone there is nothing to line up');
  for (const l of ['exact', 'estimated', 'none']) assert.ok(syncState(l).words, 'it says it in words, for a screen reader and help mode');
});
