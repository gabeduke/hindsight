import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROOMS_FLAG, on, setOn } from './flag.js';

// The flag is read through localStorage and must survive not having one --
// private mode, and the first load on a fresh device.
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
    has: (k) => m.has(k),
  };
};

test('the key is the one the inline redirect in index.html reads', () => {
  assert.equal(ROOMS_FLAG, 'hindsight.rooms');
});

test('the two rooms are off until a device asks for them', () => {
  const s = memory();
  withStorage(s, () => {
    assert.equal(on(), false);
    setOn(true);
    assert.equal(on(), true);
    setOn(false);
    assert.equal(on(), false);
    assert.equal(s.has(ROOMS_FLAG), false, 'turning it off removes the key rather than storing "0"');
  });
});

test('only the exact flag value counts as on', () => {
  const s = memory();
  withStorage(s, () => {
    s.setItem(ROOMS_FLAG, 'yes');
    assert.equal(on(), false);
    s.setItem(ROOMS_FLAG, '1');
    assert.equal(on(), true);
  });
});

test('no storage at all is off, not a crash', () => {
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
