// The bar's hand-off between pages (docs/superpowers/plans/2026-10-15-f4.md):
// stand-ins for sessionStorage, the audio element, the clock and the page's
// events, and the real take source on top of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARRY_KEY, FRAME_KEY, CARRY_LIMIT_MS, FRAME_LIMIT_MS, createCarry, resumeAt, mayCarry,
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
  const carry = createCarry({ storage, now: () => clock.t, enabled: () => over.enabled ?? true });
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

test('a record for a take the page does not hold is ignored, and gone', async () => {
  const { carry, storage } = aCarry();
  carry.leave(left({ take: 'jam_gone.wav' }));
  const rec = carry.read();
  let loaded = 0;
  const how = await carry.arrive(rec, { find: async (n) => (n === 'jam_a.wav' ? aSource() : null), load: () => { loaded++; } });
  assert.equal(how, 'gone');
  assert.equal(loaded, 0, 'nothing put in the bar');
  assert.equal(storage.getItem(CARRY_KEY), null);
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
  assert.equal(carry.takeStashedFrame(), null);
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

test('a take does not displace the tape on the Studio: only with no tape loaded', () => {
  assert.equal(mayCarry({ studio: true, tapeLoaded: true }), false);
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

// --- the flag --------------------------------------------------------------------

test('rooms off: nothing written, nothing read, no listener', () => {
  const storage = new Store();
  storage.setItem(CARRY_KEY, JSON.stringify({ v: 1, take: 'jam_a.wav', frame: 1, sr: SR, playing: true, at: T0 }));
  storage.setItem(FRAME_KEY, JSON.stringify({ v: 1, take: 'jam_a.wav', frame: 1, sr: SR, at: T0 }));
  storage.reads = 0; storage.writes = 0;
  const { carry } = aCarry({ storage, enabled: false });
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
  assert.equal(carry.takeStashedFrame(), null);
  assert.equal(win.target.count() + win.doc.count(), 0, 'nothing listens');
  assert.equal(storage.reads, 0, 'nothing read');
  assert.equal(storage.writes, 0, 'nothing written');
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
  const f = carry.takeStashedFrame();
  assert.equal(f.take, 'jam_a.wav');
  assert.equal(f.frame, 44 * SR, 'the gap does not move it');
  assert.equal(carry.takeStashedFrame(), null, 'used once');
});

test('a stashed frame expires on its own, shorter, limit and is separate from the hand-off record', () => {
  const { carry, clock } = aCarry();
  carry.leave(left());
  carry.stashFrame(left({ frame: 5 * SR }));
  assert.ok(FRAME_LIMIT_MS < CARRY_LIMIT_MS);
  clock.t += FRAME_LIMIT_MS + 1;
  assert.equal(carry.takeStashedFrame(), null);
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
