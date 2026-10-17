// The bar's hand-off between pages (docs/superpowers/plans/2026-10-15-f4.md):
// stand-ins for sessionStorage, the audio element, the clock and the page's
// events, and the real take source on top of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startOpen,
  CARRY_KEY, FRAME_KEY, CARRY_LIMIT_MS, FRAME_LIMIT_MS, createCarry, resumeAt, mayCarry, studioVisit, openTheTape, takePageState,
} from './carry.js';
import { takeSource } from './take-source.js';

const SR = 48000;
const T0 = 1_760_000_000_000;

class Store {
  constructor() { this.m = new Map(); this.reads = 0; this.writes = 0; }
  getItem(k) { this.reads++; return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.writes++; this.m.set(k, String(v)); }
  removeItem(k) { this.writes++; this.m.delete(k); }
}

class FakeAudio {
  constructor({ refuse = null } = {}) {
    this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.l = {};
    this.refuse = refuse; this.plays = 0;
  }
  addEventListener(ev, fn) { (this.l[ev] ??= []).push(fn); }
  emit(ev) { for (const f of this.l[ev] || []) f(); }
  async play() {
    this.plays++;
    if (this.refuse) throw this.refuse;
    this.paused = false;
    this.emit('play');
  }
}

function aSource({ name = 'jam_a.wav', seconds = 600, refuse = null } = {}) {
  const audio = new FakeAudio({ refuse });
  const peaks = { buckets: 4, channels: 2, duration: seconds, data: [new Float32Array(8), new Float32Array(8)] };
  const player = { audio, peaks, toggle() { throw new Error('the row\'s toggle toasts a refusal: not for the hand-off'); } };
  const t = { name, sample_rate: SR, duration_seconds: seconds, bpm: null, trim: null };
  return { audio, src: takeSource(t, player), t, player };
}

function aCarry(over = {}) {
  const storage = over.storage || new Store();
  const clock = { t: T0 };
  const carry = createCarry({ storage, now: () => clock.t });
  return { carry, storage, clock };
}

const left = (over = {}) => ({ take: 'jam_a.wav', frame: 30 * SR, sr: SR, playing: true, ...over });

// --- the record --------------------------------------------------------------

test('a playing take resumes at its frame plus the time away', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  clock.t += 7_500; // the page load
  const rec = carry.read();
  assert.equal(rec.take, 'jam_a.wav');
  const { audio, src } = aSource();
  const how = await carry.resume(rec, src);
  assert.equal(how, 'playing');
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, 37.5, '30 s + 7.5 s away');
});

test('a paused take resumes at its frame and stays paused, however long the gap', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ playing: false }));
  clock.t += 90_000;
  const { audio, src } = aSource();
  const how = await carry.resume(carry.read(), src);
  assert.equal(how, 'paused');
  assert.equal(audio.currentTime, 30);
  assert.equal(audio.paused, true);
  assert.equal(audio.plays, 0);
});

test('a take that ended during the gap is not resumed', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 598 * SR }));
  clock.t += 10_000;
  const { audio, src } = aSource({ seconds: 600 });
  assert.equal(await carry.resume(carry.read(), src), 'gone');
  assert.equal(audio.plays, 0);
  assert.equal(resumeAt({ ...left({ frame: 598 * SR }), at: T0 }, T0 + 1_000, 600 * SR).play, true, 'still playing a second later');
});

test('a take that no longer exists is not loaded, and its record is let go', async () => {
  const { carry, storage } = aCarry();
  carry.leave(left({ take: 'jam_gone.wav' }));
  const rec = carry.peek();
  let loaded = 0;
  const how = await carry.arrive(rec, { find: async () => 'missing', load: () => { loaded++; } });
  assert.equal(how, 'gone');
  assert.equal(loaded, 0, 'nothing put in the bar');
  assert.equal(storage.getItem(CARRY_KEY), null);
});

test('a take this page cannot hold is left in its record for the next page', async () => {
  const { carry, storage } = aCarry();
  carry.leave(left({ take: 'jam_old.wav' }));
  const rec = carry.peek();
  let loaded = 0;
  const how = await carry.arrive(rec, { find: async () => null, load: () => { loaded++; } });
  assert.equal(how, 'later');
  assert.equal(loaded, 0);
  assert.equal(JSON.parse(storage.getItem(CARRY_KEY)).take, 'jam_old.wav', 'still there');
  assert.equal(carry.peek().take, 'jam_old.wav', 'and good');
});

