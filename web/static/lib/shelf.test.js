import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, shelve, latest, newest, listFrom, parseBpm, flagChips, sheetState, spineTitle, tagOf, tagCounts, fold, familyOf, familyCounts, familySticker, cutsBack, freedBy, tapeName } from './shelf.js';

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

test("the device's Forward reopens the sheet its entry names", () => {
  assert.deepEqual(sheetState({ open: null }, { type: 'popstate', state: { cassette: 'a' } }), { open: 'a', history: null });
});

test('widening past the pane closes the sheet and takes its entry back', () => {
  assert.deepEqual(sheetState({ open: 'a' }, { type: 'widen' }), { open: null, history: 'back' });
  assert.deepEqual(sheetState({ open: null }, { type: 'widen' }), { open: null, history: null });
});

test('newest is the n newest takes, newest first, undated ones last', () => {
  const t = [take('a', at(2026, 10, 1)), take('b', at(2026, 10, 3)), take('c', 'not a date'), take('d', at(2026, 10, 2))];
  assert.deepEqual(newest(t, 3).map((x) => x.name), ['jam_b.wav', 'jam_d.wav', 'jam_a.wav']);
  assert.deepEqual(newest(t, 9).map((x) => x.name).at(-1), 'jam_c.wav');
  assert.deepEqual(newest([], 3), []);
});

test("spineTitle is a take's name, or the time it was caught when it has none", () => {
  assert.equal(spineTitle({ name: 'jam_2026-10-05_201512.wav', label: 'Verse' }), 'Verse');
  assert.equal(spineTitle({ name: 'jam_2026-10-05_201512.wav', label: '' }), '20:15:12');
  assert.equal(spineTitle({ name: 'phone_odd.wav' }), 'phone_odd');
});

// --- tags -----------------------------------------------------------------

const TAGS = [
  { id: 't0000a1', name: 'Ideas', color: 6 },
  { id: 't0000b2', name: 'Keepers', color: 7 },
];

test('a take wears the tag whose id it names, and a dropped tag reads as none', () => {
  assert.equal(tagOf(take('a', at(2026, 10, 4), { tag: 't0000a1' }), TAGS).name, 'Ideas');
  assert.equal(tagOf(take('a', at(2026, 10, 4), { tag: 't0000zz' }), TAGS), null);
  assert.equal(tagOf(take('a', at(2026, 10, 4)), TAGS), null);
  assert.deepEqual(tagCounts([
    take('a', at(2026, 10, 4), { tag: 't0000a1' }),
    take('b', at(2026, 10, 4), { tag: 't0000a1' }),
    take('c', at(2026, 10, 4), { tag: 't0000gone' }),
    take('d', at(2026, 10, 4)),
  ], TAGS), { '': 2, t0000a1: 2, t0000b2: 0 });
});

test('the tag filter shows one tag, or only the untagged, and the search finds a tag by name', () => {
  const idea = take('a', at(2026, 10, 4), { tag: 't0000a1' });
  const keep = take('b', at(2026, 10, 4), { tag: 't0000b2' });
  const none = take('c', at(2026, 10, 4));
  const stale = take('d', at(2026, 10, 4), { tag: 't0000gone' });
  assert.deepEqual([idea, keep, none, stale].filter((t) => matches(t, { tag: 't0000a1', tags: TAGS })), [idea]);
  assert.deepEqual([idea, keep, none, stale].filter((t) => matches(t, { tag: 'none', tags: TAGS })), [none, stale]);
  assert.equal(matches(keep, { tag: '', tags: TAGS }), true);
  assert.equal(matches(keep, { query: 'keepers', tags: TAGS }), true);
  assert.equal(matches(idea, { query: 'keepers', tags: TAGS }), false);
  assert.equal(matches(idea, { tag: 't0000a1', starred: true, tags: TAGS }), false, 'filters combine');
});

