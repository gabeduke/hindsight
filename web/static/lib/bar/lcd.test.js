// web/static/lib/bar/lcd.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeCounter, tapeMarquee, takeCounter, takeMarquee } from './lcd.js';

const SR = 48000;
// 96 BPM, 4/4: a bar is 2.5 s. Sixteen bars on the grid, the loop bars 5–8.
const BAR = 2.5 * SR;
const tape = (over = {}) => ({
  id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR,
  grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 4 * BAR, out: 8 * BAR, on: true }, ...over,
});
const live = (over = {}) => ({ playing: false, heard: 0, out: 0, delivered: 0, count_in: 0, output: 'demo', output_mode: 'jam', ...over });

test('a stopped tape reads bar.beat large and the time small', () => {
  // 13.2 s is bar 6, beat 2 (a beat is 0.625 s).
  const c = tapeCounter(tape(), live({ heard: Math.round(13.2 * SR) }), null);
  assert.equal(c.big, '6.2');
  assert.equal(c.small, '0:13.2');
  assert.equal(c.status, 'stop');
  assert.equal(c.unit, 'BAR');
});

test('playing, recording and armed each have their status', () => {
  assert.equal(tapeCounter(tape(), live({ playing: true }), null).status, 'play');
  assert.equal(tapeCounter(tape(), live({ playing: true, record: { tape: 't1', track: 4, state: 'on' } }), null).status, 'rec');
  assert.equal(tapeCounter(tape(), live({ record: { tape: 't1', track: 4, state: 'armed' } }), null).status, 'armed');
  // A punch on another tape is not this tape's.
  assert.equal(tapeCounter(tape(), live({ playing: true, record: { tape: 't2', track: 1, state: 'on' } }), null).status, 'play');
});

test('a count-in takes over the position, as #position read', () => {
  const beat = BAR / 4;
  const c = tapeCounter(tape(), live({ playing: true, count_in: 3 * beat }), null);
  assert.equal(c.big, 'count-in 2 of 4');
  assert.equal(c.small, '');
  assert.equal(c.status, 'play');
});

test('a mixdown takes over the position, its details the second line, in the words #position had', () => {
  const md = { tape: 't1', state: 'playing', from: 0, to: 8 * BAR };
  const c = tapeCounter(tape(), live({ playing: true, heard: 2 * BAR }), md);
  assert.deepEqual([c.big, c.small, c.note], ['mixing down', '', '0:05.0 of 0:20.0 · ■ cancels']);
  const tail = tapeCounter(tape(), live(), { ...md, state: 'tail' });
  assert.deepEqual([tail.big, tail.note], ['mixing down', 'letting it ring out · ■ cancels']);
  const saving = tapeCounter(tape(), live(), { ...md, state: 'saving' });
  assert.deepEqual([saving.big, saving.note], ['saving', 'the mixdown as a take…']);
  // Otherwise there is no note, and the second line is the marquee.
  assert.equal(tapeCounter(tape(), live(), null).note, '');
});

test('no output says so after the time, as #position did', () => {
  const c = tapeCounter(tape(), live({ output: '', heard: Math.round(13.2 * SR) }), null);
  assert.equal(c.big, '6.2');
  assert.equal(c.small, '0:13.2 · no output');
  assert.equal(tapeCounter(tape({ grid: null }), live({ output: '' }), null).small, 'no output');
});

test('a tape with no tempo shows its time large, with no unit', () => {
  const c = tapeCounter(tape({ grid: null }), live({ heard: 3 * SR }), null);
  assert.equal(c.big, '0:03.0');
  assert.equal(c.small, '');
  assert.equal(c.unit, '');
});

test('nothing polled yet: blank', () => {
  const c = tapeCounter(tape(), null, null);
  assert.deepEqual([c.big, c.small, c.status], ['', '', 'stop']);
});

test('the marquee names the tape, the tempo, the loop, the output and the punch', () => {
  assert.equal(tapeMarquee(tape(), live()), 'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM');
  assert.equal(tapeMarquee(tape({ loop: { in: 4 * BAR, out: 8 * BAR, on: false } }), live({ output_mode: 'phone' })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP OFF · ON A PHONE');
  assert.equal(tapeMarquee(tape(), live({ output_mode: 'both', record: { tape: 't1', track: 4, state: 'armed' } })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM AND ON A PHONE · TRACK 4 ARMED');
  assert.equal(tapeMarquee(tape(), live({ playing: true, record: { tape: 't1', track: 2, state: 'on' } })),
    'TAPE 1 · 96.0 BPM · 4/4 · LOOP BARS 5–8 · IN THE JAM ROOM · RECORDING TRACK 2');
  assert.equal(tapeMarquee(tape({ grid: null }), null), 'TAPE 1 · NO TEMPO YET · IN THE JAM ROOM');
  // A one-bar loop reads as one bar.
  assert.equal(tapeMarquee(tape({ loop: { in: 4 * BAR, out: 5 * BAR, on: true } }), live()), 'TAPE 1 · 96.0 BPM · 4/4 · LOOP BAR 5 · IN THE JAM ROOM');
});

// A take: its position as bar.beat when it has a tempo (the time beside),
// else the time large and the length beside; ▶ or ❚❚.
test('a take with a tempo reads bar.beat, the time beside it', () => {
  const c = takeCounter({ pos: Math.round(13.2 * SR), length: 58 * SR, sampleRate: SR, bar: '6.2', playing: true });
  assert.deepEqual([c.big, c.small, c.unit, c.status, c.note], ['6.2', '0:13.2', 'BAR', 'play', '']);
});

test('a take with no tempo reads its time, and its length beside it', () => {
  const c = takeCounter({ pos: 3 * SR, length: Math.round(58.4 * SR), sampleRate: SR, bar: '', playing: false });
  assert.deepEqual([c.big, c.small, c.unit, c.status], ['0:03.0', '/ 0:58', '', 'pause']);
});

test('a take\'s marquee names it, its tempo, In and Out, and where it plays', () => {
  assert.equal(takeMarquee({ name: 'Bass idea', bpm: 96, region: { start: Math.round(12.4 * SR), end: Math.round(20.8 * SR) }, sampleRate: SR }),
    'BASS IDEA · 96 BPM · IN 0:12.4 · OUT 0:20.8 · ON THIS DEVICE');
  assert.equal(takeMarquee({ name: '2026-10-04_201512', bpm: 84.25, region: null, sampleRate: SR }),
    '2026-10-04_201512 · 84.3 BPM · ON THIS DEVICE');
  assert.equal(takeMarquee({ name: 'x', bpm: null, region: null, sampleRate: SR }), 'X · ON THIS DEVICE');
});
