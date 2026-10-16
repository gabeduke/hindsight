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

test('the ticker parks under an unfolded strip while the tape is stopped', async () => {
  const { wantsFrames } = await import('./strip.js');
  const idle = { open: true, playing: false, moving: false, pending: false, held: false };
  assert.equal(wantsFrames(idle), false);
  assert.equal(wantsFrames({ ...idle, playing: true }), true, 'the ring sweeps a playing tape');
  assert.equal(wantsFrames({ ...idle, open: false, playing: true }), false, 'folded, there is no ring');
  assert.equal(wantsFrames({ ...idle, moving: true }), true, 'the reel coasting down');
  assert.equal(wantsFrames({ ...idle, pending: true }), true);
  assert.equal(wantsFrames({ ...idle, open: false, held: true }), true, 'a pad waiting for its line');
});

test('the strip and the buffer take turns: never both in full', async () => {
  // At 1440 x 790 the unfolded strip over the open bench cut the bench's
  // bottom row off and left no lane, and on a phone the sheet sat over the
  // EDIT | PLAY toggle. One is in full at a time: the one that moved last.
  const { turns } = await import('./strip.js');
  const was = (strip, buffer) => ({ strip, buffer });
  assert.deepEqual(turns(was(true, false), 'strip'), { strip: true, bench: 'shut' }, 'no buffer: the strip is as it was');
  assert.deepEqual(turns(was(false, false), 'buffer'), { strip: false, bench: 'shut' });
  assert.deepEqual(turns(was(false, true), 'strip'), { strip: false, bench: 'full' }, 'the strip folded: the bench is back in full');
  assert.deepEqual(turns(was(true, true), 'strip'), { strip: true, bench: 'peek' }, 'unfolding the strip folds the buffer to its peek');
  assert.deepEqual(turns(was(true, true), 'buffer'), { strip: false, bench: 'full' }, 'bringing the buffer forward folds the strip');
  assert.deepEqual(turns(was(true, true)), { strip: true, bench: 'peek' }, 'both found open (a page load): the instrument keeps the floor');
});

test('the buffer says when it is brought forward, and the strip answers', async () => {
  // The two halves meet in one document event, and nothing else would fail
  // if either were dropped: the layout only breaks in a browser.
  const { readFileSync } = await import('node:fs');
  const buffer = readFileSync(new URL('../buffer/buffer.js', import.meta.url), 'utf8');
  const strip = readFileSync(new URL('./strip.js', import.meta.url), 'utf8');
  assert.match(buffer, /const forward = \(\) => doc\.dispatchEvent\(new CustomEvent\('hindsight:bench-forward'\)\)/);
  assert.match(buffer, /st\.grabbing = true;\s*st\.open = true;\s*render\(\);\s*forward\(\);/, 'a grab of this page brings it forward');
  assert.match(buffer, /el\.reopen\.addEventListener\('click', \(\) => \{[^}]*forward\(\);/, 'so does its Buffer ▴ key');
  assert.match(strip, /addEventListener\('hindsight:bench-forward', onForward\)/);
  // A GRAB the strip plays itself is the strip moving: it stays.
  assert.match(strip, /onForward = \(\) => yieldTo\(verbing \? 'strip' : 'buffer'\)/);
  assert.match(strip, /verbing = true;\s*try \{ doc\.dispatchEvent\(new CustomEvent\('hindsight:verb'/);
});