test('sorting by tag makes a group per tag in list order, the untagged last', () => {
  const takes = [
    take('old-keep', at(2026, 10, 1), { tag: 't0000b2' }),
    take('new-keep', at(2026, 10, 3), { tag: 't0000b2' }),
    take('idea', at(2026, 10, 2), { tag: 't0000a1' }),
    take('loose', at(2026, 10, 4)),
  ];
  const groups = shelve(takes, { sort: 'tag', tags: TAGS }, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['IDEAS', 'KEEPERS', 'UNTAGGED']);
  assert.deepEqual(groups[1].takes.map((t) => t.name), ['jam_new-keep.wav', 'jam_old-keep.wav']);
  // A tag nobody wears has no heading; with no tags at all there is one group.
  assert.deepEqual(shelve([takes[3]], { sort: 'tag', tags: TAGS }, NOW).map((g) => g.label), ['UNTAGGED']);
  assert.deepEqual(shelve(takes, { sort: 'tag', tags: [] }, NOW).map((g) => g.label), ['NO TAGS YET']);
});

// --- families: cuts and mixdowns fold into a spine ---------------------------

const cutOf = (name, created, from, extra = {}) =>
  take(name, created, { source: { name: `jam_${from}.wav`, start_frame: 0, end_frame: 1 }, ...extra });
const mixOf = (name, created, tape_id, label = 'Night tape') => take(name, created, { origin: 'tape', tape_id, label });
const names = (l) => l.map((t) => t.name.replace(/^jam_|\.wav$/g, ''));

test('fold: nothing to fold leaves the list as it is', () => {
  const f = fold([take('a', at(2026, 10, 4, 10)), take('b', at(2026, 10, 4, 9))]);
  assert.deepEqual(names(f.shelf), ['a', 'b']);
  assert.equal(f.cuts.size + f.mixes.size + f.under.size, 0);
});

test('fold: cuts fold into their original, oldest first', () => {
  const f = fold([cutOf('c2', at(2026, 10, 4, 12), 'jam'), take('jam', at(2026, 10, 4, 10)), cutOf('c1', at(2026, 10, 4, 11), 'jam')]);
  assert.deepEqual(names(f.shelf), ['jam']);
  assert.deepEqual(names(f.cuts.get('jam_jam.wav')), ['c1', 'c2']);
  assert.equal(f.under.get('jam_c2.wav'), 'jam_jam.wav');
});

test('fold: a cut of a cut folds into the first take, in either order', () => {
  const jam = take('jam', at(2026, 10, 4, 10)), c = cutOf('c', at(2026, 10, 4, 11), 'jam'), cc = cutOf('cc', at(2026, 10, 4, 12), 'c');
  for (const l of [[cc, c, jam], [jam, c, cc]]) {
    const f = fold(l);
    assert.deepEqual(names(f.shelf), ['jam']);
    assert.deepEqual(names(f.cuts.get('jam_jam.wav')), ['c', 'cc']);
  }
});

test('fold: a cut whose original is not in the list stands on the shelf', () => {
  const f = fold([cutOf('c', at(2026, 10, 4, 11), 'gone'), cutOf('cc', at(2026, 10, 4, 12), 'c')]);
  assert.deepEqual(names(f.shelf), ['c']);
  assert.deepEqual(names(f.cuts.get('jam_c.wav')), ['cc']);
});

test('fold: one tape\'s mixdowns fold into the newest, the rest newest first', () => {
  const f = fold([
    mixOf('m1', at(2026, 10, 4, 19, 58), 't1'), mixOf('m3', at(2026, 10, 4, 20, 55), 't1'),
    mixOf('m2', at(2026, 10, 4, 20, 31), 't1'), mixOf('x', at(2026, 10, 4, 20), 't2'),
  ]);
  assert.deepEqual(names(f.shelf), ['m3', 'x']);
  assert.deepEqual(names(f.mixes.get('jam_m3.wav')), ['m2', 'm1']);
  assert.equal(f.mixes.has('jam_x.wav'), false);
});

test('fold: mixdowns from before tape_id group by label; a renamed one with an id stays with its tape', () => {
  const old = fold([mixOf('a1', at(2026, 10, 1), undefined), mixOf('a2', at(2026, 10, 2), undefined), mixOf('b', at(2026, 10, 2, 13), undefined, 'Day tape')]);
  assert.deepEqual(names(old.shelf), ['a2', 'b']);
  const renamed = fold([mixOf('m1', at(2026, 10, 4, 10), 't1', 'final?'), mixOf('m2', at(2026, 10, 4, 11), 't1')]);
  assert.deepEqual(names(renamed.shelf), ['m2']);
});