test('a record is used up when it is applied, not before', async () => {
  const { carry, storage } = aCarry();
  carry.leave(left());
  const rec = carry.peek();
  assert.ok(storage.getItem(CARRY_KEY), 'peeking does not use it');
  const s = aSource();
  await carry.arrive(rec, { find: async () => s, load: () => s.src });
  assert.equal(storage.getItem(CARRY_KEY), null);
});

test('consume lets go only the record it was given, not a newer one', () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  const old = carry.peek();
  clock.t += 1000;
  carry.leave(left({ frame: 5 * SR }));
  carry.consume(old);
  assert.equal(carry.peek().frame, 5 * SR);
});

test('a take that is no longer wanted (the person moved on meanwhile) is not loaded, and the record is spent', async () => {
  const { carry, storage } = aCarry();
  carry.leave(left());
  const s = aSource();
  let loaded = 0;
  const how = await carry.arrive(carry.peek(), { find: async () => s, load: () => { loaded++; return s.src; }, stillWanted: () => false });
  assert.equal(how, 'superseded');
  assert.equal(loaded, 0);
  assert.equal(storage.getItem(CARRY_KEY), null);
});

test('a record that goes stale while the page finds the take is let go, not applied', async () => {
  const { carry, clock, storage } = aCarry();
  carry.leave(left());
  const rec = carry.peek();
  const s = aSource();
  let loaded = 0;
  const how = await carry.arrive(rec, { find: async () => { clock.t += CARRY_LIMIT_MS + 1; return s; }, load: () => { loaded++; return s.src; } });
  assert.equal(how, 'stale');
  assert.equal(loaded, 0);
  assert.equal(storage.getItem(CARRY_KEY), null);
});

// --- Repeat ---------------------------------------------------------------------

test('Repeat is carried: the take lands on Repeat, and a long gap wraps round it, never ending', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 590 * SR, loop: true }));
  clock.t += 25_000; // past the end of a 600 s take
  const { audio, src } = aSource({ seconds: 600 });
  const how = await carry.resume(carry.read(), src);
  assert.equal(how, 'playing');
  assert.equal(src.loop, true);
  assert.equal(audio.currentTime, 15, '590 + 25 wraps to 15');
});

test('a take not on Repeat that ended in the gap is dropped; the same on Repeat is not', () => {
  const rec = { ...left({ frame: 590 * SR }), at: T0 };
  assert.equal(resumeAt(rec, T0 + 25_000, 600 * SR), null);
  assert.equal(resumeAt({ ...rec, loop: true }, T0 + 25_000, 600 * SR).playFrame, 15 * SR);
});

test('a paused take on Repeat comes back on Repeat, paused', async () => {
  const { carry } = aCarry();
  carry.leave(left({ playing: false, loop: true }));
  const { audio, src } = aSource();
  assert.equal(await carry.resume(carry.read(), src), 'paused');
  assert.equal(src.loop, true);
  assert.equal(audio.paused, true);
});

test('a record without a loop field (an older page wrote it) is a take not on Repeat', async () => {
  const storage = new Store();
  storage.setItem(CARRY_KEY, JSON.stringify({ v: 1, take: 'jam_a.wav', frame: SR, sr: SR, playing: false, at: T0 }));
  const { carry } = aCarry({ storage });
  const rec = carry.read();
  assert.ok(rec);
  const { src } = aSource();
  await carry.resume(rec, src);
  assert.equal(src.loop, false);
});

test('leave writes the loop flag', () => {
  const { carry, storage } = aCarry();
  carry.leave(left({ loop: true }));
  assert.equal(JSON.parse(storage.getItem(CARRY_KEY)).loop, true);
  carry.leave(left());
  assert.equal(JSON.parse(storage.getItem(CARRY_KEY)).loop, false);
});

// --- the hidden page that comes back -----------------------------------------------

