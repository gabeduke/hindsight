// web/static/lib/buffer/replaced.test.js
// GRAB's Undo (F3 of the flow spec): what the toast says about the buffer a
// GRAB replaced, and the note a take's GRAB leaves for the Studio, which it
// opens on straight away.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { replacedWords, replacedLine, remember, recall, KEY } from './replaced.js';

const BAR = 96000;
const ring = (bars = 4) => ({ created: 'c1', frames: bars * BAR, grab: { bar_frames: BAR, sources: ['main'] } });
const fromTake = { created: 'c2', frames: 4 * BAR, grab: { bar_frames: BAR, take: 'jam_a.wav', sources: ['Tuesday jam'] } };

function store() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('the replaced buffer is named by its length and where it came from', () => {
  assert.equal(replacedWords(ring(4), 8), 'the buffer’s 4 BARS from the feed');
  assert.equal(replacedWords(ring(1), 2), 'the buffer’s 1 BAR from the feed');
  assert.equal(replacedWords(fromTake, 8), 'the buffer’s 4 BARS from Tuesday jam');
});

test('with no tempo it is named in seconds', () => {
  const b = { created: 'c3', frames: 172800, grab: { sources: ['main'] } };
  assert.equal(replacedWords(b, 3.6), 'the buffer’s 3.6s from the feed');
});

test('the toast line says what was replaced, and that nobody had dropped or kept it', () => {
  assert.equal(replacedLine(ring(4), 8), 'Replaced the buffer’s 4 BARS from the feed, never dropped or kept');
});

test('a take’s GRAB leaves one note, for the buffer it made, and the Studio reads it once', () => {
  const s = store();
  remember(s, { by: 'new', line: 'Replaced the buffer’s 4 BARS from the feed' });
  assert.ok(s.m.has(KEY));
  assert.equal(recall(s, 'new'), 'Replaced the buffer’s 4 BARS from the feed');
  assert.equal(recall(s, 'new'), '', 'said once');
  assert.ok(!s.m.has(KEY), 'and gone');
});

test('a note for another buffer is not said, and is let go', () => {
  const s = store();
  remember(s, { by: 'older', line: 'x' });
  assert.equal(recall(s, 'newer'), '');
  assert.ok(!s.m.has(KEY));
});

test('no storage, or a broken one, say nothing and throw nothing', () => {
  const broken = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => remember(broken, { by: 'a', line: 'b' }));
  assert.equal(recall(broken, 'a'), '');
  assert.equal(recall(null, 'a'), '');
  assert.doesNotThrow(() => remember(null, { by: 'a', line: 'b' }));
});
