// The one stack of open things (lib/ui/layers.js): Back and Escape close the
// top one first; a press outside closes a menu; one CloseWatcher per layer
// where the browser has them, and one history entry for the stack where it
// does not -- never both. Stand-ins for the document, the window, its
// history and CloseWatcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { createLayers, historyStep, layersOf, KEY, KINDS } from './layers.js';

const tick = () => new Promise((r) => setImmediate(r));
// After an Escape, until its keydown is over (layers.js clears `escaping` on
// a timer): a close request then is Back's. A tick alone may come first.
const keyDone = () => new Promise((r) => setTimeout(r, 1));

// A window: its listeners (capture and not, in the order added), a tab's
// history whose Back comes back as a popstate a moment later, as a
// browser's does, and CloseWatcher, whose close request goes to the newest.
function aWindow({ watchers = false, state = null } = {}) {
  const doc = fakeDoc();
  const heard = [];
  const win = {
    addEventListener(type, fn, opts) { heard.push({ type, fn, capture: opts === true || !!opts?.capture }); },
    removeEventListener(type, fn) { const i = heard.findIndex((x) => x.type === type && x.fn === fn); if (i >= 0) heard.splice(i, 1); },
    fire(type, e = {}) {
      const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e };
      for (const x of [...heard].sort((a, b) => b.capture - a.capture)) if (x.type === type) x.fn(ev);
      return ev;
    },
  };
  const entries = [{ state }];
  let i = 0;
  const history = {
    get state() { return entries[i].state; },
    get length() { return entries.length; },
    pushState(s) { entries.splice(i + 1, Infinity, { state: structuredClone(s) }); i++; },
    replaceState(s) { entries[i] = { state: structuredClone(s) }; },
    back() { setImmediate(() => { if (i > 0) { i--; win.fire('popstate', { state: history.state }); } }); },
    forward() { setImmediate(() => { if (i < entries.length - 1) { i++; win.fire('popstate', { state: history.state }); } }); },
    states: () => entries.map((e) => e.state),
    get index() { return i; },
  };
  const live = [];
  class CloseWatcher {
    constructor() { live.push(this); }
    destroy() { const k = live.indexOf(this); if (k >= 0) live.splice(k, 1); }
  }
  // A close request: Escape (its keydown first) or Android's Back.
  const request = () => { const w = live.pop(); w?.onclose?.(); };
  const escape = () => { const ev = win.fire('keydown', { key: 'Escape' }); if (!ev.defaultPrevented) request(); return ev; };
  const el = (tag = 'div') => { const e = doc.createElement(tag); doc.body.append(e); return e; };
  const errors = [];
  const layers = createLayers({ doc, win, CloseWatcher: watchers ? CloseWatcher : undefined, history, onError: (e) => errors.push(e) });
  return { doc, win, history, live, request, escape, el, layers, errors };
}

// A layer whose onClose writes down why it closed.
function opened(w, kind, opts = {}) {
  const el = opts.el || w.el();
  const log = opts.log || [];
  const layer = w.layers.open({ el, kind, ...opts, onClose: (r) => log.push(`${opts.name || kind} ${r}`) });
  return { el, layer, log };
}

// --- the fallback's one history entry ----------------------------------------

test('historyStep: the first layer pushes the entry, the rest share it', () => {
  let s = historyStep({}, { type: 'open' });
  assert.deepEqual(s, { held: 1, on: true, unwinding: 0, history: 'push', close: null });
  s = historyStep(s, { type: 'open' });
  assert.equal(s.history, null, 'one entry for the stack');
  assert.equal(s.held, 2);
});

test('historyStep: the last layer closed takes the entry back, only while the history is on it', () => {
  let s = historyStep(historyStep({}, { type: 'open' }), { type: 'open' });
  s = historyStep(s, { type: 'close', current: true });
  assert.equal(s.history, null, 'one still holds it');
  s = historyStep(s, { type: 'close', current: true });
  assert.deepEqual(s, { held: 0, on: false, unwinding: 1, history: 'back', close: null });
  // Buried under another entry (a switch pushed one): left where it is.
  const b = historyStep(historyStep({}, { type: 'open' }), { type: 'close', current: false });
  assert.deepEqual(b, { held: 0, on: false, unwinding: 0, history: null, close: null });
  assert.deepEqual(historyStep({}, { type: 'close', current: true }), { held: 0, on: false, unwinding: 0, history: null, close: null }, 'nothing open');
});

