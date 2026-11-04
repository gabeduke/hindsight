// The phone's player (lib/bar/player.js), in two halves (D5,
// docs/plan/transport-extraction.md): the sheet is the surface's
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
  win.id = 'np-window';
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
  assert.deepEqual(t.player.log, [['grab', 'np-grabber'], ['grab', 'np-window']]);
});

test('wider than a phone the bar is full, and its grabber is the fold’s, not the player’s', () => {
  const t = setup({ phone: aPhone(false) });
  assert.equal(t.root.dataset.size, 'full');
  t.fire(t.grabber, 'click');
  assert.deepEqual(t.player.log, [], 'no player to put away');
  t.phone.set(true);
  assert.equal(t.root.dataset.size, 'mini', 'it follows the screen');
});
