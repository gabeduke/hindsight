import { test } from 'node:test';
import assert from 'node:assert/strict';

import { on, setOn } from './mount.js';

// mount.js reads the flag through localStorage and must survive not having
// one -- private mode, and the first load on a fresh device.
function withStorage(impl, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = globalThis.localStorage;
  globalThis.localStorage = impl;
  try { fn(); } finally {
    if (had) globalThis.localStorage = prev; else delete globalThis.localStorage;
  }
}

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

test('Play mode is off until a device asks for it', () => {
  withStorage(memory(), () => {
    assert.equal(on(), false);
    setOn(true);
    assert.equal(on(), true);
    setOn(false);
    assert.equal(on(), false, 'turning it off removes the key rather than storing "0"');
  });
});

test('only the exact flag value counts as on', () => {
  const s = memory();
  withStorage(s, () => {
    s.setItem('hindsight.play', 'yes');
    assert.equal(on(), false);
    s.setItem('hindsight.play', '1');
    assert.equal(on(), true);
  });
});

test('no storage at all is off, not a crash', () => {
  // Private mode throws on access rather than returning null. A device that
  // cannot store a flag must still load the tape page.
  const throwing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  withStorage(throwing, () => {
    assert.equal(on(), false);
    assert.doesNotThrow(() => setOn(true));
    assert.doesNotThrow(() => setOn(false));
  });
});
