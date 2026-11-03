// The bar's layout (lib/bar/layout.js): the fold and the phone's player up,
// kept on <body> for the page's rules and the router, said to whoever
// listens when it moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { barLayout, NP_FOLD_KEY } from './layout.js';

test('the layout writes the body’s classes, and its snapshot is the same object until one moves', () => {
  const doc = fakeDoc();
  const l = barLayout(doc);
  const s = l.snapshot();
  assert.deepEqual({ ...s }, { folded: false, open: false, docked: false });
  assert.ok(Object.isFrozen(s));
  assert.equal(l.snapshot(), s);
  l.set({ folded: true });
  assert.equal(doc.body.classList.contains('np-fold'), true);
  assert.equal(l.folded, true);
  assert.notEqual(l.snapshot(), s);
  l.set({ open: true });
  assert.equal(doc.body.classList.contains('player-open'), true);
  assert.deepEqual({ ...l.snapshot() }, { folded: true, open: true, docked: false });
});

test('onChange hears what moved and nothing else, and a way off is off', () => {
  const doc = fakeDoc();
  const l = barLayout(doc);
  const heard = [];
  const off = l.onChange((s, was) => heard.push({ ...s, was: was.folded }));
  l.set({ folded: false });
  assert.deepEqual(heard, [], 'nothing moved');
  l.set({ folded: true });
  l.set({ open: true });
  assert.deepEqual(heard, [{ folded: true, open: false, docked: false, was: false }, { folded: true, open: true, docked: false, was: true }]);
  off();
  l.set({ folded: false });
  assert.equal(heard.length, 2);
});

test('a fold after a room switch is heard as a fold: what it was is read as set() begins, never kept across the switch', () => {
  // Folded in the Listening Room; the Studio, unfolded, shown again (the
  // router takes np-fold with the room); folded there: the Studio must
  // hear a fold, to draw its lanes at their new size.
  const doc = fakeDoc();
  const l = barLayout(doc);
  const folds = [];
  l.onChange((s, was) => { if (s.folded !== was.folded) folds.push(s.folded); });
  l.set({ folded: true }); // in the Listening Room
  doc.body.classList.remove('np-fold'); // the router, back to the Studio
  assert.equal(l.folded, false);
  l.set({ folded: true }); // in the Studio
  assert.deepEqual(folds, [true, true], 'the second fold is heard');
});

test('the bar’s root says the fold, the player up and what is docked on itself, as set() writes them', () => {
  // Step 5c: the bar's stylesheet reads its root, never <body>.
  const doc = fakeDoc();
  const np = doc.createElement('section');
  const l = barLayout(doc, { root: () => np });
  assert.deepEqual(['data-fold', 'data-open', 'data-docked'].map((a) => np.hasAttribute(a)), [false, false, false]);
  l.set({ folded: true });
  assert.equal(np.getAttribute('data-fold'), '');
  l.set({ open: true, docked: true });
  assert.ok(np.hasAttribute('data-open') && np.hasAttribute('data-docked'));
  assert.equal(l.docked, true);
  assert.equal(l.snapshot().docked, true);
  l.set({ folded: false, open: false, docked: false });
  assert.deepEqual(['data-fold', 'data-open', 'data-docked'].map((a) => np.hasAttribute(a)), [false, false, false]);
});

test('sync() puts the root right after the router gave a room its classes, and says nothing', () => {
  // The router takes np-fold with the room left and gives it back with the
  // room arrived in; the shell calls sync() straight after (chrome.classesGiven).
  const doc = fakeDoc();
  const np = doc.createElement('section');
  const l = barLayout(doc, { root: np });
  const heard = [];
  l.onChange((s) => heard.push(s));
  doc.body.classList.add('np-fold');
  assert.equal(np.hasAttribute('data-fold'), false, 'the body moved; the root waits for sync()');
  l.sync();
  assert.equal(np.hasAttribute('data-fold'), true);
  doc.body.classList.remove('np-fold');
  l.sync();
  assert.equal(np.hasAttribute('data-fold'), false);
  assert.deepEqual(heard, [], 'a switch says nothing');
});

test('the fold is kept for the visit in the storage the page hands it, and a page reloaded folded opens folded', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const doc = fakeDoc();
  barLayout(doc, { storage }).set({ folded: true });
  assert.equal(m.get(NP_FOLD_KEY), '1');
  const again = fakeDoc();
  const np = again.createElement('section');
  const l = barLayout(again, { storage, root: np });
  assert.equal(l.folded, true, 'restored');
  assert.equal(again.body.classList.contains('np-fold'), true);
  assert.equal(np.hasAttribute('data-fold'), true, 'and the root says so from the start');
  l.set({ open: true });
  assert.equal(m.get(NP_FOLD_KEY), '1', 'a set() that does not say the fold leaves it kept');
  l.set({ folded: false });
  assert.equal(m.has(NP_FOLD_KEY), false);
  assert.equal(barLayout(fakeDoc()).folded, false, 'with no storage it is not kept');
});