test('a page that went hidden and came back visible lets the record it wrote go', () => {
  const { carry, storage } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.doc.visibilityState = 'hidden';
  win.doc.fire('visibilitychange');
  assert.ok(storage.getItem(CARRY_KEY));
  win.doc.visibilityState = 'visible';
  win.doc.fire('visibilitychange');
  assert.equal(storage.getItem(CARRY_KEY), null, 'a page killed instead would have left it; one that came back did not leave');
});

test('coming back visible does not let go a newer record', () => {
  const { carry, clock, storage } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.doc.visibilityState = 'hidden';
  win.doc.fire('visibilitychange');
  clock.t += 500;
  carry.leave(left({ frame: 9 * SR })); // another page of this tab
  win.doc.visibilityState = 'visible';
  win.doc.fire('visibilitychange');
  assert.equal(JSON.parse(storage.getItem(CARRY_KEY)).frame, 9 * SR);
});

// --- the Studio, the take page, going for the tape ----------------------------------

test('the Studio\'s own page is transparent: the Room\'s record stands, and nothing is wired', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.leave(left());
  const orig = carry.wire;
  let wired = 0;
  carry.wire = (...a) => { wired++; return orig(...a); };
  assert.equal(studioVisit(carry), 'transparent');
  assert.equal(wired, 0);
  assert.equal(win.target.count() + win.doc.count(), 0);
  clock.t += 20_000; // a while in the Studio
  const rec = carry.read();
  assert.equal(rec.take, 'jam_a.wav', 'back in the Room it is still there');
  assert.equal(rec.playing, true);
});

test('Room -> Studio by its tab -> Room: the take is still there, and has played on', async () => {
  const room = aCarry();
  const win = aWindow();
  room.carry.wire(win.target, win.doc, () => left({ frame: 10 * SR }));
  win.target.fire('pagehide'); // leaving the Room by the Studio tab
  studioVisit(room.carry);
  room.clock.t += 30_000;
  const s = aSource();
  const how = await room.carry.arrive(room.carry.peek(), { find: async () => s, load: () => s.src });
  assert.equal(how, 'playing');
  assert.equal(s.audio.currentTime, 40);
});

test('Room -> GRAB / Open in the Studio -> Room: the old take is not brought back', () => {
  const room = aCarry();
  const win = aWindow();
  room.carry.wire(win.target, win.doc, () => left());
  room.carry.forTheTape();
  win.target.fire('pagehide');
  studioVisit(room.carry);
  room.clock.t += 20_000;
  assert.equal(room.carry.peek(), null, 'the Studio was for the tape');
  assert.equal(room.storage.getItem(CARRY_KEY), null, 'and the mark is let go');
});

test('openTheTape (the take page\'s toasts) goes to the Studio for the tape: no take goes along', () => {
  const { carry, storage } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  let went = null;
  openTheTape({ carry, go: (u) => { went = u; } });
  win.target.fire('pagehide');
  assert.equal(went, '/tape.html');
  assert.equal(JSON.parse(storage.getItem(CARRY_KEY)).for, 'tape');
  assert.equal(carry.peek(), null);
});

test('the take page: opened and left alone it says nothing; played or moved it says where it is', () => {
  let now = { frame: 0, playing: false };
  const state = takePageState({ file: 'jam_a.wav', sr: SR, from: 0, now: () => now });
  assert.equal(state(), undefined, 'untouched');
  now = { frame: 3 * SR, playing: false };
  assert.deepEqual(state(), { take: 'jam_a.wav', frame: 3 * SR, sr: SR, playing: false });
  const b = takePageState({ file: 'jam_a.wav', sr: SR, from: 0, now: () => now });
  now = { frame: 0, playing: true };
  assert.equal(b().playing, true, 'played');
  now = { frame: 0, playing: false };
  assert.ok(b(), 'and paused again at the start: still touched');
});

test('the take page carries the Repeat flag of the Room\'s record for the same take; a different take does not', () => {
  const { carry } = aCarry();
  carry.leave(left({ take: 'jam_x.wav', loop: true }));
  assert.equal(carry.loopOf('jam_x.wav'), true);
  assert.equal(carry.loopOf('jam_y.wav'), undefined);
  const now = () => ({ frame: 5 * SR, playing: true });
  assert.equal(takePageState({ file: 'jam_x.wav', sr: SR, from: 0, now, loop: carry.loopOf('jam_x.wav') })().loop, true);
  assert.equal('loop' in takePageState({ file: 'jam_y.wav', sr: SR, from: 0, now, loop: carry.loopOf('jam_y.wav') })(), false);
});

