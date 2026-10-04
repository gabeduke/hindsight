import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago } from './trash.js';
import { undoSkipped, toastNext, takeNextToast } from './toast.js';

test('the trash says how long ago, coarsely', () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  assert.equal(ago('2026-10-04T11:59:30Z', now), 'just now');
  assert.equal(ago('2026-10-04T11:55:00Z', now), '5 min ago');
  assert.equal(ago('2026-10-04T09:00:00Z', now), '3 h ago');
  assert.equal(ago('2026-10-03T11:00:00Z', now), '1 day ago');
  assert.equal(ago('2026-09-28T12:00:00Z', now), '6 days ago');
  assert.equal(ago('2026-10-04T12:00:05Z', now), 'just now'); // a clock a little ahead
});

test('a skipped undo names the thing that changed', () => {
  assert.match(undoSkipped('rename'), /the name was changed/);
  assert.match(undoSkipped('flag moved'), /the flag was changed/);
  assert.match(undoSkipped('selection'), /the selection was changed/);
  assert.match(undoSkipped('something new'), /the take was changed/);
});

test('a toast for the next page is taken once', () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    toastNext({ msg: 'Deleted x', restore: 'jam_x.wav' });
    assert.deepEqual(takeNextToast(), { msg: 'Deleted x', restore: 'jam_x.wav' });
    assert.equal(takeNextToast(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
});