test('historyStep: our own Back comes back swallowed; a layer that opened meanwhile gets the entry then', () => {
  let s = historyStep(historyStep({}, { type: 'open' }), { type: 'close', current: true });
  s = historyStep(s, { type: 'open' });
  assert.equal(s.history, null, 'not while our Back is on its way');
  s = historyStep(s, { type: 'popstate', ours: false, marked: false });
  assert.deepEqual(s, { held: 1, on: true, unwinding: 0, history: 'push', close: null });
  const quiet = historyStep(historyStep(historyStep({}, { type: 'open' }), { type: 'close', current: true }), { type: 'popstate', ours: false });
  assert.deepEqual(quiet, { held: 0, on: false, unwinding: 0, history: null, close: null }, 'and closes nothing');
});

test('historyStep: Back off the entry closes the top layer, and the rest get an entry again', () => {
  let s = historyStep(historyStep({}, { type: 'open' }), { type: 'open' });
  s = historyStep(s, { type: 'popstate', ours: false, marked: false });
  assert.equal(s.close, 'top');
  assert.equal(s.on, false);
  s = historyStep(s, { type: 'close', current: false }); // the top, by Back
  assert.equal(s.history, null);
  s = historyStep(s, { type: 'settle' });
  assert.deepEqual(s, { held: 1, on: true, unwinding: 0, history: 'push', close: null });
  // The last one: nothing to push.
  let t = historyStep({}, { type: 'open' });
  t = historyStep(t, { type: 'popstate', ours: false });
  t = historyStep(historyStep(t, { type: 'close', current: false }), { type: 'settle' });
  assert.deepEqual(t, { held: 0, on: false, unwinding: 0, history: null, close: null });
});

test('historyStep: a dead entry landed on is stripped; the live one landed on again is the entry', () => {
  assert.equal(historyStep({}, { type: 'popstate', ours: false, marked: true }).history, 'strip', 'Forward onto an old one');
  assert.equal(historyStep({}, { type: 'popstate', ours: false, marked: false }).history, null, 'not ours at all');
  // The player stayed open through a switch: Back from the other room lands
  // on its entry again.
  const s = historyStep({ held: 1, on: false, unwinding: 0 }, { type: 'popstate', ours: true, marked: true });
  assert.deepEqual(s, { held: 1, on: true, unwinding: 0, history: null, close: null });
});

// --- where the browser has CloseWatcher ---------------------------------------

test('with CloseWatcher: one per layer, the newest closes first, and the history is never touched', async () => {
  const w = aWindow({ watchers: true });
  const log = [];
  opened(w, 'selection', { log });
  opened(w, 'sheet', { log });
  opened(w, 'menu', { log });
  assert.equal(w.live.length, 3);
  assert.deepEqual(w.history.states(), [null], 'no entry: Back would otherwise need pressing twice');
  w.escape();
  assert.deepEqual(log, ['menu escape']);
  await keyDone();
  w.request(); // Android's Back
  assert.deepEqual(log, ['menu escape', 'sheet back']);
  assert.equal(w.layers.top().kind, 'selection');
  w.escape();
  assert.deepEqual(log, ['menu escape', 'sheet back', 'selection escape']);
  assert.equal(w.layers.top(), null);
  assert.equal(w.live.length, 0);
});

test('with CloseWatcher: a layer its owner closes gives up its watcher, so the next request is the next layer’s', () => {
  const w = aWindow({ watchers: true });
  const a = opened(w, 'selection');
  const b = opened(w, 'sheet');
  b.layer.close();
  assert.deepEqual(b.log, ['sheet program']);
  assert.equal(b.layer.open, false);
  assert.equal(w.live.length, 1);
  w.escape();
  assert.deepEqual(a.log, ['selection escape']);
  b.layer.close();
  assert.deepEqual(b.log, ['sheet program'], 'once');
});

test('with CloseWatcher: an Escape something else took for itself sends no close request', () => {
  const w = aWindow({ watchers: true });
  const a = opened(w, 'menu');
  w.win.addEventListener('keydown', (e) => e.preventDefault());
  w.escape();
  assert.deepEqual(a.log, []);
  assert.equal(a.layer.open, true);
});

// --- which closes first --------------------------------------------------------

