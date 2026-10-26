import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallShelves, shelfNames, monthKey, monthWords, monthName, NEW_MS, filterWords } from './shelves.js';

// Mid-October, local time, so a month boundary is never a timezone away.
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime();
const iso = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0).toISOString();
const take = (name, created, more = {}) => ({ name, created, duration_seconds: 10, sample_rate: 48000, label: '', ...more });
const TAGS = [{ id: 'g1', name: 'riffs', color: 6 }, { id: 'g2', name: 'vocals', color: 7 }];
const names = (s) => s.spines.map((x) => x.take.name);

test('a shelf per month, newest first, each newest first; then ★; then a shelf per tag, in the tags’ order', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2), { tag: 'g2' }),
    take('jam_b.wav', iso(2026, 10, 14), { starred: true }),
    take('jam_c.wav', iso(2026, 9, 20), { tag: 'g1', starred: true }),
    take('jam_d.wav', iso(2026, 9, 3)),
    take('jam_e.wav', iso(2026, 8, 30), { tag: 'g1' }),
    take('jam_f.wav', iso(2025, 12, 31)),
  ];
  const s = wallShelves(takes, { tags: TAGS }, NOW);
  assert.deepEqual(s.map((x) => [x.key, x.plate, x.count]), [
    ['month:2026-10', 'OCTOBER', 2],
    ['month:2026-09', 'SEPTEMBER', 2],
    ['month:2026-08', 'AUGUST', 1],
    ['month:2025-12', 'DECEMBER 2025', 1],
    ['starred', 'STARRED', 2],
    ['tag:g1', '#RIFFS', 2],
    ['tag:g2', '#VOCALS', 1],
  ]);
  assert.deepEqual(names(s[0]), ['jam_b.wav', 'jam_a.wav']);
  assert.deepEqual(names(s[4]), ['jam_b.wav', 'jam_c.wav'], 'a take stands on its month’s shelf and on ★');
  assert.deepEqual(names(s[5]), ['jam_c.wav', 'jam_e.wav']);
  assert.equal(s[3].title, 'December 2025: 1 take');
  assert.equal(s[5].tag, TAGS[0]);
});

test('Sort ▾ orders every shelf, and Oldest the months too', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2), { duration_seconds: 300, label: 'Zebra' }),
    take('jam_b.wav', iso(2026, 10, 14), { duration_seconds: 20, label: 'apple' }),
    take('jam_c.wav', iso(2026, 9, 20)),
  ];
  assert.deepEqual(wallShelves(takes, { sort: 'oldest' }, NOW).map((x) => [x.key, names(x)]),
    [['month:2026-09', ['jam_c.wav']], ['month:2026-10', ['jam_a.wav', 'jam_b.wav']]]);
  assert.deepEqual(names(wallShelves(takes, { sort: 'longest' }, NOW)[0]), ['jam_a.wav', 'jam_b.wav']);
  assert.deepEqual(names(wallShelves(takes, { sort: 'name' }, NOW)[0]), ['jam_b.wav', 'jam_a.wav'], 'by what the spine says, a and A alike');
});

test('a family stands where its spine does: a cut made this month from last month’s take is on last month’s shelf', () => {
  const takes = [
    take('jam_src.wav', iso(2026, 9, 28)),
    take('jam_cut.wav', iso(2026, 10, 3), { source: { name: 'jam_src.wav', start_frame: 0, end_frame: 100 } }),
    take('jam_new.wav', iso(2026, 10, 10)),
    take('jam_newcut.wav', iso(2026, 10, 11), { source: { name: 'jam_new.wav', start_frame: 0, end_frame: 100 } }),
  ];
  const s = wallShelves(takes, {}, NOW);
  assert.deepEqual(s.map((x) => [x.key, names(x)]), [['month:2026-10', ['jam_new.wav']], ['month:2026-09', ['jam_src.wav']]]);
  assert.deepEqual(s[0].spines[0].members.map((m) => m.name), ['jam_newcut.wav']);
  // A shelf's All › opens the List to the spine and the cut folded into it.
  assert.deepEqual([...shelfNames(takes, 'month:2026-09')].sort(), ['jam_cut.wav', 'jam_src.wav']);
  assert.deepEqual([...shelfNames(takes, 'month:2026-10')].sort(), ['jam_new.wav', 'jam_newcut.wav']);
});

test('All › on ★ or a tag opens the List to the families whose spine is starred or wears the tag', () => {
  const takes = [
    take('jam_s.wav', iso(2026, 10, 2), { starred: true, tag: 'g1' }),
    take('jam_scut.wav', iso(2026, 10, 3), { source: { name: 'jam_s.wav', start_frame: 0, end_frame: 9 } }),
    take('jam_t.wav', iso(2026, 10, 4)),
  ];
  assert.deepEqual([...shelfNames(takes, 'starred', { tags: TAGS })].sort(), ['jam_s.wav', 'jam_scut.wav']);
  assert.deepEqual([...shelfNames(takes, 'tag:g1', { tags: TAGS })].sort(), ['jam_s.wav', 'jam_scut.wav']);
  assert.deepEqual([...shelfNames(takes, 'tag:g2', { tags: TAGS })], []);
});

