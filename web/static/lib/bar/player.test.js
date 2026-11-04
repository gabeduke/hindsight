// The phone's player (lib/bar/player.js), in two halves (D5,
// docs/architecture/bar.md, *The Transport's extraction*): the sheet is the surface's
// (playerSheet), the keys the bar's (playerKeys), which open it, put it
// away, hand it a drag and lend it the key the focus goes back to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { playerKeys } from './player.js';
import { barLayout } from './layout.js';

function aPhone(matches = true) {
  const fns = [];
  return { matches, addEventListener: (_t, fn) => fns.push(fn), set(m) { this.matches = m; for (const f of fns) f(); } };
}

// A player as the surface makes it, by what the keys ask of it.
function aPlayer(layout) {
  const log = [];
  let keys = null;
  return {
    log,
    get keys() { return keys; },
    open() { log.push('open'); layout.set({ open: true }); keys?.shown(); },
    // As playerSheet does: the keys put away, then the focus given back to
    // the key they lent (the bar's keys never read the document for it).
    close() { log.push('close'); layout.set({ open: false }); keys?.hidden(); keys?.owner.focus(); },
    grab(e) { log.push(['grab', e.currentTarget.id]); },
    get isOpen() { return layout.open; },
    lend(k) { keys = k; return () => { if (keys === k) keys = null; }; },
  };
}

function setup({ phone = aPhone() } = {}) {
  const doc = fakeDoc();
  const root = doc.createElement('section');
  root.id = 'np';
  const btn = doc.createElement('button');
  btn.id = 'np-expand';
  const grabber = doc.createElement('button');
  grabber.id = 'np-grabber';
  const win = doc.createElement('div');
  win.id = 'np-deck';
  root.append(grabber, win, btn);
  doc.body.append(root);
  const layout = barLayout(doc, { root });
  const player = aPlayer(layout);
  const on = (target, type, fn) => target.addEventListener(type, fn);
  playerKeys(root, { player, layout, phone, on, btn, grabber, handles: [grabber, win] });
  const fire = (el, type, e = {}) => { for (const fn of el.listeners.get(type) || []) fn({ type, currentTarget: el, target: el, ...e }); };
  return { doc, root, btn, grabber, win, layout, player, phone, fire };
}

test('▣ opens the surface’s player and puts it away; the bar says which on its root and its keys', () => {
  const t = setup();
  assert.equal(t.root.dataset.size, 'mini');
  assert.equal(t.player.keys.owner, t.btn, 'the bar lends ▣ as the key the focus goes back to');
  t.fire(t.btn, 'click');
  assert.deepEqual(t.player.log, ['open']);
  assert.equal(t.root.dataset.size, 'full');
  assert.equal(t.root.hasAttribute('data-open'), true, 'the layout says it on the root');
  assert.equal(t.btn.getAttribute('aria-expanded'), 'true');
  assert.equal(t.grabber.getAttribute('aria-label'), 'Put the player away');
  assert.equal(t.doc.activeElement, t.grabber, 'the focus goes to its grabber');
  t.fire(t.grabber, 'click');
  assert.deepEqual(t.player.log, ['open', 'close'], 'the grabber puts it away on a phone');
  assert.equal(t.root.dataset.size, 'mini');
  assert.equal(t.doc.activeElement, t.btn, 'and the focus goes back to ▣');
});

test('a press on the grabber or the window hands the surface’s sheet its drag', () => {
  const t = setup();
  t.fire(t.grabber, 'pointerdown');
  t.fire(t.win, 'pointerdown');
  assert.deepEqual(t.player.log, [['grab', 'np-grabber'], ['grab', 'np-deck']]);
});

test('wider than a phone the bar is full, and its grabber is the fold’s, not the player’s', () => {
  const t = setup({ phone: aPhone(false) });
  assert.equal(t.root.dataset.size, 'full');
  t.fire(t.grabber, 'click');
  assert.deepEqual(t.player.log, [], 'no player to put away');
  t.phone.set(true);
  assert.equal(t.root.dataset.size, 'mini', 'it follows the screen');
});

// The real sheet (playerSheet, on createSheet and the page's stack), with
// less motion asked for, so it comes and goes at once.
async function realPlayer() {
  const { createLayers } = await import('../ui/layers.js');
  const { playerSheet } = await import('./player.js');
  const doc = fakeDoc();
  const dock = doc.createElement('div');
  dock.id = 'np-dock';
  const root = doc.createElement('section');
  root.id = 'np';
  const btn = doc.createElement('button');
  btn.id = 'np-expand';
  const grabber = doc.createElement('button');
  grabber.id = 'np-grabber';
  const menuRow = doc.createElement('button');
  const menuPanel = doc.createElement('div');
  menuPanel.className = 'menu';
  menuPanel.append(menuRow);
  root.append(grabber, btn);
  dock.append(root);
  // Less motion: it fades, and the fade ends when the test says (settle).
  const fades = [];
  dock.animate = () => { const a = { cancel() {} }; fades.push(a); return a; };
  const settle = () => { while (fades.length) fades.shift().onfinish?.(); };
  const page = doc.createElement('main');
  doc.body.append(page, dock, menuPanel);
  const win = { addEventListener() {}, removeEventListener() {} };
  const layers = createLayers({ doc, win, CloseWatcher: undefined, history: undefined });
  const layout = barLayout(doc, { root });
  const phone = aPhone(true);
  const player = playerSheet(dock, { root, layers, layout, phone });
  const on = (target, type, fn) => target.addEventListener(type, fn);
  playerKeys(root, { player, layout, phone, on, btn, grabber, handles: [grabber] });
  let focused = 0;
  const focus = btn.focus.bind(btn);
  btn.focus = (o) => { focused++; focus(o); };
  const fire = (el, type) => { for (const fn of el.listeners.get(type) || []) fn({ type, currentTarget: el, target: el }); };
  const fireNow = (el, type) => { fire(el, type); settle(); };
  return { doc, btn, grabber, menuRow, page, layers, player, fire: fireNow, settle, focused: () => focused };
}

test('the surface’s sheet gives ▣ the focus back as the player is put away, once, and not from a menu', async () => {
  const had = { matchMedia: globalThis.matchMedia, MutationObserver: globalThis.MutationObserver };
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  try {
    const t = await realPlayer();
    t.fire(t.btn, 'click');
    assert.equal(t.player.isOpen, true);
    assert.equal(t.doc.activeElement, t.grabber, 'up, the focus is on its grabber');
    assert.equal(t.page.inert, true, 'the page under it is still');
    // Put away by the grabber: the sheet gives ▣ the focus back.
    t.fire(t.grabber, 'click');
    assert.equal(t.player.isOpen, false);
    assert.equal(t.page.inert, false);
    assert.equal(t.doc.activeElement, t.btn, 'the focus is back on ▣');
    // Put away by Escape: the stack gives it back as the sheet leaves it,
    // and the sheet doesn't give it again.
    t.fire(t.btn, 'click');
    const before = t.focused();
    t.layers.top().close('escape');
    assert.equal(t.doc.activeElement, t.btn, 'the stack gives it back at once');
    t.settle();
    assert.equal(t.doc.activeElement, t.btn);
    assert.equal(t.focused() - before, 1, 'one focus, not two');
    // Put away while the focus has gone on to a menu: it stays there.
    t.fire(t.btn, 'click');
    t.menuRow.focus();
    t.player.close();
    t.settle();
    assert.equal(t.doc.activeElement, t.menuRow, 'a menu keeps the focus');
  } finally {
    globalThis.matchMedia = had.matchMedia;
    globalThis.MutationObserver = had.MutationObserver;
  }
});
