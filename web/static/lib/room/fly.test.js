// The flight of a take from its spine to the deck (fly.js, ghost.js), run on
// stand-ins: a document, a ticker on a clock the test moves, timers the test
// fires. It flies alongside the sound and never in front of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { Ticker } from '../objects/motion.js';
import { createFlights, LAND_MS, REMEASURE_MS } from './fly.js';
import { SEAT_AT } from '../scene/choreo.js';

const box = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });

function stage({ reduced = false, spines = { 'a.wav': box(1000, 330, 30, 112), 'b.wav': box(1040, 330, 30, 112) }, target = { x: 300, y: 380, w: 180, h: 113 } } = {}) {
  const doc = fakeDoc();
  const host = doc.createElement('div');
  doc.body.append(host);
  const clock = { now: 0, raf: [], timers: [] };
  const ticker = new Ticker({ raf: (fn) => { clock.raf.push(fn); return clock.raf.length; }, cancel: () => {}, now: () => clock.now, reduced: false });
  const errors = [];
  const els = {};
  for (const [k, r] of Object.entries(spines)) {
    const b = doc.createElement('button');
    b.className = 'room-cassette stripe-2 on-deck';
    b.setAttribute('data-key', `take:${k}`);
    b.id = `spine-${k}`;
    b.append(doc.createElement('span'));
    b.getBoundingClientRect = () => els[k].rect;
    els[k] = b;
    b.rect = r;
  }
  const win = { innerWidth: 1440, innerHeight: 900, l: {}, addEventListener(t, f) { (this.l[t] ??= new Set()).add(f); }, removeEventListener(t, f) { this.l[t]?.delete(f); } };
  const landed = [];
  const state = { reduced, target, doc };
  doc.visibilityState = 'visible';
  const fire = () => {
    // timers due by clock.now, in order
    for (const t of [...clock.timers].sort((a, b) => a.at - b.at)) if (t.at <= clock.now) { clock.timers = clock.timers.filter((x) => x !== t); t.fn(); }
  };
  const flights = createFlights({
    doc, win, host,
    reduced: () => state.reduced,
    spine: (key) => els[key.replace(/^take:/, '')] || null,
    target: () => state.target,
    face: (key) => ({ name: key, stripe: '2' }),
    onLand: (key) => landed.push(key),
    ticker,
    timers: { set: (fn, ms) => { const t = { fn, at: clock.now + ms }; clock.timers.push(t); return t; }, clear: (t) => { clock.timers = clock.timers.filter((x) => x !== t); } },
    onError: (e) => errors.push(e),
  });
  // Advance the clock, running a frame per 16 ms and firing the timers that fall due.
  const run = (ms, { frames = true } = {}) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + 16);
      if (frames) { const q = clock.raf.splice(0); for (const f of q) f(); }
      fire();
    }
  };
  const ghosts = () => host.querySelectorAll('.room-carry');
  return { doc, host, win, ticker, clock, flights, landed, errors, state, els, run, ghosts, fire };
}

const key = (k) => `take:${k}`;

test('a flight puts a ghost of the spine over the room, and the ghost is no second button', () => {
  const s = stage();
  assert.equal(s.flights.launch(key('a.wav')), 'flew');
  const [g] = s.ghosts();
  assert.ok(g, 'a ghost is in the air');
  assert.equal(g.querySelectorAll('[data-key]').length, 0, 'it carries no key of the button it copies');
  assert.equal(g.querySelectorAll('[id]').length, 0, 'nor its id');
  assert.equal(g.hasAttribute('inert'), true, 'it takes no input');
  assert.equal(s.flights.active(), key('a.wav'));
  assert.equal(s.els['a.wav'].getAttribute('data-key'), 'take:a.wav', 'the shelf keeps its own spine as it was');
  assert.ok(s.ticker.running, 'on the shared ticker');
});