test('Room (Repeat on) -> take page, played -> Room: Repeat is still on', async () => {
  const room = aCarry();
  room.carry.leave(left({ take: 'jam_a.wav', loop: true }));
  const page = aWindow();
  room.carry.wire(page.target, page.doc, takePageState({ file: 'jam_a.wav', sr: SR, from: 0, loop: room.carry.loopOf('jam_a.wav'), now: () => ({ frame: 4 * SR, playing: true }) }));
  page.target.fire('pagehide');
  room.clock.t += 1000;
  assert.equal(room.carry.read().loop, true);
});

test('loopOf is read-only and ignores a stale record, one for the tape, and garbage', () => {
  const { carry, clock, storage } = aCarry();
  carry.leave(left({ loop: true }));
  carry.loopOf('jam_a.wav');
  assert.ok(storage.getItem(CARRY_KEY), 'looking does not use it up');
  clock.t += CARRY_LIMIT_MS + 1;
  assert.equal(carry.loopOf('jam_a.wav'), undefined);
  assert.ok(storage.getItem(CARRY_KEY), 'nor let it go');
  storage.setItem(CARRY_KEY, 'junk');
  assert.equal(carry.loopOf('jam_a.wav'), undefined);
});

test('the take page left alone leaves the Room\'s record standing through its own pagehide', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.leave(left({ frame: 7 * SR }));
  carry.wire(win.target, win.doc, takePageState({ file: 'jam_a.wav', sr: SR, from: 0, now: () => ({ frame: 0, playing: false }) }));
  win.target.fire('pagehide');
  clock.t += 2000;
  assert.equal(carry.read().frame, 7 * SR);
});

test('a record is for the take it names: that one is loaded, and resumed at its frame', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ playing: false, frame: 12 * SR }));
  clock.t += 1_000;
  const s = aSource();
  const how = await carry.arrive(carry.read(), { find: async () => s, load: () => s.src });
  assert.equal(how, 'paused');
  assert.equal(s.audio.currentTime, 12);
});

test('a stale record is ignored: older than the limit', () => {
  const { carry, clock, storage } = aCarry();
  carry.leave(left());
  clock.t += CARRY_LIMIT_MS + 1;
  assert.equal(carry.read(), null);
  assert.equal(storage.getItem(CARRY_KEY), null, 'and let go');
});

test('a record just inside the limit is used', () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  clock.t += CARRY_LIMIT_MS - 1;
  assert.ok(carry.read());
});

test('a record dated in the future (the clock moved) is ignored', () => {
  const { carry, clock } = aCarry();
  clock.t += 60_000;
  carry.leave(left());
  clock.t -= 60_000;
  assert.equal(carry.read(), null);
});

test('garbage in the record is ignored, not thrown', () => {
  for (const raw of ['not json', '[]', '{"v":2}', '{"v":1,"take":"a","frame":"x","sr":48000,"playing":true,"at":1}',
    '{"v":1,"take":"","frame":1,"sr":48000,"playing":true,"at":1}', '{"v":1,"take":"a","frame":-5,"sr":48000,"playing":true,"at":1}']) {
    const storage = new Store();
    storage.setItem(CARRY_KEY, raw);
    const { carry } = aCarry({ storage });
    assert.equal(carry.read(), null, raw);
  }
});

test('a record is used once: a reload does not replay the same time away', () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  clock.t += 2_000;
  assert.ok(carry.read());
  assert.equal(carry.read(), null);
});

test('a bar holding no take lets the old record go', () => {
  const { carry } = aCarry();
  carry.leave(left());
  carry.leave(null);
  assert.equal(carry.read(), null);
});

test('storage that throws never reaches the page', () => {
  const bad = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
  const { carry } = aCarry({ storage: bad });
  assert.doesNotThrow(() => { carry.leave(left()); carry.forTheTape(); carry.drop(); carry.stashFrame(left()); });
  assert.equal(carry.read(), null);
  assert.equal(carry.takeStashedFrame('jam_a.wav'), null);
});

// --- the Studio keeps its tape -------------------------------------------------

