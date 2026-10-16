// pageBar's side of the hand-off: the order of events on a page that is
// opened with a record waiting -- a list that comes late, a tap that gets in
// first, a take this page doesn't hold -- with stand-ins for storage, the
// clock, the page's events and timers, and the real take source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARRY_KEY, CARRY_LIMIT_MS, createCarry } from './carry.js';
import { createHandoff, takesFinder, HOLD_MS } from './handoff.js';
import { takeSource } from './take-source.js';

const SR = 48000;
const T0 = 1_760_000_000_000;

class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
class FakeAudio {
  constructor() { this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.l = {}; }
  addEventListener(ev, fn) { (this.l[ev] ??= []).push(fn); }
  emit(ev) { for (const f of this.l[ev] || []) f(); }
  async play() { this.paused = false; this.emit('play'); }
}
const events = () => {
  const l = {};
  return { addEventListener(ev, fn) { (l[ev] ??= []).push(fn); }, fire(ev, e = {}) { for (const f of l[ev] || []) f(e); }, visibilityState: 'visible' };
};
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const entryFor = (name = 'jam_a.wav', seconds = 600) => {
  const audio = new FakeAudio();
  const peaks = { buckets: 4, channels: 2, duration: seconds, data: [new Float32Array(8), new Float32Array(8)] };
  const t = { name, sample_rate: SR, duration_seconds: seconds, bpm: null, trim: null };
  const player = { audio, peaks, toggle() { throw new Error('not the row\'s toggle'); } };
  return { t, player, audio };
};

const left = (over = {}) => ({ take: 'jam_a.wav', frame: 30 * SR, sr: SR, playing: true, loop: false, ...over });

// A page that was opened with `rec` (or none) waiting.
function aPage({ rec = left(), find, tapes = Promise.resolve(null), studio = false, inBar = null } = {}) {
  const storage = new Store();
  const clock = { t: T0 };
  const carry = createCarry({ storage, now: () => clock.t });
  if (rec) carry.leave(rec);
  clock.t += 1000;
  const timers = [];
  const win = events(), doc = events();
  const page = { bar: inBar, shown: 0, loads: [] };
  const entry = entryFor();
  const h = createHandoff({
    carry, tapes, studio: () => studio,
    find: find || (async () => entry),
    takeInBar: () => !!page.bar,
    loadTake: (e) => { page.loads.push(e.t.name); page.bar = e.t.name; page.src = takeSource(e.t, e.player); return page.src; },
    showTape: () => { page.shown++; },
    state: () => (page.bar && page.src ? { take: page.bar, frame: page.src.pos(), sr: SR, playing: page.src.playing(), loop: page.src.loop } : page.bar ? { take: page.bar, frame: 0, sr: SR, playing: false } : null),
    win, doc, later: (fn, ms) => timers.push({ fn, ms }),
  });
  return { h, carry, storage, clock, timers, win, doc, page, entry };
}

test('the record is read before the page draws: the bar holds the tape back at once', () => {
  const p = aPage();
  assert.equal(p.h.holding(), true);
  assert.equal(p.page.shown, 0, 'the tape is not shown yet');
  assert.equal(aPage({ rec: null }).h.holding(), false, 'with no record, nothing is held');
});

test('with no record, start() does nothing and the page writes as it always did', async () => {
  const p = aPage({ rec: null });
  assert.equal(await p.h.start(), 'none');
  p.win.fire('pagehide');
  assert.equal(p.storage.getItem(CARRY_KEY), null);
});

test('the take is put in the bar when the list has it, and the record is used up', async () => {
  const p = aPage();
  assert.equal(await p.h.start(), 'playing');
  assert.deepEqual(p.page.loads, ['jam_a.wav']);
  assert.equal(p.storage.getItem(CARRY_KEY), null);
  assert.equal(p.entry.audio.currentTime, 31, '30 s + the second between the pages');
  assert.equal(p.h.holding(), false);
});

test('the blank is capped: the tape shows after HOLD_MS even while the list is slow', async () => {
  const list = deferred();
  const p = aPage({ find: () => list.p });
  const started = p.h.start();
  await Promise.resolve();
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, HOLD_MS);
  assert.equal(p.page.shown, 0);
  p.timers[0].fn();
  assert.equal(p.page.shown, 1, 'the bar is not blank for ever');
  assert.equal(p.h.holding(), false);
  list.resolve(null);
  await started;
});

test('a list that comes after the cap still gets the take into the bar, within the record\'s own limit', async () => {
  const list = deferred();
  const p = aPage({ find: () => list.p });
  const started = p.h.start();
  p.timers[0].fn(); // 4 s: the tape is shown
  p.clock.t += 6_000; // the list comes at 6 s
  list.resolve(p.entry);
  assert.equal(await started, 'playing');
  assert.deepEqual(p.page.loads, ['jam_a.wav']);
  assert.equal(p.entry.audio.currentTime, 37, '30 s + 7 s since it was left');
});

