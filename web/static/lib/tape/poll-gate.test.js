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

test('a nudge with no poll in flight polls at once', () => {
  const g = pollGate();
  assert.equal(g.nudge(), true);
  const a = g.begin();
  assert.equal(g.end(a), false, 'and nothing more is owed after it');
});

test('nudges while a poll is in flight poll once more after it, never twice', () => {
  const g = pollGate();
  const a = g.begin();
  assert.equal(g.nudge(), false, 'not alongside the one in flight');
  assert.equal(g.nudge(), false);
  assert.equal(g.end(a), true, 'once more when it ends');
  const b = g.begin();
  assert.equal(g.end(b), false, 'and only once');
});

test('a nudge owed to a poll that a forced one overtook is the forced one\'s', () => {
  const g = pollGate();
  const lost = g.begin();
  g.nudge();
  const woke = g.begin(true);
  assert.equal(g.end(lost), false, 'the lost poll owes nothing');
  assert.equal(g.end(woke), false, 'the forced poll began after the nudge, so it has it');
  g.begin();
  g.nudge();
  const late = g.begin(true);
  g.nudge();
  assert.equal(g.end(late), true, 'a nudge after the forced poll began is still owed');
});
