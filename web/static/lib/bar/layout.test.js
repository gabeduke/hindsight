// The bar's layout (lib/bar/layout.js): the fold and the phone's player up,
// kept on <body> for the page's rules and the router, said to whoever
// listens when it moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { barLayout } from './layout.js';

test('the layout writes the body’s classes, and its snapshot is the same object until one moves', () => {
  const doc = fakeDoc();
  const l = barLayout(doc);
  const s = l.snapshot();
  assert.deepEqual({ ...s }, { folded: false, open: false });
  assert.ok(Object.isFrozen(s));
  assert.equal(l.snapshot(), s);
  l.set({ folded: true });
  assert.equal(doc.body.classList.contains('np-fold'), true);
  assert.equal(l.folded, true);
  assert.notEqual(l.snapshot(), s);
  l.set({ open: true });
  assert.equal(doc.body.classList.contains('player-open'), true);
  assert.deepEqual({ ...l.snapshot() }, { folded: true, open: true });
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
  assert.deepEqual(heard, [{ folded: true, open: false, was: false }, { folded: true, open: true, was: true }]);
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
