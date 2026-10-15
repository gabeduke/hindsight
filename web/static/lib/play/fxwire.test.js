// web/static/lib/play/fxwire.test.js
// The FX, the bend and the mods as the strip wires them: drawn into a
// stand-in for the few DOM calls fx.js and mods.js make, played by pointer
// events, and heard through a fake socket -- what reaches the Pi, in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wireFX } from './fxwire.js';
import { Surface } from './surface.js';
import { connect } from './link.js';
import { bindTouch } from './keymap.js';
import { Amounts, EVERY_MS } from './amounts.js';
import { FarPads } from './far.js';
import { SLIDE_PX, BEND_PX } from './fx.js';
import { KNOB_PX } from './mods.js';

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.children = [];
    this.parent = null;
    this.hidden = false;
    this.dataset = {};
    this.style = {};
    this.attrs = new Map();
    this.listeners = new Map();
    this.text = '';
  }
  get classList() {
    const has = (c) => this.className.split(/\s+/).includes(c);
    const set = (c, on) => {
      const cs = this.className.split(/\s+/).filter((x) => x && x !== c);
      if (on) cs.push(c);
      this.className = cs.join(' ');
    };
    return {
      contains: has,
      add: (c) => set(c, true),
      remove: (c) => set(c, false),
      toggle: (c, on = !has(c)) => { set(c, !!on); return !!on; },
    };
  }
  set textContent(t) { this.text = String(t); this.children = []; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  append(...ns) {
    for (const n of ns) {
      const node = typeof n === 'string' ? Object.assign(new El('#text'), { text: n }) : n;
      node.parent = this;
      this.children.push(node);
    }
  }
  after(n) {
    const i = this.parent.children.indexOf(this);
    n.parent = this.parent;
    this.parent.children.splice(i + 1, 0, n);
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  replaceChildren(...ns) { this.children = []; this.append(...ns); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  addEventListener(t, fn) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(fn); }
  removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); }
  focus() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  /** fire plays an event on this element, a pointer's by default. */
  fire(type, e = {}) {
    const ev = { pointerId: 1, clientX: 0, clientY: 0, target: this, preventDefault() {}, stopPropagation() {}, ...e };
    for (const fn of [...(this.listeners.get(type) || [])]) fn(ev);
  }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelectorAll(sel) {
    const want = sel.split('.').filter(Boolean);
    return [...this.walk()].filter((n) => want.every((c) => n.className.split(/\s+/).includes(c)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const doc = { createElement: (tag) => new El(tag) };

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + ms, fn }; timers.push(x); return x; },
    clearTimer: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); },
    advance(ms) {
      t += ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

/** A socket the test plays the Pi through. */
function fakeSockets() {
  const made = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; made.push(this); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    hear(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  }
  return { FakeWS, made };
}

/**
 * strip is the FX and the mods as strip.js wires them, on a fake page:
 * the pads drawn as screen.js's addPad draws them (touch-played), a fake
 * socket, a hand-moved clock, and a fetch that answers the PATCHes.
 */
function strip({ fetchOk = true } = {}) {
  const clock = fakeTime();
  const surface = new Surface({ bpm: 120, originMs: 0, division: 'off' });
  const { FakeWS, made } = fakeSockets();
  let link = null;
  const amounts = new Amounts({ send: (id, v) => link?.set(id, v), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const far = new FarPads();
  link = connect(surface, { WebSocketImpl: FakeWS, url: 'x', now: clock.now, amountOf: (pad) => amounts.get(pad) });
  const slots = { fx: doc.createElement('div'), mods: doc.createElement('div') };
  const pads = new Map();
  const ui = {
    slot: (n) => slots[n] || null,
    addPad(parent, id, cls) {
      const b = doc.createElement('button');
      b.className = `play-pad ${cls}`;
      b.dataset.pad = id;
      const face = doc.createElement('span');
      face.className = 'play-face';
      face.textContent = id.toUpperCase();
      b.append(face);
      parent.append(b);
      bindTouch(surface, b, id, { now: clock.now });
      pads.set(id, b);
      return b;
    },
  };
  const patches = [];
  const notes = [];
  const fetchImpl = async (url, init) => {
    patches.push(JSON.parse(init.body));
    sock().sent.push({ PATCH: JSON.parse(init.body) }); // in the socket's order
    return { ok: fetchOk, status: fetchOk ? 200 : 500, json: async () => (fetchOk ? { tape: { style: {} } } : { error: 'no' }) };
  };
  const sock = () => made[0];
  const wire = wireFX({
    ui, surface, link, amounts, far, doc, fetchImpl,
    tapeId: () => 't1', onNote: (t) => notes.push(t),
    modsOptions: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer },
  });
  return { clock, surface, amounts, wire, sock, pads, slots, patches, notes, far };
}

const settle = () => new Promise((r) => setImmediate(r));

test('a finger on FILTER presses it with its amount, slides it up as sets, and lets it go', () => {
  const s = strip();
  const pad = s.pads.get('filter');
  pad.fire('pointerdown', { clientY: 100 });
  s.clock.advance(EVERY_MS);
  pad.fire('pointermove', { clientY: 100 - SLIDE_PX / 4 }); // up a quarter: 0.75
  s.clock.advance(EVERY_MS);
  pad.fire('pointerup', { clientY: 100 - SLIDE_PX / 4 });
  assert.deepEqual(s.sock().sent, [
    { t: 'press', pad: 'filter', q: 'now', v: 0.5 },
    { t: 'set', pad: 'filter', v: 0.75 },
    { t: 'release', pad: 'filter' },
  ]);
});

test('a knob dragged is heard as sets, saved as one PATCH when it lifts, and then its preview goes', async () => {
  const s = strip();
  const knob = s.slots.mods.querySelector('.play-knob');
  assert.equal(knob.dataset.mod, 'mod.wow');
  knob.fire('pointerdown', { clientY: 200 });
  s.clock.advance(EVERY_MS);
  knob.fire('pointermove', { clientY: 200 - KNOB_PX / 2 });
  s.clock.advance(EVERY_MS);
  knob.fire('pointerup', { clientY: 200 - KNOB_PX / 2 });
  await settle();
  assert.deepEqual(s.sock().sent, [
    { t: 'set', pad: 'mod.wow', v: 0.5 },
    { PATCH: { style: { wow: 0.5 } } },
    { t: 'release', pad: 'mod.wow' },
  ]);
});

test('the bend is pressed as it leaves the centre, moved, let go as it springs back, and lit while held', () => {
  const s = strip();
  const bend = s.slots.fx.querySelector('.play-bend');
  bend.fire('pointerdown', { clientX: 300 });
  bend.fire('pointermove', { clientX: 300 + BEND_PX / 2 });
  assert.equal(bend.classList.contains('on'), true);
  assert.equal(s.wire.bending, true);
  s.clock.advance(EVERY_MS);
  bend.fire('pointermove', { clientX: 300 - BEND_PX });
  bend.fire('pointerup', { clientX: 300 - BEND_PX });
  assert.deepEqual(s.sock().sent, [
    { t: 'press', pad: 'bend', q: 'now', v: 0.5 },
    { t: 'set', pad: 'bend', v: -1 },
    { t: 'release', pad: 'bend' },
  ]);
  assert.equal(bend.classList.contains('on'), false);
  assert.equal(s.wire.bending, false);
});

test('while a mixdown plays the FX wait, and say so', () => {
  const s = strip();
  const group = s.slots.fx.querySelector('.play-fx-group');
  s.wire.setMixdown('playing');
  assert.equal(group.classList.contains('play-fx-waiting'), true);
  assert.match(s.slots.fx.querySelector('.play-fx-note').textContent, /mixdown/);
  s.wire.setMixdown('');
  assert.equal(group.classList.contains('play-fx-waiting'), false);
});
