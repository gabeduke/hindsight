import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Carry, BUZZ_MS, remember, recall, EJECT_FRESH_MS } from './carry.js';
import { Ticker } from '../objects/motion.js';
import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { HIFI_MODELS } from './hifi.js';
import { HOLD, SEAT_AT, SEATED, EJECT_MS } from '../scene/choreo.js';

const from = { x: 1000, y: 330, w: 30, h: 112 };
const to = { x: 400, y: 390, w: 180, h: 90 };
const TAKE = Object.freeze({ kind: 'take', key: 'take:a.wav', name: 'a' });

// One clock for everything: the ticker's frames, and the timers. A frame
// is drawn only when the test says so, so "no frame drawn" is something a
// test can arrange.
function rig({ reduced = false } = {}) {
  let now = 0;
  let frames = [];
  let timers = [];
  let id = 0;
  const ticker = new Ticker({ raf: (fn) => { frames.push(fn); return frames.length; }, cancel: () => { frames = []; }, now: () => now, reduced, onError: (e) => { throw e; } });
  const scene = new Scene({ ticker, models: HIFI_MODELS, onError: (e) => { throw e; } });
  scene.start();
  const deck = scene.add(new SceneObject('deck', 'deck', { door: 'open', travel: 90, playing: false, loaded: null }));
  const log = [];
  const fades = [];
  const carry = new Carry({
    scene, deck,
    attach: (c) => { log.push(`draw ${c.key}`); return () => log.push(`undraw ${c.key}`); },
    fade: (update) => { fades.push(update); update(); },
    vibrate: (ms) => log.push(`buzz ${ms}`),
    timers: {
      set: (fn, ms) => { const h = ++id; timers.push({ h, at: now + ms, fn }); return h; },
      clear: (h) => { timers = timers.filter((x) => x.h !== h); },
    },
  });
  return {
    scene, deck, carry, log, fades, ticker,
    get now() { return now; },
    /** wait lets `ms` pass with the timers firing and no frame drawn. */
    wait(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
    /** frame lets `ms` pass and draws one frame at the end of it. */
    frame(ms) {
      this.wait(ms);
      const due = frames;
      frames = [];
      for (const fn of due) fn(now);
    },
    flight: () => scene.get(`flight:${TAKE.key}`),
  };
}

test('the sound starts before the picture changes: the deck is still open when it does', () => {
  const r = rig();
  const seen = [];
  r.carry.put(TAKE.key, {
    from, to, face: TAKE,
    onSeat: () => seen.push([r.deck.state.door, r.deck.state.loaded, r.log.includes(`buzz ${BUZZ_MS}`)]),
  });
  r.wait(SEAT_AT);
  assert.deepEqual(seen, [['open', null, false]], 'the sound, then the door, the face and the buzz');
  assert.equal(r.deck.state.door, 'shut');
});

test('the sound starts at SEAT with no frame drawn at all', () => {
  const r = rig();
  const sounds = [];
  r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => sounds.push(r.now) });
  r.wait(SEAT_AT - 1);
  assert.deepEqual(sounds, []);
  r.wait(1);
  assert.deepEqual(sounds, [SEAT_AT], 'at 920 ms, on the clock');
  assert.equal(r.deck.state.door, 'shut');
  assert.equal(r.deck.state.loaded, TAKE);
  assert.ok(r.log.includes(`buzz ${BUZZ_MS}`));
  r.wait(2000);
  assert.deepEqual(sounds, [SEAT_AT], 'and only once');
  assert.equal(r.flight(), null, 'the flight is over');
});

test('from the hold, SEAT is 620 ms after PUT IT ON, whatever the frames did', () => {
  const r = rig();
  const sounds = [];
  r.carry.pick(TAKE.key, { from });
  r.frame(16); r.frame(400); // pulled out, held
  assert.equal(r.flight().view.t, HOLD);
  r.wait(5000); // the card is open a while
  const pressed = r.now;
  r.carry.put(TAKE.key, { to, face: TAKE, onSeat: () => sounds.push(r.now - pressed) });
  r.frame(16);
  r.frame(700); // a long frame across SEAT: the phone was busy
  assert.deepEqual(sounds, [SEAT_AT - HOLD], 'the sound didn’t wait for the frame');
  assert.equal(r.flight(), null, 'at the window: the deck has it now');
  assert.equal(r.deck.state.door, 'shut');
});