test('the ghost moves with the frames, from the spine to the target, in real time', () => {
  const s = stage();
  s.flights.launch(key('a.wav'));
  const [g] = s.ghosts();
  s.run(16);
  const first = g.style.transform;
  assert.match(first, /translate3d\(1015\.00px/, 'it starts at the spine’s centre (x 1000 + 15)');
  s.run(SEAT_AT - 32);
  assert.notEqual(g.style.transform, first, 'it has moved');
  s.run(16);
  assert.match(g.style.transform, /translate3d\(390\.00px, 436\.50px/, 'it ends at the target’s centre');
});

test('it lands on the clock without a frame: no ghost, no frame asked for, the page told once', () => {
  const s = stage();
  s.flights.launch(key('a.wav'));
  s.run(LAND_MS + 20, { frames: false }); // a hidden tab: the ticker never ran
  assert.equal(s.ghosts().length, 0);
  assert.deepEqual(s.landed, [key('a.wav')]);
  assert.equal(s.flights.active(), null);
});

test('idle costs nothing: after it lands no step, no frame, no timer and no listener is left', () => {
  const s = stage();
  s.flights.launch(key('a.wav'));
  assert.ok(s.win.l.pagehide.size === 1 && s.clock.timers.length > 0);
  s.run(LAND_MS + 20);
  assert.equal(s.ticker.steps.size, 0, 'off the shared ticker');
  assert.equal(s.ticker.running, false);
  assert.equal(s.clock.timers.length, 0);
  assert.equal(s.win.l.pagehide.size, 0);
  assert.equal(s.doc.listenerCount('visibilitychange'), 0);
});

test('a second tap lands the first at once and flies the new take from its own spine, alone', () => {
  const s = stage();
  s.flights.launch(key('a.wav'));
  s.run(300);
  assert.equal(s.flights.launch(key('b.wav')), 'flew');
  assert.equal(s.ghosts().length, 1, 'one thing in the air');
  assert.equal(s.flights.active(), key('b.wav'));
  s.run(16);
  assert.match(s.ghosts()[0].style.transform, /translate3d\(1055\.00px/, 'it begins at b’s spine, not where a had got to');
  s.run(LAND_MS + 20);
  assert.deepEqual(s.landed, [key('b.wav')], 'a never lands: it was cut short, and b’s landing is the only one');
  assert.equal(s.ghosts().length, 0);
});

test('a pause, a navigation or a tab put away takes it out of the air with no landing', () => {
  for (const how of ['cancel', 'pagehide', 'hidden']) {
    const s = stage();
    s.flights.launch(key('a.wav'));
    s.run(200);
    if (how === 'cancel') s.flights.cancel();
    else if (how === 'pagehide') for (const f of [...s.win.l.pagehide]) f({ type: 'pagehide' });
    else { s.doc.visibilityState = 'hidden'; s.doc.dispatchEvent({ type: 'visibilitychange' }); }
    assert.equal(s.ghosts().length, 0, how);
    assert.equal(s.flights.active(), null, how);
    assert.equal(s.ticker.steps.size, 0, how);
    assert.equal(s.clock.timers.length, 0, `${how}: no timer left to land it`);
    s.run(LAND_MS + 20);
    assert.deepEqual(s.landed, [], `${how}: it did not land`);
  }
});

test('a pause or an end of the flighted take\u2019s own sound takes it out of the air, with no landing and no listener left', () => {
  for (const ev of ['pause', 'ended']) {
    const s = stage();
    const audio = { l: {}, addEventListener(t, f) { (this.l[t] ??= new Set()).add(f); }, removeEventListener(t, f) { this.l[t]?.delete(f); } };
    s.flights.launch(key('a.wav'), { audio });
    s.run(300);
    for (const f of [...audio.l[ev]]) f({ type: ev });
    assert.equal(s.ghosts().length, 0, ev);
    assert.equal(s.flights.active(), null, ev);
    assert.equal(s.clock.timers.length, 0, `${ev}: no timer left to land it`);
    assert.equal((audio.l.pause?.size || 0) + (audio.l.ended?.size || 0), 0, `${ev}: no listener left on the audio`);
    s.run(LAND_MS + 20);
    assert.deepEqual(s.landed, [], `${ev}: it did not land`);
  }
});

test('with reduced motion nothing flies: no ghost, no frame, no timer, no listener', () => {
  const s = stage({ reduced: true });
  assert.equal(s.flights.launch(key('a.wav')), 'reduced');
  assert.equal(s.ghosts().length, 0);
  assert.equal(s.ticker.steps.size, 0);
  assert.equal(s.clock.timers.length, 0);
  assert.equal(s.win.l.pagehide?.size ?? 0, 0);
  assert.deepEqual(s.landed, [], 'there was no landing to hear of: the deck is the page’s to change');
});

test('with nothing to fly from or to, or a spine off the screen, nothing flies', () => {
  const none = stage();
  assert.equal(none.flights.launch(key('zzz.wav')), 'no spine', 'a take with no spine on the page (a row of the List)');
  const hidden = stage({ spines: { 'a.wav': box(0, 0, 0, 0) } });
  assert.equal(hidden.flights.launch(key('a.wav')), 'no spine', 'a shelf that is not drawn');
  const off = stage({ spines: { 'a.wav': box(-400, 300, 30, 112) } });
  assert.equal(off.flights.launch(key('a.wav')), 'no spine', 'scrolled out of the shelf');
  const nowhere = stage({ target: null });
  assert.equal(nowhere.flights.launch(key('a.wav')), 'no target');
  for (const s of [none, hidden, off, nowhere]) {
    assert.equal(s.ghosts().length, 0);
    assert.equal(s.ticker.steps.size, 0);
    assert.equal(s.clock.timers.length, 0);
  }
});

test('a flight that breaks says so and leaves nothing: launch never throws into the tap', () => {
  const s = stage();
  const bad = createFlights({
    doc: s.doc, win: s.win, host: s.host, spine: (k) => s.els[k.replace(/^take:/, '')], target: () => s.state.target,
    face: () => { throw new Error('no face'); }, ticker: s.ticker, onError: (e) => s.errors.push(e),
    timers: { set: () => ({}), clear: () => {} },
  });
  assert.equal(bad.launch(key('a.wav')), 'error');
  assert.equal(s.errors.length, 1);
  assert.equal(s.ghosts().length, 0);
  assert.equal(s.ticker.steps.size, 0);
  assert.equal(s.win.l.pagehide?.size ?? 0, 0);
});

test('where it is going is measured again as it sets off to fly, so a bar that has settled is the one it lands on', () => {
  const s = stage();
  s.flights.launch(key('a.wav'));
  s.state.target = { x: 100, y: 700, w: 72, h: 46 };
  s.run(REMEASURE_MS + 16);
  s.run(SEAT_AT - REMEASURE_MS);
  s.run(16);
  assert.equal(s.ghosts().length, 1, 'still in the air');
  assert.match(s.ghosts()[0].style.transform, /translate3d\(136\.00px, 723\.00px/, 'at the new target’s centre');
});

test('a flight that breaks half way leaves nothing: no ghost, no listener, no timer, no frame', () => {
  const s = stage();
  let n = 0;
  const flaky = createFlights({
    doc: s.doc, win: s.win, host: s.host, spine: (k) => s.els[k.replace(/^take:/, '')], target: () => s.state.target,
    face: () => ({ name: 'x', stripe: '1' }), ticker: s.ticker, onError: (e) => s.errors.push(e),
    timers: { set: (fn, ms) => { if (++n === 2) throw new Error('no timer'); return s.clock.timers.push({ fn, at: ms }) && s.clock.timers.at(-1); }, clear: (t) => { s.clock.timers = s.clock.timers.filter((x) => x !== t); } },
  });
  assert.equal(flaky.launch(key('a.wav')), 'error');
  assert.equal(s.ghosts().length, 0);
  assert.equal(s.win.l.pagehide.size, 0);
  assert.equal(s.doc.listenerCount('visibilitychange'), 0);
  assert.equal(s.clock.timers.length, 0);
  assert.equal(s.ticker.steps.size, 0);
  assert.equal(flaky.active(), null);
});