test('going to the Studio for the tape (GRAB, Open in the Studio) leaves nothing to resume', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  carry.forTheTape();
  win.target.fire('pagehide');
  clock.t += 1_000;
  assert.equal(carry.read(), null, 'the tape is what the Studio\'s bar holds');
});

test('leaving any other way (a tab, a link) carries the take', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.target.fire('pagehide');
  clock.t += 1_000;
  assert.equal(carry.read().take, 'jam_a.wav');
});

test('the for-the-tape mark lets go after a while: a navigation that never happened', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  carry.forTheTape();
  clock.t += 30_000;
  win.target.fire('pagehide');
  assert.ok(carry.read(), 'a later leaving carries again');
});

test('the Studio\'s tape page lets any record go: its bar is the tape\'s', () => {
  const { carry } = aCarry();
  carry.leave(left());
  carry.drop();
  assert.equal(carry.read(), null);
});

test('a take carries into the Studio even with a tape loaded', () => {
  assert.equal(mayCarry({ studio: true, tapeLoaded: true }), true);
  assert.equal(mayCarry({ studio: true, tapeLoaded: false }), true);
  assert.equal(mayCarry({ studio: false, tapeLoaded: true }), true, 'the Listening Room');
});

// --- when it is written ----------------------------------------------------------

function aWindow() {
  const mk = () => {
    const l = {};
    return {
      addEventListener(ev, fn) { (l[ev] ??= []).push(fn); },
      fire(ev, e = {}) { for (const f of l[ev] || []) f(e); },
      count: () => Object.values(l).reduce((n, a) => n + a.length, 0),
    };
  };
  const target = mk(), doc = mk();
  doc.visibilityState = 'visible';
  return { target, doc };
}

test('it writes on pagehide, and on the page going hidden (iOS does not always pagehide)', () => {
  const { carry, storage } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.doc.visibilityState = 'visible';
  win.doc.fire('visibilitychange');
  assert.equal(storage.getItem(CARRY_KEY), null, 'not while visible');
  win.doc.visibilityState = 'hidden';
  win.doc.fire('visibilitychange');
  assert.ok(storage.getItem(CARRY_KEY), 'hidden');
  storage.removeItem(CARRY_KEY);
  win.target.fire('pagehide');
  assert.ok(storage.getItem(CARRY_KEY), 'pagehide');
});

test('a page that has not touched its take (state: undefined) leaves the last record as it was', () => {
  const { carry, clock } = aCarry();
  const win = aWindow();
  carry.leave(left({ frame: 12 * SR }));
  carry.wire(win.target, win.doc, () => undefined);
  win.target.fire('pagehide');
  clock.t += 3_000;
  assert.equal(carry.read().frame, 12 * SR);
});

test('a page restored from the back-forward cache lets its record go', () => {
  const { carry, storage } = aCarry();
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.target.fire('pagehide');
  win.target.fire('pageshow', { persisted: false });
  assert.ok(storage.getItem(CARRY_KEY), 'a first show leaves it');
  win.target.fire('pageshow', { persisted: true });
  assert.equal(storage.getItem(CARRY_KEY), null);
});

// --- no storage --------------------------------------------------------------------

test('no storage (blocked): nothing carried, no listener', () => {
  const carry = createCarry({ storage: null, now: () => T0 });
  const win = aWindow();
  carry.wire(win.target, win.doc, () => left());
  win.target.fire('pagehide');
  win.doc.visibilityState = 'hidden';
  win.doc.fire('visibilitychange');
  carry.leave(left());
  carry.forTheTape();
  carry.drop();
  assert.equal(carry.stashFrame(left()), null);
  assert.equal(carry.read(), null);
  assert.equal(carry.takeStashedFrame('jam_a.wav'), null);
  assert.equal(win.target.count() + win.doc.count(), 0, 'nothing listens');
  assert.deepEqual(carry.arrival('jam_a.wav', LEN), { frame: 0, left: 0, play: false, note: null }, 'Open starts nowhere');
});

// --- the browser refuses ----------------------------------------------------------

