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
  const off = l.onChange((s) => heard.push({ ...s }));
  l.set({ folded: false });
  assert.deepEqual(heard, [], 'nothing moved');
  l.set({ folded: true });
  l.set({ open: true });
  assert.deepEqual(heard, [{ folded: true, open: false }, { folded: true, open: true }]);
  off();
  l.set({ folded: false });
  assert.equal(heard.length, 2);
});

test('a room switch that takes np-fold off the body is read as it is: the body is the one place it is kept', () => {
  const doc = fakeDoc();
  const l = barLayout(doc);
  l.set({ folded: true });
  doc.body.classList.remove('np-fold'); // the router, leaving the room
  assert.equal(l.folded, false);
  assert.equal(l.snapshot().folded, false);
});