test('a tape’s mixdowns fold into the newest of them, as the List folds them', () => {
  const takes = [
    take('jam_m1.wav', iso(2026, 10, 1), { origin: 'tape', tape_id: 't1', label: 'groove' }),
    take('jam_m2.wav', iso(2026, 10, 9), { origin: 'tape', tape_id: 't1', label: 'groove' }),
  ];
  const s = wallShelves(takes, {}, NOW);
  assert.deepEqual(names(s[0]), ['jam_m2.wav']);
  assert.deepEqual(s[0].spines[0].members.map((m) => m.name), ['jam_m1.wav']);
});

test('NEW is a take under a day old', () => {
  const takes = [
    take('jam_fresh.wav', new Date(NOW - NEW_MS + 60000).toISOString()),
    take('jam_old.wav', new Date(NOW - NEW_MS - 60000).toISOString()),
  ];
  const s = wallShelves(takes, {}, NOW);
  assert.deepEqual(s[0].spines.map((x) => [x.take.name, x.isNew]), [['jam_fresh.wav', true], ['jam_old.wav', false]]);
});

test('the List’s filter holds on every shelf, and a shelf with nothing on it isn’t there', () => {
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2), { label: 'bento loop', starred: true }),
    take('jam_b.wav', iso(2026, 10, 3), { label: 'guitar' }),
    take('jam_c.wav', iso(2026, 8, 3), { label: 'bento old' }),
  ];
  assert.deepEqual(wallShelves(takes, { query: 'bento' }, NOW).map((x) => [x.key, names(x)]),
    [['month:2026-10', ['jam_a.wav']], ['month:2026-08', ['jam_c.wav']], ['starred', ['jam_a.wav']]]);
  assert.deepEqual(wallShelves(takes, { starred: true }, NOW).map((x) => x.key), ['month:2026-10', 'starred']);
  assert.deepEqual(wallShelves([], {}, NOW), []);
});

// Answered by Gabe, 2026-10-15 (flow spec, answer 2): tapes live in the Studio
// only. They come off the Listening Room's shelves; their bounces stand on
// them as takes, folded into the newest of them.
test('there are no tapes on the shelves; a tape’s bounces stand there as takes, one spine for the tape', () => {
  const takes = [
    take('jam_b1.wav', iso(2026, 10, 3), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_b2.wav', iso(2026, 10, 7), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_b3.wav', iso(2026, 10, 12), { origin: 'tape', tape_id: 't1', label: 'Tuesday groove' }),
    take('jam_k.wav', iso(2026, 10, 9)),
  ];
  const s = wallShelves(takes, {}, NOW);
  assert.deepEqual(s.map((x) => x.kind), ['month']);
  assert.deepEqual(names(s[0]), ['jam_b3.wav', 'jam_k.wav']);
  assert.deepEqual(s[0].spines[0].members.map((m) => m.name).sort(), ['jam_b1.wav', 'jam_b2.wav']);
});

test('a take with no date goes on a last month’s shelf, EARLIER', () => {
  const s = wallShelves([take('x.wav', ''), take('jam_s.wav', iso(2026, 7, 1))], {}, NOW);
  assert.deepEqual(s.map((x) => [x.key, x.plate]), [['month:2026-07', 'JULY'], ['month:', 'EARLIER']]);
  assert.deepEqual([...shelfNames([take('x.wav', '')], 'month:')], ['x.wav']);
});

test('the words on the plates', () => {
  assert.equal(monthKey(new Date(2026, 0, 1).getTime()), '2026-01');
  assert.equal(monthKey(-Infinity), '');
  assert.equal(monthName(NOW), 'OCTOBER');
  assert.deepEqual(monthWords('2026-09', 22, NOW), { plate: 'SEPTEMBER', short: 'SEP', title: 'September: 22 takes' });
  assert.deepEqual(monthWords('2025-09', 1, NOW), { plate: 'SEPTEMBER 2025', short: 'SEP 2025', title: 'September 2025: 1 take' });
});

test('a filter left on says so, in words', () => {
  assert.deepEqual(filterWords({}), []);
  assert.deepEqual(filterWords({ starred: true }), ['starred']);
  assert.deepEqual(filterWords({ query: ' bento ', tag: 't1', midi: true }, [{ id: 't1', name: 'keeper' }]), ['“bento”', 'tagged keeper', 'with MIDI']);
  assert.deepEqual(filterWords({ tag: 'none', week: true }), ['untagged', 'from this week']);
});

test('a take once marked as a record (Meta.Record) is an ordinary take: a cut folds into its source, and nothing is split off', () => {
  const marked = { cut: '2026-10-01T10:00:00Z', side: 'A', cover: 2 };
  const takes = [
    take('jam_a.wav', iso(2026, 10, 2)),
    take('jam_r.wav', iso(2026, 10, 6), { source: { name: 'jam_a.wav', start_frame: 0, end_frame: 9 }, record: marked }),
    take('jam_m.wav', iso(2026, 10, 5), { record: marked }),
  ];
  const s = wallShelves(takes, {}, NOW);
  assert.deepEqual(names(s[0]), ['jam_m.wav', 'jam_a.wav']);
  assert.deepEqual(s[0].spines[1].members.map((m) => m.name), ['jam_r.wav'], 'the cut stands with its take');
  assert.ok(shelfNames(takes, 'month:2026-10').has('jam_r.wav'));
});