test('autoplay refused: the take lands at the frame it was left at, paused, and nothing throws', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  clock.t += 8_000;
  const refused = Object.assign(new Error('play() failed because the user didn\'t interact'), { name: 'NotAllowedError' });
  const { audio, src } = aSource({ refuse: refused });
  const how = await carry.resume(carry.read(), src);
  assert.equal(how, 'ready');
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 30, 'the same spot, not the spot it would have reached');
  assert.equal(src.playing(), false, 'the play control reads ▶');
});

test('autoplay refused, and the person has already moved the playhead: it stays where they put it', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  clock.t += 8_000;
  const { audio, src } = aSource({ refuse: Object.assign(new Error('x'), { name: 'NotAllowedError' }) });
  audio.play = async () => { audio.currentTime = 100; throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); };
  assert.equal(await carry.resume(carry.read(), src), 'ready');
  assert.equal(audio.currentTime, 100);
});

// --- the frame, for ✎ ---------------------------------------------------------------

test('frameNow is the take and frame the bar is at this moment', () => {
  const { carry, clock } = aCarry();
  const f = carry.frameNow(() => left({ frame: 44 * SR }));
  assert.deepEqual(f, { take: 'jam_a.wav', frame: 44 * SR, sr: SR, playing: true, at: clock.t });
  assert.equal(carry.frameNow(() => null), null, 'no take in the bar');
});

test('a stashed frame is the frame at the tap, whatever the gap between pages', () => {
  const { carry, clock } = aCarry();
  carry.stashFrame(left({ frame: 44 * SR }));
  clock.t += 20_000;
  const f = carry.takeStashedFrame('jam_a.wav');
  assert.equal(f.take, 'jam_a.wav');
  assert.equal(f.frame, 44 * SR, 'the gap does not move it');
  assert.equal(carry.takeStashedFrame('jam_a.wav'), null, 'used once');
});

test('a stashed frame expires on its own, shorter, limit and is separate from the hand-off record', () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  carry.stashFrame(left({ frame: 5 * SR }));
  assert.ok(FRAME_LIMIT_MS < CARRY_LIMIT_MS);
  clock.t += FRAME_LIMIT_MS + 1;
  assert.equal(carry.takeStashedFrame('jam_a.wav'), null);
  assert.ok(carry.read(), 'the hand-off record is still good');
});

test('a take that ended during the gap is never put in the bar', async () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 598 * SR }));
  clock.t += 10_000;
  const s = aSource({ seconds: 600 });
  let loaded = 0;
  const how = await carry.arrive(carry.read(), { find: async () => s, load: () => { loaded++; return s.src; } });
  assert.equal(how, 'gone');
  assert.equal(loaded, 0);
});

test('a stashed frame can be asked for by take: another take\'s is not handed over', () => {
  const { carry } = aCarry();
  carry.stashFrame(left({ frame: 5 * SR }));
  assert.equal(carry.takeStashedFrame('jam_b.wav'), null);
});

// --- F6: the stash's two nits ---------------------------------------------------------

test('a stashed frame is handed over only to a page that names its take', () => {
  const { carry } = aCarry();
  carry.stashFrame(left({ frame: 5 * SR }));
  assert.equal(carry.takeStashedFrame(), null, 'no take named: nobody\'s');
  assert.equal(carry.takeStashedFrame(''), null);
  assert.equal(carry.takeStashedFrame(null), null);
  assert.equal(carry.takeStashedFrame('jam_a.wav').frame, 5 * SR, 'and it was not used up by the asking');
});

test('a take that has ended stashes its last frame, not one past it', () => {
  const { carry } = aCarry();
  const f = carry.stashFrame(left({ frame: 600 * SR, length: 600 * SR }));
  assert.equal(f.frame, 600 * SR - 1);
  assert.equal(carry.takeStashedFrame('jam_a.wav').frame, 600 * SR - 1);
  assert.equal(carry.stashFrame(left({ frame: 10 * SR, length: 600 * SR })).frame, 10 * SR, 'mid-take frames are untouched');
  assert.equal(carry.stashFrame(left({ frame: 10 * SR })).frame, 10 * SR, 'no length known: as given');
});

test('frameNow carries the take\'s length so the stash can clamp', () => {
  const { carry } = aCarry();
  assert.equal(carry.frameNow(() => left({ frame: 5, length: 99 })).length, 99);
});

// --- F6: where Open starts ----------------------------------------------------------------

const LEN = 600 * SR;

