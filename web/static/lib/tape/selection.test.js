import { test } from 'node:test';
import assert from 'node:assert/strict';
import { none, only, all, toggle, ids, keep, settle } from './selection.js';

test('a click selects one clip in place of the rest', () => {
  assert.deepEqual(only('a'), { picked: 'a', multi: null });
  assert.deepEqual(ids(only('a')), ['a']);
  assert.deepEqual(ids(none()), []);
});

test('Shift-click adds a clip, and takes it off again', () => {
  let s = toggle(only('a'), 'b');
  assert.deepEqual(ids(s).sort(), ['a', 'b']);
  assert.equal(s.picked, null);
  s = toggle(s, 'c');
  assert.deepEqual(ids(s).sort(), ['a', 'b', 'c']);
  s = toggle(s, 'b');
  assert.deepEqual(ids(s).sort(), ['a', 'c']);
  // Down to one: that clip alone, with its grips.
  assert.deepEqual(toggle(s, 'a'), only('c'));
  // The last one off: nothing.
  assert.deepEqual(toggle(only('c'), 'c'), none());
  // From nothing, a Shift-click selects that clip.
  assert.deepEqual(toggle(none(), 'x'), only('x'));
});

test('Select more keeps collecting from one clip', () => {
  const s = toggle(only('a'), 'b', true);
  const one = toggle(s, 'b', true);
  assert.equal(one.picked, null);
  assert.deepEqual(ids(one), ['a']);
});

test('select all, and clips that leave the tape leave the selection', () => {
  assert.deepEqual(all([]), none());
  assert.deepEqual(all(['a']), only('a'));
  const s = all(['a', 'b', 'c']);
  assert.deepEqual(ids(s).sort(), ['a', 'b', 'c']);
  assert.equal(keep(s, new Set(['a', 'b', 'c'])), s); // unchanged: the same object
  assert.deepEqual(ids(keep(s, new Set(['b']))), ['b']);
  assert.deepEqual(keep(s, new Set()), none());
  assert.deepEqual(keep(only('a'), new Set(['b'])), none());
  const o = only('a');
  assert.equal(keep(o, new Set(['a'])), o);
});

test('the last of several left is a clip on its own', () => {
  const s = all(['a', 'b']);
  assert.equal(settle(s), s);
  assert.deepEqual(settle(keep(s, new Set(['b']))), only('b'));
  assert.deepEqual(settle({ picked: null, multi: new Set() }), none());
  const o = only('a');
  assert.equal(settle(o), o);
  assert.deepEqual(settle(toggle(only('a'), 'a', true)), none());
  assert.deepEqual(settle({ picked: null, multi: new Set(['a']) }), only('a'));
});