test('one thing in flight: a second pick lands the first at once, sound and all, then starts', () => {
  const r = rig();
  const sounds = [];
  r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => sounds.push('a') });
  r.frame(16); r.frame(300);
  const b = r.carry.pick('take:b.wav', { from: { ...from, x: 1040 } });
  assert.deepEqual(sounds, ['a'], 'the first went in, and its sound started');
  assert.equal(r.deck.state.loaded, TAKE);
  assert.equal(r.flight(), null);
  assert.equal(r.carry.current, b);
  assert.equal(b.goal, 'out');
  r.wait(3000);
  assert.deepEqual(sounds, ['a'], 'its timers are gone with it');
  assert.ok(r.log.indexOf(`undraw ${TAKE.key}`) < r.log.indexOf('draw take:b.wav'));
});

test('a second pick while the first is held out puts the first back', () => {
  const r = rig();
  r.carry.pick(TAKE.key, { from });
  r.frame(16); r.frame(400);
  r.carry.pick('take:b.wav', { from });
  assert.equal(r.flight(), null);
  assert.equal(r.carry.current.key, 'take:b.wav');
});

test('closing the card puts it back; picking it again on the way turns it round', () => {
  const r = rig();
  const c = r.carry.pick(TAKE.key, { from });
  r.frame(16); r.frame(400);
  assert.equal(r.carry.putBack(TAKE.key), true);
  r.frame(16); r.frame(50);
  assert.ok(r.flight().view.t < HOLD);
  assert.equal(r.carry.pick(TAKE.key, { from }), c, 'the same thing, turned round');
  r.wait(1000);
  assert.ok(r.flight(), 'not landed: it was picked again');
  r.frame(16); r.frame(400);
  assert.equal(r.flight().view.t, HOLD);
  r.carry.putBack(TAKE.key);
  r.wait(400);
  assert.equal(r.flight(), null);
  assert.equal(r.carry.current, null);
});

test('eject stops the sound at the press, opens the door, and is home in 700 ms', () => {
  const r = rig();
  r.deck.set({ door: 'shut', loaded: TAKE, playing: true });
  const order = [];
  r.carry.eject(TAKE.key, { from, to, face: TAKE, under: null, onStop: () => order.push(['stop', r.now]), onLand: () => order.push(['home', r.now]) });
  assert.deepEqual(order, [['stop', 0]]);
  assert.equal(r.deck.state.door, 'open');
  assert.equal(r.deck.state.loaded, null);
  assert.equal(r.flight().view.t, SEATED, 'it leaves from the deck');
  r.wait(EJECT_MS);
  assert.deepEqual(order, [['stop', 0], ['home', EJECT_MS]]);
  assert.equal(r.flight(), null);
});

test('ejecting a take off a tape shows the tape again, door shut', () => {
  const r = rig();
  const TAPE = Object.freeze({ kind: 'tape', key: 'tape:t1' });
  r.deck.set({ door: 'shut', loaded: TAKE });
  r.carry.eject(TAKE.key, { from, to, under: TAPE });
  assert.equal(r.deck.state.loaded, TAPE);
  r.wait(EJECT_MS);
  assert.equal(r.deck.state.door, 'shut');
});

test('eject mid-flight lands the one going in first, then takes it out', () => {
  const r = rig();
  const order = [];
  r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => order.push('sound'), onLand: () => order.push('in') });
  r.wait(400);
  r.carry.eject(TAKE.key, { from, to, face: TAKE, onStop: () => order.push('stop') });
  assert.deepEqual(order, ['sound', 'in', 'stop']);
  assert.equal(r.flight().state.goal, 'shelf');
});

