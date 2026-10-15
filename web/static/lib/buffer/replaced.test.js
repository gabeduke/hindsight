// web/static/lib/buffer/replaced.test.js
// GRAB's Undo (F3 of the flow spec): what the toast says about the buffer a
// GRAB replaced, and the note a take's GRAB leaves for the Studio, which it
// opens on straight away.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { replacedWords, replacedLine, remember, recall, forget, raiseUndo, editBody, undoWords, KEY } from './replaced.js';

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

test('a copy or a cut that was replaced is named by where it was taken from', () => {
  const cp = { created: 'c4', frames: 8 * BAR / 4, from: 'Song one, bars 1–4', tracks: [[{}]] };
  assert.equal(replacedWords(cp, 4), 'the buffer’s 4.0s from Song one, bars 1–4');
  assert.equal(replacedWords({ created: 'c5', frames: 96000, tracks: [[{}]] }, 2), 'the buffer’s 2.0s from a copy');
});

test('a take’s note is only good for a minute, and is let go when read late', () => {
  const s = store();
  remember(s, { by: 'new', line: 'x' }, 1000);
  assert.equal(recall(s, 'new', 1000 + 30_000), 'x', 'read in time');
  remember(s, { by: 'new', line: 'x' }, 1000);
  assert.equal(recall(s, 'new', 1000 + 61_000), '', 'a day-old note is not a toast');
  assert.ok(!s.m.has(KEY), 'and it is gone');
});

test('a page that is not the Studio lets the note go', () => {
  const s = store();
  remember(s, { by: 'new', line: 'x' });
  forget(s);
  assert.ok(!s.m.has(KEY));
  assert.doesNotThrow(() => forget(null));
});

test('only the newest Undo is on screen: raising one dismisses the one before', () => {
  const gone = [];
  const mk = (n) => () => ({ dismiss: () => gone.push(n) });
  const t1 = mk(1), t2 = mk(2);
  raiseUndo(t1, 'first', 'ok', () => {});
  assert.deepEqual(gone, []);
  raiseUndo(t2, 'second', 'ok', () => {});
  assert.deepEqual(gone, [1], 'the older toast’s Undo went');
  raiseUndo(() => undefined, 'a toast stand-in that hands nothing back', 'ok', () => {});
  assert.deepEqual(gone, [1, 2]);
  assert.doesNotThrow(() => raiseUndo(() => undefined, 'again', 'ok', () => {}));
});

test('the rooms’ Cut and Copy ask the Pi to leave the crate alone, and only they do', () => {
  assert.deepEqual(editBody('copy', { clips: ['a'] }, true), { clips: ['a'], no_crate: true });
  assert.deepEqual(editBody('lift', {}, true), { no_crate: true });
  assert.deepEqual(editBody('split', {}, true), {}, 'an edit that fills no clipboard is as it was');
  assert.deepEqual(editBody('copy', { clips: ['a'] }, false), { clips: ['a'] }, 'the rooms off send what they always sent');
  assert.deepEqual(editBody('lift', {}, false), {});
});

test('an Undo refused says the Pi’s words, not a prefix of ours', () => {
  assert.equal(undoWords({ status: 409, message: 'Already dropped or kept — undo the drop instead' }), 'Already dropped or kept — undo the drop instead');
  assert.equal(undoWords({ status: 500, message: 'boom' }), 'Could not undo the grab: boom');
});

test('no storage, or a broken one, say nothing and throw nothing', () => {
  const broken = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('private mode'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => remember(broken, { by: 'a', line: 'b' }));
  assert.equal(recall(broken, 'a'), '');
  assert.equal(recall(null, 'a'), '');
  assert.doesNotThrow(() => remember(null, { by: 'a', line: 'b' }));
});