test('the top is by kind: a menu, then a sheet or a drawer, then the selection, then the player; the newest first among the same', () => {
  const w = aWindow();
  const log = [];
  opened(w, 'player', { log });
  opened(w, 'menu', { log, name: 'menu 1' });
  opened(w, 'sheet', { log });
  opened(w, 'selection', { log });
  opened(w, 'drawer', { log });
  opened(w, 'menu', { log, name: 'menu 2' });
  const order = [];
  while (w.layers.top()) { order.push(w.layers.top().kind); w.win.fire('keydown', { key: 'Escape' }); }
  assert.deepEqual(log, ['menu 2 escape', 'menu 1 escape', 'drawer escape', 'sheet escape', 'selection escape', 'player escape']);
  assert.deepEqual(order, ['menu', 'menu', 'drawer', 'sheet', 'selection', 'player'], 'top() is what closes next');
});

test('a modal layer is a floor: what is under it waits for it, whatever its kind', () => {
  const w = aWindow();
  const log = [];
  opened(w, 'sheet', { log, name: 'inspector' });
  opened(w, 'selection', { log });
  opened(w, 'player', { log, modal: true });
  opened(w, 'menu', { log });
  for (let i = 0; i < 4; i++) w.win.fire('keydown', { key: 'Escape' });
  assert.deepEqual(log, ['menu escape', 'player escape', 'inspector escape', 'selection escape']);
});

test('with CloseWatcher: a request the newer selection’s watcher gets closes the sheet under it, and the selection is watched again', async () => {
  const w = aWindow({ watchers: true });
  const log = [];
  opened(w, 'sheet', { log, name: 'track sheet' });
  const sel = opened(w, 'selection', { log });
  assert.equal(w.layers.top().kind, 'sheet');
  w.escape(); // to the selection's watcher, the newest
  assert.deepEqual(log, ['track sheet escape']);
  assert.equal(sel.layer.open, true);
  assert.equal(w.live.length, 1, 'one watcher, the selection’s, made again');
  await keyDone();
  w.request(); // Android's Back
  assert.deepEqual(log, ['track sheet escape', 'selection back']);
  assert.equal(w.live.length, 0);
  assert.equal(w.layers.top(), null);
});

test('without CloseWatcher: Escape and Back close a sheet under a newer selection first', async () => {
  const w = aWindow();
  const log = [];
  opened(w, 'sheet', { log, name: 'track sheet' });
  opened(w, 'selection', { log });
  w.win.fire('keydown', { key: 'Escape' });
  assert.deepEqual(log, ['track sheet escape']);
  opened(w, 'sheet', { log, name: 'track sheet' });
  w.history.back();
  await tick();
  assert.deepEqual(log, ['track sheet escape', 'track sheet back']);
  assert.ok(w.history.state[KEY], 'the selection keeps an entry');
  w.history.back();
  await tick();
  assert.deepEqual(log, ['track sheet escape', 'track sheet back', 'selection back']);
});

// --- elsewhere: Escape, and one history entry ------------------------------------

test('without CloseWatcher: Escape closes the top layer, unless something under it took the key', () => {
  const w = aWindow();
  const log = [];
  opened(w, 'sheet', { log });
  opened(w, 'menu', { log });
  const ev = w.win.fire('keydown', { key: 'Escape' });
  assert.deepEqual(log, ['menu escape']);
  assert.equal(ev.defaultPrevented, true, 'claimed, for anything after it');
  w.win.fire('keydown', { key: 'Escape', defaultPrevented: true, preventDefault() {} });
  assert.deepEqual(log, ['menu escape'], 'a field’s own Escape');
  w.win.fire('keydown', { key: 'Enter' });
  w.win.fire('keydown', { key: 'Escape', isComposing: true });
  assert.deepEqual(log, ['menu escape']);
  w.win.fire('keydown', { key: 'Escape' });
  assert.deepEqual(log, ['menu escape', 'sheet escape']);
});

test('without CloseWatcher: the stack holds one history entry, and Back closes the top layer, then the next', async () => {
  const w = aWindow({ state: { shell: 1, view: 'studio' } });
  const log = [];
  opened(w, 'selection', { log });
  opened(w, 'sheet', { log });
  assert.equal(w.history.length, 2, 'one entry for both');
  assert.equal(w.history.state.shell, 1, 'the room’s own state is kept in it');
  assert.ok(w.history.state[KEY]);
  w.history.back(); // the iPad's edge swipe
  await tick();
  assert.deepEqual(log, ['sheet back']);
  assert.equal(w.history.state[KEY] != null, true, 'the selection keeps an entry for the next Back');
  w.history.back();
  await tick();
  assert.deepEqual(log, ['sheet back', 'selection back']);
  assert.equal(w.history.state[KEY], undefined);
  assert.deepEqual(w.history.state, { shell: 1, view: 'studio' });
  assert.equal(w.layers.top(), null);
});

