import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, shelve, latest, listFrom, parseBpm, flagChips, sheetState } from './shelf.js';

// Local times, as the shelf groups by the viewer's own day.
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const NOW = new Date(2026, 9, 4, 21, 0).getTime(); // Sunday 4 October 2026, 9pm

const take = (name, created, extra = {}) => ({
  name: `jam_${name}.wav`, created, duration_seconds: 30, label: '', starred: false,
  has_midi: false, ...extra,
});

test('a search finds a take by its name, its timestamp or its tempo', () => {
  const t = take('2026-10-04_201512', at(2026, 10, 4, 20, 15), { label: 'Bass idea', bpm: 96 });
  assert.equal(matches(t, { query: 'bass' }), true);
  assert.equal(matches(t, { query: '2015' }), true);
  assert.equal(matches(t, { query: '96.0' }), true);
  assert.equal(matches(t, { query: '  BASS  ' }), true);
  assert.equal(matches(t, { query: 'drums' }), false);
  assert.equal(matches(t, { query: '' }), true);
});

test('each filter that is on must hold', () => {
  const phone = take('a', at(2026, 10, 4), { origin: 'phone', starred: true });
  const tape = take('b', at(2026, 10, 4), { origin: 'tape', has_midi: true });
  const ring = take('c', at(2026, 10, 4));
  assert.equal(matches(phone, { starred: true }), true);
  assert.equal(matches(tape, { starred: true }), false);
  assert.equal(matches(tape, { midi: true }), true);
  assert.equal(matches(ring, { midi: true }), false);
  assert.equal(matches(phone, { phone: true }), true);
  assert.equal(matches(ring, { phone: true }), false);
  assert.equal(matches(tape, { tape: true }), true);
  assert.equal(matches(phone, { tape: true, starred: true }), false);
});

test('newest groups by day, newest first, whatever the list put first', () => {
  const takes = [
    take('starred-old', at(2026, 10, 1, 9), { starred: true }),
    take('today-early', at(2026, 10, 4, 9)),
    take('today-late', at(2026, 10, 4, 20)),
    take('yesterday', at(2026, 10, 3, 18)),
    take('last-year', at(2025, 3, 12, 18)),
  ];
  const groups = shelve(takes, {}, NOW);
  assert.deepEqual(groups.map((g) => g.label), [
    'TODAY · SUN 4 OCT', 'YESTERDAY · SAT 3 OCT', 'THU 1 OCT', '12 MAR 2025',
  ]);
  assert.deepEqual(groups[0].takes.map((t) => t.name), ['jam_today-late.wav', 'jam_today-early.wav']);
});

test('longest is one group, longest first', () => {
  const takes = [
    take('a', at(2026, 10, 4), { duration_seconds: 30 }),
    take('b', at(2026, 10, 3), { duration_seconds: 420 }),
    take('c', at(2026, 10, 2), { duration_seconds: 120 }),
  ];
  const groups = shelve(takes, { sort: 'longest' }, NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'LONGEST FIRST');
  assert.deepEqual(groups[0].takes.map((t) => t.name), ['jam_b.wav', 'jam_c.wav', 'jam_a.wav']);
});

test('a take with no readable date goes last, under EARLIER, never Invalid Date', () => {
  const groups = shelve([take('x', 'nonsense'), take('y', undefined), take('z', at(2026, 10, 4))], {}, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['TODAY · SUN 4 OCT', 'EARLIER']);
  assert.equal(groups[1].takes.length, 2);
});

test('filters that match nothing leave no groups', () => {
  assert.deepEqual(shelve([take('a', at(2026, 10, 4))], { tape: true }, NOW), []);
  assert.deepEqual(shelve([], {}, NOW), []);
});

test('the latest take is the newest, not the first starred one', () => {
  const takes = [take('starred-old', at(2026, 10, 1), { starred: true }), take('new', at(2026, 10, 4)), take('mid', at(2026, 10, 3))];
  assert.equal(latest(takes).name, 'jam_new.wav');
  assert.equal(latest([]), null);
  assert.equal(latest([take('undated', 'nope')]).name, 'jam_undated.wav');
});

test('a take opened from either list knows which one to go back to', () => {
  const origin = 'http://pi.local:5000';
  assert.equal(listFrom('http://pi.local:5000/', origin), '/');
  assert.equal(listFrom('http://pi.local:5000/takes.html', origin), '/takes.html');
  assert.equal(listFrom('http://pi.local:5000/takes.html?x=1#top', origin), '/takes.html');
  assert.equal(listFrom('http://pi.local:5000/tape.html', origin), null);
  assert.equal(listFrom('https://elsewhere.example/takes.html', origin), null);
  assert.equal(listFrom('', origin), null);
  assert.equal(listFrom('not a url', origin), null);
});

// flagChips: a take's flags, as the detail pane lists them.

test('flags read as their label and the time into the take, in order', () => {
  const t = { sample_rate: 48000, flags: [{ frame: 48000 * 21, label: 'chorus' }, { frame: 48000 * 4, label: 'verse' }, { frame: 48000 * 65.4, label: '' }] };
  assert.deepEqual(flagChips(t), [
    { label: 'verse', at: '0:04', frame: 48000 * 4 }, { label: 'chorus', at: '0:21', frame: 48000 * 21 }, { label: 'flag', at: '1:05', frame: 48000 * 65.4 },
  ]);
  assert.deepEqual(flagChips({ flags: [{ frame: 96000, label: 'x' }] }), [{ label: 'x', at: '0:02', frame: 96000 }], 'a take with no rate is 48 kHz');
  assert.deepEqual(flagChips({}), []);
});

test('parseBpm reads a tempo, clears on empty, and refuses what no take can have', () => {
  assert.deepEqual(parseBpm(''), { ok: true, value: null });
  assert.deepEqual(parseBpm('  96.5 '), { ok: true, value: 96.5 });
  assert.equal(parseBpm('fast').ok, false);
  assert.equal(parseBpm('0').ok, false);
  assert.equal(parseBpm('-90').ok, false);
});

test('flagChips carries each flag\'s frame, so a chip can seek to it', () => {
  const chips = flagChips({ sample_rate: 48000, flags: [{ frame: 96000, label: 'b' }, { frame: 48000, label: 'a' }] });
  assert.deepEqual(chips.map((c) => [c.label, c.at, c.frame]), [['a', '0:01', 48000], ['b', '0:02', 96000]]);
});

// The cassette sheet on a phone: one history entry per opening, so the
// device's Back closes it and never leaves the page by surprise.
test('opening the sheet pushes one history entry; opening another replaces it', () => {
  let s = sheetState({ open: null }, { type: 'open', name: 'a' });
  assert.deepEqual(s, { open: 'a', history: 'push' });
  s = sheetState(s, { type: 'open', name: 'b' });
  assert.deepEqual(s, { open: 'b', history: 'replace' });
});

test('closing by its own key goes back, and the popstate that follows does nothing more', () => {
  let s = sheetState({ open: 'a' }, { type: 'close' });
  assert.deepEqual(s, { open: null, history: 'back' });
  s = sheetState(s, { type: 'popstate' });
  assert.deepEqual(s, { open: null, history: null });
});

test("the device's Back closes an open sheet without going back again", () => {
  assert.deepEqual(sheetState({ open: 'a' }, { type: 'popstate' }), { open: null, history: null });
});

test('closing a closed sheet does nothing', () => {
  assert.deepEqual(sheetState({ open: null }, { type: 'close' }), { open: null, history: null });
});