test('fold: a cut of an earlier mix folds into the mix that stands in', () => {
  const f = fold([mixOf('m1', at(2026, 10, 4, 10), 't1'), mixOf('m2', at(2026, 10, 4, 11), 't1'), cutOf('c', at(2026, 10, 4, 12), 'm1')]);
  assert.deepEqual(names(f.shelf), ['m2']);
  assert.deepEqual(names(f.cuts.get('jam_m2.wav')), ['c']);
  assert.deepEqual(names(f.mixes.get('jam_m2.wav')), ['m1']);
});

test('fold: a lineage that loops leaves its takes on the shelf', () => {
  const f = fold([cutOf('a', at(2026, 10, 4, 10), 'b'), cutOf('b', at(2026, 10, 4, 11), 'a')]);
  assert.deepEqual(names(f.shelf), ['a', 'b']);
});

test('fold: every take is a spine or a member, exactly once', () => {
  const l = [
    take('jam', at(2026, 10, 4, 10)), cutOf('c', at(2026, 10, 4, 11), 'jam'), cutOf('cc', at(2026, 10, 4, 12), 'c'),
    cutOf('lost', at(2026, 10, 4, 12), 'gone'), mixOf('m1', at(2026, 10, 4, 13), 't1'), mixOf('m2', at(2026, 10, 4, 14), 't1'),
    cutOf('mc', at(2026, 10, 4, 15), 'm1'), take('phone', at(2026, 10, 4, 16), { origin: 'phone' }),
  ];
  const f = fold(l);
  const all = [...f.shelf.map((t) => t.name), ...f.under.keys()].sort();
  assert.deepEqual(all, l.map((t) => t.name).sort());
  const members = [...f.cuts.values(), ...f.mixes.values()].flat().map((t) => t.name).sort();
  assert.deepEqual(members, [...f.under.keys()].sort());
  const spines = new Set(f.shelf.map((t) => t.name));
  assert.ok([...f.under.values()].every((s) => spines.has(s)), 'every take folds into a spine on the shelf');
});

test('fold: mixdowns from before tape_id join the tape whose newer mixdowns share their label', () => {
  const f = fold([
    mixOf('old1', at(2026, 10, 1), undefined), mixOf('old2', at(2026, 10, 2), undefined),
    mixOf('new1', at(2026, 10, 5, 10), 't1'), mixOf('new2', at(2026, 10, 5, 11), 't1', 'final?'),
  ]);
  assert.deepEqual(names(f.shelf), ['new2']);
  assert.deepEqual(names(f.mixes.get('jam_new2.wav')), ['new1', 'old2', 'old1']);
});

test('fold: an old mixdown whose label two tapes share stays with the other old ones', () => {
  const f = fold([mixOf('old', at(2026, 10, 1), undefined), mixOf('a', at(2026, 10, 5, 10), 't1'), mixOf('b', at(2026, 10, 5, 11), 't2')]);
  assert.deepEqual(names(f.shelf), ['old', 'a', 'b']);
});

test('fold: a mixdown that was itself cut from a take takes its tape with it', () => {
  // No server writes this today; the shelf still never loses a take to it.
  const f = fold([
    take('jam', at(2026, 10, 4, 9)),
    mixOf('m1', at(2026, 10, 4, 10), 't1'),
    { ...mixOf('m2', at(2026, 10, 4, 11), 't1'), source: { name: 'jam_jam.wav', start_frame: 0, end_frame: 1 } },
  ]);
  assert.deepEqual(names(f.shelf), ['jam']);
  assert.equal(f.under.get('jam_m1.wav'), 'jam_jam.wav');
});

test('freedBy counts only the takes cut from that one', () => {
  const c = cutOf('c', at(2026, 10, 4, 11), 'jam'), cc = cutOf('cc', at(2026, 10, 4, 12), 'c');
  assert.equal(freedBy('jam_jam.wav', [c, cc]), 1);
  assert.equal(freedBy('jam_c.wav', [c, cc]), 1);
  assert.equal(freedBy('jam_cc.wav', [c, cc]), 0);
});

test('tapeName is the label most of a tape\'s mixdowns wear', () => {
  const l = [mixOf('m3', at(2026, 10, 4, 12), 't1', 'final?'), mixOf('m2', at(2026, 10, 4, 11), 't1'), mixOf('m1', at(2026, 10, 4, 10), 't1')];
  assert.equal(tapeName(l), 'Night tape');
  assert.equal(tapeName([mixOf('a', at(2026, 10, 4, 12), 't1', 'B'), mixOf('b', at(2026, 10, 4, 11), 't1', 'A')]), 'B');
  assert.equal(tapeName([]), '');
});