test('without CloseWatcher: the last layer closed by its owner takes its entry back, and that Back closes nothing more', async () => {
  const w = aWindow();
  const a = opened(w, 'selection');
  const b = opened(w, 'menu');
  b.layer.close('pick');
  assert.equal(w.history.index, 1, 'the selection still holds it');
  a.layer.close();
  assert.equal(w.layers.settled() instanceof Promise, true, 'a Back of ours is on its way');
  await tick();
  assert.equal(w.history.index, 0);
  assert.equal(w.layers.settled(), null);
  assert.deepEqual([...a.log, ...b.log], ['selection program', 'menu pick']);
});

test('without CloseWatcher: a layer opened while our Back is on its way gets an entry when it lands', async () => {
  const w = aWindow();
  const a = opened(w, 'menu');
  a.layer.close('outside');
  const b = opened(w, 'sheet');
  await tick();
  assert.equal(w.history.index, 1);
  assert.ok(w.history.state[KEY]);
  assert.deepEqual(b.log, [], 'the popstate of our own Back is not a Back');
  w.history.back();
  await tick();
  assert.deepEqual(b.log, ['sheet back']);
});

test('without CloseWatcher: a navigation leaves the entry to the history it moves; landed on later, it is stripped', async () => {
  const w = aWindow({ state: { view: 'studio' } });
  const a = opened(w, 'menu');
  a.layer.close('navigate');
  assert.equal(w.layers.settled(), null, 'no Back of ours to race the link’s load or the switch');
  w.history.pushState({ view: 'room' }); // the switch
  w.history.back();
  await tick();
  assert.deepEqual(w.history.state, { view: 'studio' }, 'the dead entry is stripped, not reopened');
});

test('without CloseWatcher: the entry a reload left behind is stripped', () => {
  const w = aWindow({ state: { shell: 1, [KEY]: 'old.1' } });
  assert.deepEqual(w.history.state, { shell: 1 });
});

test('a switch that buried the entry leaves it; Back onto it with a layer still open is that layer’s again', async () => {
  const w = aWindow({ state: { view: 'studio' } });
  const p = opened(w, 'player');
  w.history.pushState({ view: 'room' }); // the router's switch, with the player up
  w.history.back();
  await tick();
  assert.deepEqual(p.log, [], 'back in the Studio, the player is still up');
  w.history.back();
  await tick();
  assert.deepEqual(p.log, ['player back']);
});

test('leave: a switch closes all but what it keeps, and writes over the stack’s entry when nothing holds it', async () => {
  const w = aWindow({ state: { view: 'studio' } });
  const sel = opened(w, 'selection');
  const menu = opened(w, 'menu');
  assert.equal(w.layers.leave({ keep: ['player'] }), 'replace');
  assert.deepEqual([...menu.log, ...sel.log], ['menu navigate', 'selection navigate']);
  await tick();
  assert.equal(w.history.index, 1, 'no Back of ours: the switch writes the room’s entry over it');
  // The player up keeps its entry, under the room's.
  const w2 = aWindow();
  const p = opened(w2, 'player');
  const m2 = opened(w2, 'menu');
  assert.equal(w2.layers.leave({ keep: ['player'] }), null);
  assert.equal(p.layer.open, true);
  assert.equal(m2.layer.open, false);
  // A Back of ours on its way (a press outside closed the menu): wait for it.
  const w3 = aWindow();
  opened(w3, 'menu').layer.close('outside');
  const wait = w3.layers.leave();
  assert.ok(wait instanceof Promise);
  await wait;
  assert.equal(w3.history.index, 0);
  assert.equal(w3.layers.leave(), null);
  // With CloseWatcher there is no entry to say anything about.
  const w4 = aWindow({ watchers: true });
  opened(w4, 'sheet');
  assert.equal(w4.layers.leave(), null);
  assert.equal(w4.live.length, 0);
});

// --- a press outside, focus, and the rest ------------------------------------------

