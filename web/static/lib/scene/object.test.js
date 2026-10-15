import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneObject } from './object.js';

test('state is a frozen snapshot, replaced whole by set', () => {
  const o = new SceneObject('vu:0', 'vu', { level: -20 });
  const before = o.state;
  assert.ok(Object.isFrozen(before));
  assert.throws(() => { 'use strict'; before.level = 0; }, TypeError);
  assert.equal(o.set({ level: -10, peak: true }), true);
  assert.deepEqual(o.state, { level: -10, peak: true });
  assert.notEqual(o.state, before, 'a new snapshot, so a renderer can tell by identity');
  assert.equal(before.level, -20, 'the old one is untouched');
});

test('set emits change only when something changed', () => {
  const o = new SceneObject('reels', 'reels', { pos: 0 });
  const seen = [];
  const off = o.on('change', (d) => seen.push(d.patch));
  assert.equal(o.set({ pos: 0 }), false);
  assert.equal(o.set({}), false);
  o.set({ pos: 10 });
  o.set({ pos: 10, at: 5 });
  assert.deepEqual(seen, [{ pos: 10 }, { pos: 10, at: 5 }]);
  off();
  o.set({ pos: 11 });
  assert.equal(seen.length, 2, 'off() stops listening');
});

test('NaN is no change, and -0 is one', () => {
  // Object.is: a level that stays NaN shouldn't wake anything.
  const o = new SceneObject('vu:0', 'vu', { level: NaN });
  assert.equal(o.set({ level: NaN }), false);
  assert.equal(o.set({ level: -0 }), true);
});

test('renderers can emit what the hand did, and the page hears it', () => {
  const o = new SceneObject('take:41', 'cassette');
  let got = null;
  o.on('pick', (d, who) => { got = [d, who.id]; });
  o.emit('pick', { x: 3 });
  assert.deepEqual(got, [{ x: 3 }, 'take:41']);
  o.emit('drop'); // nobody listening is fine
});

test('the view is null until a scene derives one', () => {
  assert.equal(new SceneObject('a', 'vu').view, null);
});

test('an object needs an id and a kind', () => {
  assert.throws(() => new SceneObject('', 'vu'), TypeError);
  assert.throws(() => new SceneObject('a'), TypeError);
});