test('shelve: a cut folds into its original, on the original\'s day', () => {
  const jam = take('2026-10-03_210000', at(2026, 10, 3, 21), { label: 'Tuesday jam' });
  const riff = cutOf('2026-10-04_101500', at(2026, 10, 4, 10, 15), '2026-10-03_210000', { label: 'Tuesday jam · 0:42–1:10' });
  const g = shelve([riff, jam], {}, NOW);
  assert.equal(g.length, 1);
  assert.match(g[0].label, /^YESTERDAY/);
  assert.deepEqual(g[0].takes.map((t) => t.name), [jam.name]);
  assert.deepEqual(g[0].members.get(jam.name).map((t) => t.name), [riff.name]);
});

test('shelve: a filter the original fails leaves the cut on its own, on its own day', () => {
  const jam = take('2026-10-03_210000', at(2026, 10, 3, 21));
  const riff = cutOf('2026-10-04_101500', at(2026, 10, 4, 10, 15), '2026-10-03_210000', { starred: true });
  const g = shelve([riff, jam], { starred: true }, NOW);
  assert.deepEqual(g.flatMap((x) => x.takes).map((t) => t.name), [riff.name]);
  assert.match(g[0].label, /^TODAY/);
});

test('shelve: longest and tag sorts place a family by its spine', () => {
  const jam = take('jam', at(2026, 10, 4, 10), { duration_seconds: 900, tag: 'g1' });
  const riff = cutOf('riff', at(2026, 10, 4, 11), 'jam', { duration_seconds: 28, tag: 'g2' });
  const short = take('short', at(2026, 10, 4, 12), { duration_seconds: 60 });
  const long = shelve([riff, jam, short], { sort: 'longest' }, NOW);
  assert.deepEqual(names(long[0].takes), ['jam', 'short']);
  const tags = [{ id: 'g1', name: 'Keep', color: 'red' }, { id: 'g2', name: 'Riffs', color: 'blue' }];
  const byTag = shelve([riff, jam, short], { sort: 'tag', tags }, NOW);
  assert.deepEqual(byTag.map((x) => x.label), ['KEEP', 'UNTAGGED']);
  assert.deepEqual(names(byTag[0].members.get(jam.name)), ['riff']);
});

test('familyOf names a member\'s spine and lists a spine\'s family', () => {
  const jam = take('jam', at(2026, 10, 4, 10)), c = cutOf('c', at(2026, 10, 4, 11), 'jam');
  const f = fold([jam, c]);
  assert.equal(familyOf(f, c.name).spine.name, jam.name);
  assert.deepEqual(names(familyOf(f, jam.name).cuts), ['c']);
  assert.deepEqual(familyOf(f, jam.name).mixes, []);
});

test('a spine\'s sticker counts its cuts, and its tape\'s mixdowns with itself', () => {
  const jam = take('jam', at(2026, 10, 4, 10));
  const c1 = cutOf('c1', at(2026, 10, 4, 11), 'jam'), c2 = cutOf('c2', at(2026, 10, 4, 12), 'jam');
  assert.deepEqual(familyCounts([c1, c2]), { cuts: 2, mixes: 0 });
  assert.equal(familySticker(familyCounts([c1, c2])), '✂2');
  const m2 = mixOf('m2', at(2026, 10, 4, 11), 't1'), m1 = mixOf('m1', at(2026, 10, 4, 10), 't1');
  const mc = cutOf('mc', at(2026, 10, 4, 12), 'm2');
  assert.deepEqual(familyCounts([mc, m1]), { cuts: 1, mixes: 2 });
  assert.equal(familySticker(familyCounts([mc, m1])), '✂1 · MIX ×2');
  assert.equal(familySticker(familyCounts([])), '');
});

test('a delete\'s toast says the cuts are back on the shelf', () => {
  assert.equal(cutsBack(0), '');
  assert.equal(cutsBack(1), ' · its cut is back on the shelf');
  assert.equal(cutsBack(3), ' · its 3 cuts are back on the shelf');
  assert.equal(cutsBack(2, true), ' · their 2 cuts are back on the shelf');
});
