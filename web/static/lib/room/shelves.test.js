import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomShelves, inMonth, monthKey, monthWords, monthName, NEW_MS, filterWords } from './shelves.js';

// Mid-October, local time, so a month boundary is never a timezone away.
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const take = (name, created, more = {}) => ({ name, created, duration_seconds: 10, sample_rate: 48000, label: '', ...more });

test('this month’s takes stand on the takes shelf, newest first; earlier months go in boxes', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2)),
    take('jam_b.wav', iso(2026, 10, 14)),
    take('jam_c.wav', iso(2026, 9, 20)),
    take('jam_d.wav', iso(2026, 9, 3)),
    take('jam_e.wav', iso(2026, 8, 30)),
    take('jam_f.wav', iso(2025, 12, 31)),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_b.wav', 'jam_a.wav']);
  assert.deepEqual(s.archive.map((b) => [b.key, b.count, b.plate]), [
    ['2026-09', 2, 'SEP · 2'],
    ['2026-08', 1, 'AUG · 1'],
    ['2025-12', 1, 'DEC 2025 · 1'],
  ]);
  assert.equal(s.archive[2].title, 'December 2025: 1 take');
});

test('a family stands where its spine does: a cut made this month from last month’s take is in last month’s box', () => {
  const takes = [
    take('jam_src.wav', iso(2026, 9, 28)),
    take('jam_cut.wav', iso(2026, 10, 3), { source: { name: 'jam_src.wav', start_frame: 0, end_frame: 100 } }),
    take('jam_new.wav', iso(2026, 10, 10)),
    take('jam_newcut.wav', iso(2026, 10, 11), { source: { name: 'jam_new.wav', start_frame: 0, end_frame: 100 } }),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_new.wav']);
  assert.deepEqual(s.month.spines[0].members.map((m) => m.name), ['jam_newcut.wav']);
  assert.deepEqual(s.archive.map((b) => [b.key, b.count]), [['2026-09', 1]]);
  // The month's box opens to the spine and the cut folded into it.
  assert.deepEqual([...inMonth(takes, '2026-09')].sort(), ['jam_cut.wav', 'jam_src.wav']);
  assert.deepEqual([...inMonth(takes, '2026-10')].sort(), ['jam_new.wav', 'jam_newcut.wav']);
});

test('a tape’s mixdowns fold into the newest of them, as the rack folds them', () => {
  const takes = [
    take('jam_m1.wav', iso(2026, 10, 1), { origin: 'tape', tape_id: 't1', label: 'groove' }),
    take('jam_m2.wav', iso(2026, 10, 9), { origin: 'tape', tape_id: 't1', label: 'groove' }),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_m2.wav']);
  assert.deepEqual(s.month.spines[0].members.map((m) => m.name), ['jam_m1.wav']);
});

test('NEW is a take under a day old', () => {
  const takes = [
    take('jam_fresh.wav', new Date(NOW - NEW_MS + 60000).toISOString()),
    take('jam_old.wav', new Date(NOW - NEW_MS - 60000).toISOString()),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => [x.take.name, x.isNew]), [['jam_fresh.wav', true], ['jam_old.wav', false]]);
});

test('the search is the rack’s filter, on every shelf', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2), { label: 'bento loop', starred: true }),
    take('jam_b.wav', iso(2026, 10, 3), { label: 'guitar' }),
    take('jam_c.wav', iso(2026, 8, 3), { label: 'bento old' }),
  ];
  const s = roomShelves(takes, { query: 'bento' }, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_a.wav']);
  assert.deepEqual(s.archive.map((b) => b.key), ['2026-08']);
  const starred = roomShelves(takes, { starred: true }, NOW);
  assert.deepEqual(starred.month.spines.map((x) => x.take.name), ['jam_a.wav']);
});

// Answered by Gabe, 2026-10-15 (flow spec, answer 2): tapes live in the Studio
// only. They come off the Listening Room's shelf; their bounces stand on it as
// takes, folded into the newest of them (the test above).
test('there are no tapes on the shelves: the answer has none, whatever the Pi lists', () => {
  const takes = [take('jam_a.wav', iso(2026, 10, 2), { label: 'bento loop' })];
  const s = roomShelves(takes, { query: 'bento' }, NOW);
  assert.deepEqual(Object.keys(s).sort(), ['archive', 'month']);
  assert.equal('tapes' in s, false);
});

test('a tape’s bounces stand on the shelf as takes: one spine for the tape, the earlier bounces folded under it', () => {
  const takes = [
    take('jam_b1.wav', iso(2026, 10, 3), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_b2.wav', iso(2026, 10, 7), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_b3.wav', iso(2026, 10, 12), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_k.wav', iso(2026, 10, 9)),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_b3.wav', 'jam_k.wav']);
  assert.deepEqual(s.month.spines[0].members.map((m) => m.name).sort(), ['jam_b1.wav', 'jam_b2.wav']);
});

test('a take with no date goes in a last box, EARLIER', () => {
  const s = roomShelves([take('x.wav', ''), take('jam_s.wav', iso(2026, 7, 1))], {}, NOW);
  assert.deepEqual(s.archive.map((b) => [b.key, b.plate]), [['2026-07', 'JUL · 1'], ['', 'EARLIER · 1']]);
});

test('the words on the plates', () => {
  assert.equal(monthKey(new Date(2026, 0, 1).getTime()), '2026-01');
  assert.equal(monthKey(-Infinity), '');
  assert.equal(monthName(NOW), 'OCTOBER');
  assert.deepEqual(monthWords('2026-09', 22, NOW), { plate: 'SEP · 22', title: 'September: 22 takes' });
});

test('a filter left on says so, in words', () => {
  assert.deepEqual(filterWords({}), []);
  assert.deepEqual(filterWords({ starred: true }), ['starred']);
  assert.deepEqual(filterWords({ query: ' bento ', tag: 't1', midi: true }, [{ id: 't1', name: 'keeper' }]), ['“bento”', 'tagged keeper', 'with MIDI']);
  assert.deepEqual(filterWords({ tag: 'none', phone: true, tape: true }), ['untagged', 'from a phone', 'mixdowns']);
});

test('a take once marked as a record (Meta.Record) is an ordinary take: a cut folds into its source, and nothing is split off', () => {
  const marked = { cut: '2026-10-01T10:00:00Z', side: 'A', cover: 2 };
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2)),
    take('jam_r.wav', iso(2026, 10, 6), { source: { name: 'jam_a.wav', start_frame: 0, end_frame: 9 }, record: marked }),
    take('jam_m.wav', iso(2026, 10, 5), { record: marked }),
  ];
  const s = roomShelves(takes, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_m.wav', 'jam_a.wav']);
  assert.deepEqual(s.month.spines[1].members.map((m) => m.name), ['jam_r.wav'], 'the cut stands with its take');
  assert.ok(inMonth(takes, '2026-10').has('jam_r.wav'));
});
