// What the bar's display says beside where it is (display.js): its two
// keys, what plays (the source) and how (its tempo over where it plays, one
// key: the calm Studio's decision 5), for the tape, a take and the feed.
// What the source key's menu offers is the Transport's
// (source-menu.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeDisplay, takeDisplay, feedDisplay, tempoWords, tempoLabel, playsWords, OUT_WORDS, syncState } from './display.js';

const SR = 48000;
// 96 BPM: four bars of 4/4 are 10 s.
const tape = (over = {}) => ({
  name: 'Song sketch', sample_rate: SR,
  grid: { frames: 10 * SR, bars: 4 },
  loop: { in: 0, out: 10 * SR, on: true },
  ...over,
});

test('the tape: one key, its tempo over where it plays, the loop’s bars in the long form; TAPE and its name', () => {
  const d = tapeDisplay(tape(), 'jam');
  assert.deepEqual(d.tempo, { short: '96 BPM', long: '96 BPM · 4 BARS', leg: 'JAM ROOM', alone: '96' });
  assert.deepEqual(d.source, { short: 'TAPE', long: 'TAPE · Song sketch' });
  assert.equal(d.out, 'JAM ROOM', 'the phone’s player’s foot says where it plays too');
  assert.match(d.said.source, /Song sketch/, 'a screen reader hears the tape’s name');
  assert.match(d.said.tempo, /96 BPM, 4 bars/, 'and the tempo’s key says both: the tempo');
  assert.match(d.said.tempo, /plays in the jam room/i, 'and where it plays');
  assert.equal(tapeDisplay(tape(), 'phone').tempo.leg, 'PHONE');
  assert.equal(tapeDisplay(tape(), 'both').tempo.leg, 'BOTH');
  assert.equal(tapeDisplay(tape(), null).tempo.leg, 'JAM ROOM', 'before the Pi says, the jam room');
  assert.match(tapeDisplay(tape(), 'phone').said.out, /^Plays on a phone/);
  // The loop's bars, not the grid's, when the ruler has moved it.
  assert.equal(tapeDisplay(tape({ loop: { in: 0, out: 5 * SR, on: true } })).tempo.long, '96 BPM · 2 BARS');
  assert.equal(tapeDisplay(tape({ loop: { in: 0, out: 2.5 * SR, on: true } })).tempo.long, '96 BPM · 1 BAR');
});

test('the tape with no tempo yet: where it plays is the value, over OUT', () => {
  const none = tapeDisplay(tape({ grid: null }), 'both');
  assert.deepEqual(none.tempo, { short: 'BOTH', long: 'BOTH', leg: 'OUT', alone: '–' });
  assert.match(none.said.tempo, /no tempo yet/i);
  assert.match(none.said.tempo, /plays in the jam room and on a phone/i);
});

test('a take: its tempo, if it has one, over this device; its name', () => {
  const d = takeDisplay({ title: '20:53:17', bpm: 129.94 }, 'THIS TABLET');
  assert.deepEqual(d.tempo, { short: '129.9 BPM', long: '129.9 BPM', leg: 'THIS TABLET', alone: '129.9' });
  assert.deepEqual(d.source, { short: '20:53:17', long: 'TAKE · 20:53:17' });
  assert.equal(d.out, 'THIS TABLET');
  assert.match(d.said.tempo, /129\.9 BPM/);
  assert.match(d.said.tempo, /plays on this tablet/i);
  const none = takeDisplay({ title: 'Blue bridge', bpm: null }, 'THIS PHONE');
  assert.deepEqual(none.tempo, { short: 'THIS PHONE', long: 'THIS PHONE', leg: 'OUT', alone: '–' });
  assert.match(none.said.tempo, /no tempo/i);
});

test('the feed: FEED, and no tempo, so this device over OUT', () => {
  const d = feedDisplay('THIS COMPUTER');
  assert.deepEqual(d.source, { short: 'FEED', long: 'THE LIVE FEED' });
  assert.deepEqual(d.tempo, { short: 'THIS COMPUTER', long: 'THIS COMPUTER', leg: 'OUT', alone: '–' });
  assert.equal(d.out, 'THIS COMPUTER');
  assert.match(d.said.tempo, /plays on this computer/i);
});

test('where the tape plays, in words: the display’s to a screen reader, and the tempo’s panel’s last row', () => {
  assert.equal(playsWords('jam'), 'Plays in the jam room');
  assert.equal(playsWords('phone'), 'Plays on a phone');
  assert.equal(playsWords('both'), 'Plays in the jam room and on a phone');
  assert.equal(playsWords(null), 'Plays in the jam room', 'before the Pi says');
});

test('the tempo’s key says what a press on it does: the tempo’s panel in the Studio, the Output sheet anywhere else, nothing when it is off', () => {
  const d = tapeDisplay(tape(), 'jam');
  assert.equal(tempoLabel(d, 'tempo'), `${d.said.tempo}: change the tempo, or where it plays`);
  assert.equal(tempoLabel(d, 'output'), `${d.said.tempo}: choose where the tape plays`);
  assert.equal(tempoLabel(d, null), d.said.tempo);
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
