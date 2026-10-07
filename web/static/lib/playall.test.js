import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanOf, firstOf, nextOf, atEnd } from './playall.js';

test('Play all plays each take’s selection, else the whole take', () => {
  assert.deepEqual(spanOf({ sample_rate: 48000, duration_seconds: 30, trim: { start_frame: 96000, end_frame: 480000 } }), { from: 2, to: 10 });
  assert.deepEqual(spanOf({ sample_rate: 48000, duration_seconds: 30 }), { from: 0, to: 30 });
  assert.deepEqual(spanOf({ sample_rate: 48000, duration_seconds: 30, trim: { start_frame: 0, end_frame: 0 } }), { from: 0, to: 30 });
  assert.deepEqual(spanOf({ sample_rate: 48000, duration_seconds: 5, trim: { start_frame: 48000, end_frame: 480000 } }), { from: 1, to: 5 }); // Out past the end
});

test('Play all starts at the picked take, and moves on in the list’s order', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(firstOf(order, 'b'), 'b');
  assert.equal(firstOf(order, 'z'), 'a'); // picked, but filtered out
  assert.equal(firstOf(order, null), 'a');
  assert.equal(firstOf([], null), null);
  assert.equal(nextOf(order, 'a'), 'b');
  assert.equal(nextOf(order, 'c'), null);
  assert.equal(nextOf(order, 'z'), null); // gone from the list: stop
});

test('a take is done at its Out, or when its audio ends', () => {
  assert.equal(atEnd({ from: 2, to: 10 }, 9.9, false), false);
  assert.equal(atEnd({ from: 2, to: 10 }, 9.99, false), true);
  assert.equal(atEnd({ from: 2, to: 10 }, 3, true), true);
});