test('a press outside closes a menu or a popover, not a sheet; a press on its owner or inside it is not outside', () => {
  const w = aWindow({ watchers: true });
  const owner = w.el('button');
  const m = opened(w, 'menu', { owner });
  const s = opened(w, 'sheet');
  w.win.fire('pointerdown', { target: owner });
  w.win.fire('pointerdown', { target: m.el });
  assert.equal(m.layer.open, true);
  w.win.fire('pointerdown', { target: s.el });
  assert.deepEqual(m.log, ['menu outside']);
  assert.deepEqual(s.log, []);
  const p = opened(w, 'popover');
  w.win.fire('pointerdown', { target: w.el() });
  assert.deepEqual(p.log, ['popover outside']);
  const kept = opened(w, 'menu', { outside: false });
  w.win.fire('pointerdown', { target: w.el() });
  assert.equal(kept.layer.open, true, 'one that asks not to');
});

test('Escape and Back give the focus back to the owner; a press outside or a pick leaves it be', async () => {
  const w = aWindow({ watchers: true });
  const owner = w.el('button');
  const elsewhere = w.el('button');
  const m = opened(w, 'menu', { owner });
  m.el.append(w.doc.createElement('button'));
  m.el.children[0].focus();
  w.escape();
  assert.equal(w.doc.activeElement, owner);
  const n = opened(w, 'menu', { owner });
  elsewhere.focus();
  n.layer.close('outside');
  assert.equal(w.doc.activeElement, elsewhere);
  const k = opened(w, 'sheet', { owner, returnFocus: elsewhere });
  owner.focus();
  await keyDone();
  w.request();
  assert.equal(w.doc.activeElement, elsewhere, 'returnFocus wins');
  assert.deepEqual(k.log, ['sheet back']);
});

test('a scope closes only what it opened, by kind or all of it', () => {
  const w = aWindow({ watchers: true });
  const s = w.layers.scope();
  const log = [];
  const shell = w.layers.open({ el: w.el(), kind: 'player', onClose: (r) => log.push(`player ${r}`) });
  s.open({ el: w.el(), kind: 'selection', onClose: (r) => log.push(`selection ${r}`) });
  s.open({ el: w.el(), kind: 'menu', onClose: (r) => log.push(`menu ${r}`) });
  assert.equal(s.size, 2);
  s.closeAll({ kinds: ['menu'], reason: 'navigate' });
  assert.deepEqual(log, ['menu navigate']);
  s.closeAll({ reason: 'navigate' });
  assert.deepEqual(log, ['menu navigate', 'selection navigate']);
  assert.equal(s.size, 0);
  assert.equal(shell.open, true);
  assert.equal(s.top(), shell, 'top is the whole stack’s');
  w.layers.closeAll({ kinds: ['menu', 'popover'] });
  assert.equal(shell.open, true);
});

test('ownsKeys: a menu or a modal layer has the keys, and so has any layer for a key pressed in it', () => {
  const w = aWindow({ watchers: true });
  const page = w.el();
  const s = opened(w, 'sheet');
  assert.equal(w.layers.ownsKeys({ target: page }), false);
  assert.equal(w.layers.ownsKeys({ target: s.el }), true);
  const m = opened(w, 'menu');
  assert.equal(w.layers.ownsKeys({ target: page }), true);
  m.layer.close();
  opened(w, 'player', { modal: true });
  assert.equal(w.layers.ownsKeys({ target: page }), true);
});

test('opening what is open answers its layer; a kind not on the list is refused; an onClose that throws is reported', () => {
  const w = aWindow({ watchers: true });
  const el = w.el();
  const a = w.layers.open({ el, kind: 'selection' });
  assert.equal(w.layers.open({ el, kind: 'selection' }), a);
  assert.equal(w.live.length, 1);
  assert.throws(() => w.layers.open({ el: w.el(), kind: 'dialog' }), /kind/);
  assert.deepEqual([...KINDS], ['menu', 'popover', 'sheet', 'drawer', 'selection', 'player']);
  const b = w.layers.open({ el: w.el(), kind: 'sheet', onClose: () => { throw new Error('would not close'); } });
  w.escape();
  assert.equal(b.open, false);
  assert.deepEqual(w.errors.map((e) => e.message), ['would not close']);
  assert.equal(w.layers.top(), a);
});

test('layersOf is one stack per document', () => {
  const doc = fakeDoc();
  assert.equal(layersOf(doc), layersOf(doc));
  assert.notEqual(layersOf(doc), layersOf(fakeDoc()));
});
