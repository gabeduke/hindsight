import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollGate } from './poll-gate.js';

test('a second poll waits while one is in flight', () => {
  const g = pollGate();
  const a = g.begin();
  assert.ok(a);
  assert.equal(g.begin(), null);
  g.end(a);
  assert.ok(g.begin());
});

test('a lost poll no longer stops the polling: a forced one goes ahead', () => {
  const g = pollGate();
  const lost = g.begin(); // never answered, never ended
  assert.equal(g.begin(), null, 'ticks are held off while it is out');
  const woke = g.begin(true);
  assert.ok(woke);
  assert.equal(g.current(lost), false, 'its answer, if it ever comes, is dropped');
  assert.equal(g.current(woke), true);
  g.end(woke);
  assert.ok(g.begin(), 'and the ticks go on after the forced poll');
});

test('the old poll finishing late does not release the newer one', () => {
  const g = pollGate();
  const old = g.begin();
  const fresh = g.begin(true);
  g.end(old);
  assert.equal(g.begin(), null, 'the fresh poll is still in flight');
  g.end(fresh);
  assert.ok(g.begin());
});
