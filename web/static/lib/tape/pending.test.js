import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pending } from './pending.js';

test('a mute is heard after the delay, and shown at once', () => {
  const p = new Pending();
  p.ask(2, { mute: false, solo: false }, 800, 1000);
  assert.equal(p.pending(2, 1500), true);
  assert.deepEqual(p.heard(2, { mute: true, solo: false }, 1500), { mute: false, solo: false });
  assert.equal(p.pending(2, 1801), false);
  assert.deepEqual(p.heard(2, { mute: true, solo: false }, 1801), { mute: true, solo: false });
});

test('asking again keeps what was heard and moves the time on', () => {
  const p = new Pending();
  p.ask(1, { mute: false, solo: false }, 800, 0);
  p.ask(1, { mute: true, solo: false }, 800, 500); // un-mute before the mute was heard
  assert.deepEqual(p.heard(1, { mute: false, solo: false }, 1000), { mute: false, solo: false });
  assert.equal(p.pending(1, 1299), true);
  assert.equal(p.pending(1, 1301), false);
});

test('a track nobody asked about is as it is', () => {
  assert.deepEqual(new Pending().heard(3, { mute: true, solo: false }, 0), { mute: true, solo: false });
});
