import { test } from 'node:test';
import assert from 'node:assert/strict';

import { on, setOn, start } from './mount.js';

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

test('with the flag off, the strip is never even fetched', async () => {
  withStorage(memory(), () => {
    let loaded = 0;
    const got = start({ load: () => { loaded++; return Promise.resolve({ startStrip: () => ({}) }); } });
    assert.equal(got, null);
    assert.equal(loaded, 0);
  });
  const s = memory();
  s.setItem('hindsight.play', '1');
  await withStorage(s, async () => {
    let opts = null;
    const got = await start({ load: async () => ({ startStrip: (o) => { opts = o; return 'strip'; } }), x: 1 });
    assert.equal(got, 'strip');
    assert.deepEqual(opts, { x: 1 });
  });
});

test('the KEYS rule: the strip has the keyboard only while unfolded and not given back', async () => {
  const { keysOwner, fromOptions } = await import('./strip.js');
  assert.equal(keysOwner({ open: false, given: false }), false);
  assert.equal(keysOwner({ open: true, given: false }), true);
  assert.equal(keysOwner({ open: true, given: true }), false, 'a tap on the lanes gives them back');
  const opts = fromOptions({ pi: [{ name: 'SMK-37', connected: true }], web: [], canWeb: true });
  assert.deepEqual(opts.map((o) => o.id), ['touch', 'keys', 'pi:SMK-37', 'web+']);
  assert.equal(opts[2].live, true);
  assert.deepEqual(fromOptions({ canWeb: false }).map((o) => o.id), ['touch', 'keys'], 'no Web MIDI here: no offer');
});