test('a list that comes after the record\'s own limit applies nothing and lets the record go', async () => {
  const list = deferred();
  const p = aPage({ find: () => list.p });
  const started = p.h.start();
  p.clock.t += CARRY_LIMIT_MS + 1;
  list.resolve(p.entry);
  assert.equal(await started, 'stale');
  assert.deepEqual(p.page.loads, []);
  assert.equal(p.storage.getItem(CARRY_KEY), null);
});

test('a tap on another take while the list is found wins: the carried take is not put over it', async () => {
  const list = deferred();
  const p = aPage({ find: () => list.p });
  const started = p.h.start();
  p.page.bar = 'jam_b.wav'; // the person pressed another spine
  list.resolve(p.entry);
  assert.equal(await started, 'superseded');
  assert.deepEqual(p.page.loads, []);
});

test('a take this page does not hold (not on its shelf): the record is left for the next page, and this page\'s pagehide leaves it be', async () => {
  const p = aPage({ find: async () => null });
  assert.equal(await p.h.start(), 'later');
  assert.equal(p.page.shown, 1, 'the tape shows');
  assert.ok(p.storage.getItem(CARRY_KEY), 'the record stands');
  assert.equal(p.h.pending(), true);
  p.win.fire('pagehide');
  p.doc.visibilityState = 'hidden';
  p.doc.fire('visibilitychange');
  const rec = JSON.parse(p.storage.getItem(CARRY_KEY));
  assert.equal(rec.take, 'jam_a.wav', 'not deleted by a page that applied nothing');
  assert.equal(rec.frame, 30 * SR, 'nor rewritten');
});

test('a take that is not in the list at all is let go', async () => {
  const p = aPage({ find: async () => 'missing' });
  assert.equal(await p.h.start(), 'gone');
  assert.equal(p.storage.getItem(CARRY_KEY), null);
  assert.equal(p.h.pending(), false);
});

test('a list that never comes (the fetch failed): the record stays for the next page', async () => {
  const never = new Promise(() => {});
  const p = aPage({ find: () => never });
  p.h.start();
  p.timers[0].fn();
  p.win.fire('pagehide');
  assert.equal(JSON.parse(p.storage.getItem(CARRY_KEY)).take, 'jam_a.wav');
});

test('the Studio with a tape loaded keeps its tape: no take is loaded, and the record is left alone', async () => {
  const p = aPage({ studio: true, tapes: Promise.resolve({ loaded: 't1' }) });
  assert.equal(await p.h.start(), 'studio');
  assert.deepEqual(p.page.loads, []);
  assert.equal(p.page.shown, 1);
  p.win.fire('pagehide');
  assert.equal(JSON.parse(p.storage.getItem(CARRY_KEY)).take, 'jam_a.wav');
});

test('Capture as the Studio with no tape loaded does take the take', async () => {
  const p = aPage({ studio: true, tapes: Promise.resolve({ loaded: '' }) });
  assert.equal(await p.h.start(), 'playing');
  assert.deepEqual(p.page.loads, ['jam_a.wav']);
});

test('a nav answer that fails is no tape: the take is carried', async () => {
  const p = aPage({ studio: true, tapes: Promise.reject(new Error('offline')) });
  assert.equal(await p.h.start(), 'playing');
});

test('with a take in the bar the page writes it at pagehide: frame, playing and Repeat', async () => {
  const p = aPage();
  await p.h.start();
  p.page.src.setLoop(true);
  p.clock.t += 5_000;
  p.entry.audio.currentTime = 40;
  p.win.fire('pagehide');
  const rec = JSON.parse(p.storage.getItem(CARRY_KEY));
  assert.deepEqual([rec.take, rec.frame, rec.playing, rec.loop], ['jam_a.wav', 40 * SR, true, true]);
});

test('a page whose bar holds no take and had no record deletes nothing it did not write', () => {
  const p = aPage({ rec: null });
  p.win.fire('pagehide');
  assert.equal(p.storage.getItem(CARRY_KEY), null);
});

// --- takesFinder ----------------------------------------------------------------------

function aList({ all = [{ name: 'jam_a.wav' }], player = async () => ({ audio: {}, peaks: {} }) } = {}) {
  const d = deferred();
  return { loaded: d.p, markLoaded: d.resolve, all, player };
}

test('takesFinder waits for the list, however late, then answers the take and its player', async () => {
  const list = aList({ all: [] }); // empty until the Pi answers
  let answered = null;
  const f = takesFinder(list)('jam_a.wav').then((r) => { answered = r; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(answered, null, 'not before the list is in (an empty list is not "missing")');
  list.all.push({ name: 'jam_a.wav' });
  list.markLoaded();
  await f;
  assert.equal(answered.t.name, 'jam_a.wav');
});

test('takesFinder: a take that is not in the list is missing; one with no player here is null', async () => {
  const list = aList({ all: [{ name: 'jam_b.wav' }], player: async () => null });
  list.markLoaded();
  assert.equal(await takesFinder(list)('jam_a.wav'), 'missing');
  assert.equal(await takesFinder(list)('jam_b.wav'), null, 'in the list, not on the shelf: this page cannot hold it');
});
