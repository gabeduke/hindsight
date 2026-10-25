// What the bar's display says beside where it is (display.js), and what its
// source key's menu offers (source-menu.js): the tempo, the source and where
// it plays, for the tape, a take and the feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeDisplay, takeDisplay, feedDisplay, tempoWords, OUT_WORDS } from './display.js';
import { recentTakes, sourceRows, RECENT } from './source-menu.js';

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

test('the source menu: the tape and the feed, the one playing checked, then the newest takes and the shelf', () => {
  const takes = [
    { name: 'jam_2026-10-24_100000.wav', duration_seconds: 65 },
    { name: 'jam_2026-10-24_120000.wav', duration_seconds: 8, label: 'Blue bridge' },
    { name: 'jam_2026-10-23_090000.wav', duration_seconds: 30 },
    { name: 'jam_2026-10-24_110000.wav', duration_seconds: 12 },
  ];
  const recent = recentTakes(takes);
  assert.equal(recent.length, RECENT);
  assert.deepEqual(recent.map((t) => t.name), ['jam_2026-10-24_120000.wav', 'jam_2026-10-24_110000.wav', 'jam_2026-10-24_100000.wav']);
  const r = sourceRows({ kind: 'take', takeName: 'jam_2026-10-24_110000.wav', tape: 'Song sketch', recent });
  assert.deepEqual(r.rows.map((x) => [x.id, x.checked, x.disabled]), [['tape', false, false], ['feed', false, false]]);
  assert.equal(r.rows[0].sub, 'Song sketch');
  assert.deepEqual(r.takes.map((x) => [x.word, x.sub, x.checked]), [['Blue bridge', '0:08', false], ['11:00:00', '0:12', true], ['10:00:00', '1:05', false]]);
  assert.deepEqual(r.shelf, { id: 'shelf', word: 'Go to the shelf', href: '/takes.html' });
  // No tape on the Pi: the tape can't be chosen, and says why.
  const bare = sourceRows({ kind: 'feed', tape: null, recent: [] });
  assert.deepEqual(bare.rows.map((x) => [x.id, x.checked, x.disabled]), [['tape', false, true], ['feed', true, false]]);
  assert.equal(bare.rows[0].sub, 'no tape is loaded');
  assert.deepEqual(bare.takes, []);
});