test('Open with nothing left by the page before starts at the top, paused, with no note', () => {
  const { carry } = aCarry();
  assert.deepEqual(carry.arrival('jam_a.wav', LEN), { frame: 0, left: 0, play: false, note: null });
});

test('Open picks up where the bar was: its frame, plus the time away if it was playing', () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 30 * SR, playing: true }));
  clock.t += 8_000;
  assert.deepEqual(carry.arrival('jam_a.wav', LEN), { frame: 38 * SR, left: 30 * SR, play: true, note: null });
  const paused = aCarry();
  paused.carry.leave(left({ frame: 30 * SR, playing: false }));
  paused.clock.t += 8_000;
  assert.deepEqual(paused.carry.arrival('jam_a.wav', LEN), { frame: 30 * SR, left: 30 * SR, play: false, note: null });
});

test('Open leaves the record standing and ignores another take\'s', () => {
  const { carry } = aCarry();
  carry.leave(left());
  assert.equal(carry.arrival('jam_b.wav', LEN).frame, 0, 'the bar held another take');
  assert.ok(carry.read(), 'untouched: the page before\'s record is still there');
});

test('✎ arrives with the note at the frame that was heard, however long the gap and wherever play has got to', () => {
  const { carry, clock } = aCarry();
  carry.stashFrame(left({ frame: 44 * SR }));
  carry.leave(left({ frame: 44 * SR, playing: true }));
  clock.t += 20_000;
  const a = carry.arrival('jam_a.wav', LEN);
  assert.equal(a.note, 44 * SR, 'the note is at the tap');
  assert.equal(a.frame, 64 * SR, 'and the bar plays on');
  assert.equal(a.play, true);
  assert.equal(carry.arrival('jam_a.wav', LEN).note, null, 'the note is made once');
});

test('✎ on a bar that was paused: the page opens on the note\'s frame', () => {
  const { carry } = aCarry();
  carry.stashFrame(left({ frame: 44 * SR, playing: false }));
  assert.deepEqual(carry.arrival('jam_a.wav', LEN), { frame: 44 * SR, left: 44 * SR, play: false, note: 44 * SR });
});

test('another take\'s stash makes no note here, and a stash past the end is held inside the take', () => {
  const { carry } = aCarry();
  carry.stashFrame(left({ take: 'jam_b.wav', frame: 44 * SR }));
  assert.equal(carry.arrival('jam_a.wav', LEN).note, null);
  carry.stashFrame(left({ frame: 9 * LEN }));
  assert.equal(carry.arrival('jam_a.wav', 100).note, 99);
});

test('a take that played to its end while away opens at the top: the record is judged, nothing resumes', () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 598 * SR, playing: true }));
  clock.t += 10_000;
  assert.deepEqual(carry.arrival('jam_a.wav', LEN), { frame: 0, left: 0, play: false, note: null });
});

test('a refused sound leaves Open waiting at the frame the bar left, not the advanced one', async () => {
  const seeks = [];
  let at = 0;
  const seek = (f) => { seeks.push(f); at = f; };
  const arrival = { frame: 38 * SR, left: 30 * SR, play: true, note: null };
  const how = await startOpen(arrival, { seek, pos: () => at, play: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
  assert.equal(how, 'ready');
  assert.deepEqual(seeks, [38 * SR, 30 * SR]);
  // moved by the person meanwhile: theirs
  const s2 = [];
  let at2 = 0;
  await startOpen(arrival, { seek: (f) => { s2.push(f); at2 = f; }, pos: () => 99, play: async () => { throw new Error('x'); } });
  assert.deepEqual(s2, [38 * SR]);
  // accepted: stays where it is
  const s3 = [];
  assert.equal(await startOpen(arrival, { seek: (f) => s3.push(f), pos: () => 0, play: async () => {} }), 'playing');
  assert.deepEqual(s3, [38 * SR]);
  void at2;
});

test('arrival carries the frame the bar left as well as the one it plays on from', () => {
  const { carry, clock } = aCarry();
  carry.leave(left({ frame: 30 * SR, playing: true }));
  clock.t += 8_000;
  const a = carry.arrival('jam_a.wav', LEN);
  assert.equal(a.frame, 38 * SR);
  assert.equal(a.left, 30 * SR);
});
