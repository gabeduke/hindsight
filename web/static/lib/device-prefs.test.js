import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEVICE_PREFS, read, write } from './device-prefs.js';

/** A pair of toggles backed by a plain object, so the logic is tested alone. */
function fake() {
  const store = {};
  return [
    { id: 'a', label: 'A', note: 'n', reload: true, get: () => !!store.a, set: (v) => { store.a = v; } },
    { id: 'b', label: 'B', note: 'n', reload: false, get: () => !!store.b, set: (v) => { store.b = v; } },
  ];
}

test('read reports every toggle', () => {
  const prefs = fake();
  assert.deepEqual(read(prefs), { a: false, b: false });
  write('a', true, prefs);
  assert.deepEqual(read(prefs), { a: true, b: false });
});

test('write says whether a reload is needed', () => {
  const prefs = fake();
  assert.deepEqual(write('a', true, prefs), { ok: true, reload: true });
  assert.deepEqual(write('b', true, prefs), { ok: true, reload: false });
});

test('an unknown toggle is refused rather than invented', () => {
  assert.deepEqual(write('nope', true, fake()), { ok: false, reload: false });
});

test('storage that refuses reports failure instead of claiming it saved', () => {
  // Private browsing throws. The sheet puts the checkbox back rather than
  // showing a setting that is not stored.
  const prefs = [{ id: 'a', label: 'A', note: 'n', get: () => false, set: () => { throw new Error('denied'); } }];
  assert.deepEqual(write('a', true, prefs), { ok: false, reload: false });
});

test('read survives a getter that throws', () => {
  const prefs = [{ id: 'a', label: 'A', note: 'n', get: () => { throw new Error('denied'); }, set: () => {} }];
  assert.deepEqual(read(prefs), { a: false });
});

test('the real list is well formed', () => {
  assert.ok(DEVICE_PREFS.length > 0);
  const ids = DEVICE_PREFS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
  for (const p of DEVICE_PREFS) {
    assert.ok(p.label && p.note, `${p.id} needs a label and a note`);
    assert.equal(typeof p.get, 'function');
    assert.equal(typeof p.set, 'function');
  }
});

test('Play mode is in the list, and reading it needs no localStorage', () => {
  // device-prefs.js must not import lib/play/mount.js, which starts Play mode
  // on load. Importing this module in node, with no DOM and no storage, is
  // the test: it got here.
  const play = DEVICE_PREFS.find((p) => p.id === 'play');
  assert.ok(play, 'Play mode should be switchable from Settings');
  assert.ok(play.reload, 'the flag is read once at page load, so say so');
  assert.equal(play.get(), false, 'no storage in node: off, not a throw');
});

test('the two rooms are not a switch any more: they are the only layout', () => {
  assert.equal(DEVICE_PREFS.find((p) => p.id === 'rooms'), undefined);
});

test('every shipped toggle is a preview, drawn in the open Preview features section', () => {
  assert.ok(DEVICE_PREFS.length > 0);
  for (const p of DEVICE_PREFS) assert.equal(p.feature, true, `${p.id} is drawn up front, not under a fold`);
});

test('a flag whose storage refuses reports failure, so the sheet does not claim it saved', async () => {
  const keep = globalThis.localStorage;
  const deaf = { getItem: () => null, setItem() {}, removeItem() {} }; // takes the write, keeps nothing
  const throws = { getItem: () => { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  try {
    for (const mod of ['./play/flag.js']) {
      const { setOn, on } = await import(mod);
      for (const store of [deaf, throws]) {
        globalThis.localStorage = store;
        assert.equal(setOn(true), false, `${mod} ${store === deaf ? 'drops' : 'throws'}`);
        assert.equal(on(), false);
      }
      const mem = {}; // a working one still says true
      globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
      assert.equal(setOn(true), true);
      assert.equal(on(), true);
      assert.equal(setOn(false), true);
    }
  } finally {
    if (keep === undefined) delete globalThis.localStorage; else globalThis.localStorage = keep;
  }
  const real = [{ id: 'a', label: 'A', note: 'n', get: () => false, set: () => false }];
  assert.deepEqual(write('a', true, real), { ok: false, reload: false });
});
