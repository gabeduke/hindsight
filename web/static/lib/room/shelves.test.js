import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomShelves, inMonth, monthKey, monthWords, monthName, NEW_MS, isRecord, filterWords, playOrder } from './shelves.js';

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
  const s = roomShelves(takes, null, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_b.wav', 'jam_a.wav']);
  assert.deepEqual(s.archive.map((b) => [b.key, b.count, b.plate]), [
    ['2026-09', 2, 'SEP · 2'],
    ['2026-08', 1, 'AUG · 1'],
    ['2025-12', 1, 'DEC 2025 · 1'],
  ]);
  assert.equal(s.archive[2].title, 'December 2025: 1 take');
  assert.equal(s.tapes, null, 'no tapes with the tape off');
});

test('a family stands where its spine does: a cut made this month from last month’s take is in last month’s box', () => {
  const takes = [
    take('jam_src.wav', iso(2026, 9, 28)),
    take('jam_cut.wav', iso(2026, 10, 3), { source: { name: 'jam_src.wav', start_frame: 0, end_frame: 100 } }),
    take('jam_new.wav', iso(2026, 10, 10)),
    take('jam_newcut.wav', iso(2026, 10, 11), { source: { name: 'jam_new.wav', start_frame: 0, end_frame: 100 } }),
  ];
  const s = roomShelves(takes, null, {}, NOW);
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
  const s = roomShelves(takes, null, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_m2.wav']);
  assert.deepEqual(s.month.spines[0].members.map((m) => m.name), ['jam_m1.wav']);
});

test('records stand only on the Records shelf, newest cut first', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2)),
    take('jam_r1.wav', iso(2026, 9, 2), { record: { cut: '2026-10-01T10:00:00Z', side: 'A', cover: 2 } }),
    take('jam_r2.wav', iso(2026, 10, 5), { record: { cut: '2026-10-12T10:00:00Z', side: 'A', cover: 0 } }),
    // A record cut from a take: the take still stands; the record isn't folded into it.
    take('jam_r3.wav', iso(2026, 10, 6), { source: { name: 'jam_a.wav', start_frame: 0, end_frame: 9 }, record: { cut: '2026-10-06T10:00:00Z', side: 'A', cover: 1 } }),
  ];
  const s = roomShelves(takes, null, {}, NOW);
  assert.deepEqual(s.records.map((t) => t.name), ['jam_r2.wav', 'jam_r3.wav', 'jam_r1.wav']);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_a.wav']);
  assert.deepEqual(s.month.spines[0].members, [], 'a record is not a cut on the takes shelf');
  assert.deepEqual(s.archive, [], 'nor a box in the archive');
  assert.ok(!inMonth(takes, '2026-09').has('jam_r1.wav'));
  assert.ok(isRecord(takes[1]) && !isRecord(takes[0]));
});

test('NEW is a take under a day old', () => {
  const takes = [
    take('jam_fresh.wav', new Date(NOW - NEW_MS + 60000).toISOString()),
    take('jam_old.wav', new Date(NOW - NEW_MS - 60000).toISOString()),
  ];
  const s = roomShelves(takes, null, {}, NOW);
  assert.deepEqual(s.month.spines.map((x) => [x.take.name, x.isNew]), [['jam_fresh.wav', true], ['jam_old.wav', false]]);
});

test('the search is the rack’s filter, on every shelf, and on tapes by name', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2), { label: 'bento loop', starred: true }),
    take('jam_b.wav', iso(2026, 10, 3), { label: 'guitar' }),
    take('jam_c.wav', iso(2026, 8, 3), { label: 'bento old' }),
    take('jam_r.wav', iso(2026, 10, 4), { label: 'bento record', record: { cut: '2026-10-04T00:00:00Z', side: 'A', cover: 0 } }),
  ];
  const tapes = { loaded: 't2', tapes: [{ id: 't1', name: 'Bento jam' }, { id: 't2', name: 'Tuesday groove' }] };
  const s = roomShelves(takes, tapes, { query: 'bento' }, NOW);
  assert.deepEqual(s.month.spines.map((x) => x.take.name), ['jam_a.wav']);
  assert.deepEqual(s.archive.map((b) => b.key), ['2026-08']);
  assert.deepEqual(s.records.map((t) => t.name), ['jam_r.wav']);
  assert.deepEqual(s.tapes.map((t) => [t.id, t.loaded]), [['t1', false]]);
  const starred = roomShelves(takes, tapes, { starred: true }, NOW);
  assert.deepEqual(starred.month.spines.map((x) => x.take.name), ['jam_a.wav']);
  assert.equal(starred.tapes.length, 2, 'the tapes have no stars to filter by');
  assert.deepEqual(starred.tapes.map((t) => t.loaded), [false, true]);
});

test('a take with no date goes in a last box, EARLIER', () => {
  const s = roomShelves([take('x.wav', ''), take('jam_s.wav', iso(2026, 7, 1))], null, {}, NOW);
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

test('Play all from here walks the shelf it starts on, and nothing past it', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2)),
    take('jam_b.wav', iso(2026, 10, 9)),
    take('jam_old.wav', iso(2026, 9, 9)),
    take('jam_r.wav', iso(2026, 10, 5), { record: { cut: '2026-10-06T00:00:00Z', side: 'A', cover: 0 } }),
  ];
  const s = roomShelves(takes, null, {}, NOW);
  assert.deepEqual(playOrder(s, 'jam_b.wav'), ['jam_b.wav', 'jam_a.wav'], 'no record, no older month');
  assert.deepEqual(playOrder(s, 'jam_r.wav'), ['jam_r.wav']);
  assert.deepEqual(playOrder(s, 'jam_old.wav'), ['jam_old.wav']);
});
