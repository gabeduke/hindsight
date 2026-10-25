// The bar's fold (fold.js): the grabber on its top edge folds it and
// unfolds it with a tap, a drag down folds it and a drag up unfolds it, the
// click a drag's lift sends is not also a tap, and it stays folded for the
// visit. On a phone the grabber is the player's, and folds nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initFold, NP_FOLD_KEY, slideFrom } from './fold.js';
import { GESTURE } from '../ui/press.js';

class MockStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

function el(id) {
  const attrs = new Map();
  const on = new Map();
  const classes = new Set();
  return {
    id,
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { const v = force ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; },
    },
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    addEventListener: (ev, fn) => { (on.get(ev) || on.set(ev, []).get(ev)).push(fn); },
    removeEventListener: (ev, fn) => { on.set(ev, (on.get(ev) || []).filter((f) => f !== fn)); },
    fire: (ev, e = {}) => { for (const fn of on.get(ev) || []) fn({ button: 0, pointerId: 1, clientY: 0, ...e }); },
    setPointerCapture() {},
  };
}

function makeDoc({ grabber = true } = {}) {
  const body = el('body');
  const g = grabber ? el('np-grabber') : null;
  const np = el('np');
  const events = [];
  const doc = {
    body,
    getElementById: (id) => (id === 'np-grabber' ? g : id === 'np' ? np : null),
    dispatchEvent: (e) => events.push(e),
  };
  return { doc, g, np, body, events };
}

const slides = [];
const slide = (np, change) => { slides.push(np.id); change(); };
const desk = { matches: false };
const folded = (d) => d.body.classList.contains('np-fold');
// A press on the grabber: down at y, up at y + dy, then the click its lift sends.
function press(g, dy = 0) {
  g.fire('pointerdown', { clientY: 400 });
  g.fire('pointerup', { clientY: 400 + dy });
  g.fire('click');
}

test('a page with no grabber has no fold', () => {
  assert.equal(initFold(makeDoc({ grabber: false }).doc, { storage: new MockStorage(), phone: desk, slide }), null);
});

test('a tap on the grabber folds the bar, and another unfolds it; the fold is kept for the visit, and said', () => {
  const d = makeDoc();
  const store = new MockStorage();
  initFold(d.doc, { storage: store, phone: desk, slide });
  assert.equal(folded(d), false);
  assert.equal(d.g.getAttribute('aria-expanded'), 'true');
  press(d.g);
  assert.equal(folded(d), true);
  assert.equal(d.g.getAttribute('aria-expanded'), 'false');
  assert.equal(d.g.getAttribute('aria-label'), 'Unfold the bar');
  assert.equal(store.getItem(NP_FOLD_KEY), '1');
  assert.equal(d.events.at(-1).detail.folded, true, 'the Studio hears of it, to draw its lanes again');
  press(d.g);
  assert.equal(folded(d), false);
  assert.equal(d.g.getAttribute('aria-label'), 'Fold the bar');
  assert.equal(store.getItem(NP_FOLD_KEY), null);
  assert.equal(d.events.at(-1).detail.folded, false);
});

test('a drag down folds it and a drag up unfolds it, and the lift’s click is no tap', () => {
  const d = makeDoc();
  initFold(d.doc, { storage: new MockStorage(), phone: desk, slide });
  press(d.g, 40);
  assert.equal(folded(d), true, 'down folds');
  press(d.g, 40);
  assert.equal(folded(d), true, 'down again leaves it folded: the drag says which way, not "the other way"');
  press(d.g, -40);
  assert.equal(folded(d), false, 'up unfolds');
  press(d.g, -40);
  assert.equal(folded(d), false);
  // A finger that wanders a little is still a tap.
  press(d.g, GESTURE.SLOP_PX);
  assert.equal(folded(d), true, 'a press within the slop is a tap');
});

test('it moves the bar by its slide, not by jumping; restored on a reload, it is already there', () => {
  slides.length = 0;
  const d = makeDoc();
  const store = new MockStorage();
  initFold(d.doc, { storage: store, phone: desk, slide });
  press(d.g);
  assert.deepEqual(slides, ['np']);
  slides.length = 0;
  const again = makeDoc();
  initFold(again.doc, { storage: store, phone: desk, slide });
  assert.equal(folded(again), true);
  assert.equal(again.g.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(slides, [], 'a page that opens folded does not slide into it');
});

test('on a phone the grabber is the player’s: it folds nothing', () => {
  const d = makeDoc();
  initFold(d.doc, { storage: new MockStorage(), phone: { matches: true }, slide });
  press(d.g);
  press(d.g, 40);
  assert.equal(folded(d), false);
});

test('a storage that throws (private mode) neither throws nor stops the fold', () => {
  const d = makeDoc();
  const throwing = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.doesNotThrow(() => {
    initFold(d.doc, { storage: throwing, phone: desk, slide });
    press(d.g);
  });
  assert.equal(folded(d), true);
});

test('slideFrom moves the bar back to where it stood, then lets it go on the lid spring', () => {
  // The bar's top before the change and after it: it grew 72 px.
  let top = 643;
  const classes = new Set();
  const style = { transform: '' };
  const seen = [];
  const strip = { style: { opacity: '' } };
  const np = {
    ownerDocument: { defaultView: { matchMedia: () => ({ matches: false }) } },
    style: new Proxy(style, { set: (o, k, v) => { o[k] = v; seen.push(`${k}=${v}|${[...classes].join(',')}`); return true; } }),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
    getBoundingClientRect: () => ({ top }),
    querySelector: () => strip,
    addEventListener() {},
    removeEventListener() {},
  };
  slideFrom(np, () => { top = 571; });
  // Moved down by what it grew, with no transition, then let go with one.
  assert.ok(seen.includes('transform=translateY(72px)|'), seen.join(' '));
  assert.equal(seen.at(-1), 'transform=|np-sliding');
  assert.ok(classes.has('np-sliding'));
  // Less motion: the change alone.
  const still = { ...np, ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } } };
  seen.length = 0;
  top = 643;
  slideFrom(still, () => { top = 571; });
  assert.ok(!seen.some((x) => /translateY/.test(x)), seen.join(' '));
});
