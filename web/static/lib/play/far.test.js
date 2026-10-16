import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FarPads } from './far.js';

test('another hand’s pad lights when it’s heard and goes when it stops', () => {
  const f = new FarPads();
  f.at('break', true, 100);
  assert.deepEqual(f.tick(50), []);
  assert.deepEqual(f.tick(100), [{ pad: 'break', on: true }]);
  f.at('break', false, 200);
  assert.deepEqual(f.tick(250), [{ pad: 'break', on: false }]);
  assert.equal(f.has('break'), false);
});

test('a press here makes the pad this hand’s: the controller letting go after never leaves it lit', () => {
  const f = new FarPads();
  f.at('reverse', true, 0);
  f.tick(0);                          // the controller holds REV
  assert.deepEqual(f.pressed('reverse'), ['reverse']); // W here too
  f.tick(10);
  assert.equal(f.has('reverse'), false);
  f.at('reverse', false, 20);         // both let go: the Pi's one stop
  f.tick(30);
  assert.equal(f.has('reverse'), false);
});

test('a (re)connect sets the marks to exactly what’s held', () => {
  const f = new FarPads();
  f.at('break', true, 0);
  f.tick(0);
  f.at('chop', true, 50);
  assert.deepEqual(f.hello([]).sort(), ['break']);
  assert.deepEqual(f.tick(100), [], 'what was on its way before is forgotten');
  assert.deepEqual(f.hello(['stop']), ['stop']);
  assert.equal(f.has('stop'), true);
});

test('the Pi’s own list puts a mark right: what it says is held lights, what it doesn’t goes dark', () => {
  const f = new FarPads();
  assert.deepEqual(f.put('filter', true), ['filter']);
  assert.deepEqual(f.put('filter', true), [], 'already lit: nothing to change');
  assert.equal(f.has('filter'), true);
  assert.deepEqual(f.put('filter', false), ['filter']);
  assert.deepEqual(f.put('filter', false), []);
  assert.equal(f.has('filter'), false);
});