test('reduced motion: no flight and no buzz; the sound now; the change in one cross-fade', () => {
  const r = rig({ reduced: true });
  const sounds = [];
  r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => sounds.push(r.now) });
  assert.deepEqual(sounds, [0], 'SEAT is now');
  assert.equal(r.flight(), null);
  assert.equal(r.fades.length, 1);
  assert.equal(r.deck.state.loaded, TAKE);
  assert.ok(!r.log.some((l) => l.startsWith('buzz')));
  r.carry.eject(TAKE.key, { from, to, face: TAKE, onStop: () => sounds.push('stop') });
  assert.equal(r.flight(), null);
  assert.equal(r.fades.length, 2);
  assert.equal(r.deck.state.loaded, null);
});

test('reduced motion switched on in mid-flight: the sound still starts at SEAT, with no buzz', () => {
  const r = rig();
  const sounds = [];
  r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => sounds.push(r.now) });
  r.wait(300);
  r.ticker.reduced = true;
  r.wait(SEAT_AT);
  assert.deepEqual(sounds, [SEAT_AT]);
  assert.ok(!r.log.some((l) => l.startsWith('buzz')));
});

test('reduced motion: a held pick is put in the deck by the same cross-fade', () => {
  const r = rig({ reduced: true });
  r.carry.pick(TAKE.key, { from });
  r.frame(16);
  assert.equal(r.flight().view.t, HOLD, 'shown pulled out at once');
  r.carry.put(TAKE.key, { to, face: TAKE });
  assert.equal(r.flight(), null);
  assert.equal(r.carry.current, null);
});

test('a callback that throws is reported, and the move still lands', () => {
  const r = rig();
  const errors = [];
  const was = globalThis.reportError;
  globalThis.reportError = (e) => errors.push(e.message);
  try {
    r.carry.put(TAKE.key, { from, to, face: TAKE, onSeat: () => { throw new Error('no audio'); } });
    r.wait(SEATED);
  } finally {
    globalThis.reportError = was;
  }
  assert.deepEqual(errors, ['no audio']);
  assert.equal(r.deck.state.loaded, TAKE);
  assert.equal(r.flight(), null);
});


function memory() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('the chair’s eject is remembered once, and only while it’s fresh', () => {
  const store = memory();
  remember('take:a.wav', { left: 300, top: 120, width: 400, height: 180 }, { store, now: 1000 });
  assert.deepEqual(recall({ store, now: 1500 }), { key: 'take:a.wav', rect: { x: 300, y: 120, w: 400, h: 180 } });
  assert.equal(recall({ store, now: 1600 }), null, 'once');
  remember('take:a.wav', { x: 1, y: 2, w: 3, h: 4 }, { store, now: 1000 });
  assert.equal(recall({ store, now: 1000 + EJECT_FRESH_MS }), null, 'stale');
  store.setItem('hindsight.room.eject', '{not json');
  assert.equal(recall({ store, now: 0 }), null);
  remember('take:a.wav', { x: 1, y: 2, w: 0, h: 4 }, { store, now: 0 });
  assert.equal(recall({ store, now: 0 }), null, 'nothing to fly from');
  assert.equal(recall({ store: null }), null);
});

test('with nowhere to fly from or to, it is the cross-fade, sound now, even with motion', () => {
  const r = rig();
  const sounds = [];
  r.carry.put(TAKE.key, { from: null, to, face: TAKE, onSeat: () => sounds.push(r.now) });
  assert.deepEqual(sounds, [0]);
  assert.equal(r.flight(), null);
  assert.equal(r.fades.length, 1);
  r.carry.put('take:b.wav', { from, to: null, face: TAKE, onSeat: () => sounds.push('b') });
  assert.deepEqual(sounds, [0, 'b'], 'the deck hidden: no flight to nowhere');
  r.carry.eject(TAKE.key, { from: null, to, onStop: () => sounds.push('stop') });
  assert.equal(r.flight(), null);
  assert.equal(r.fades.length, 3);
});

test('anything landing tells the page, so the shelves can show the slot filled', () => {
  const r = rig();
  let settled = 0;
  r.carry.onSettle = () => settled++;
  r.carry.pick(TAKE.key, { from });
  r.carry.putBack(TAKE.key);
  r.wait(1000);
  assert.equal(settled, 1);
});
