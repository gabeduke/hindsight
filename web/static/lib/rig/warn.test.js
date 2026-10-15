import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsTape } from './warn.js';

const sources = [
  { name: 'main', leaks: ['A', 'B'], clean: false },
  { name: 'ch1', leaks: ['A'], clean: false },
  { name: 'ch2', leaks: ['B'], clean: true },
  { name: 'aux', leaks: [], clean: true },
];
const inputOf = (n) => ({ 1: 'aux', 2: 'ch1', 3: 'ch2', 4: 'main' })[n];

test('the amber dot: an armed track whose input hears where the tape plays', () => {
  assert.match(recordsTape(2, [2, 3], sources, inputOf), /CH1 hears bus A/);
  assert.equal(recordsTape(3, [2, 3], sources, inputOf), null, 'CH2 hears bus B, where nothing plays');
  assert.equal(recordsTape(2, [3], sources, inputOf), null, 'not armed: no dot');
  assert.equal(recordsTape(1, [1], sources, inputOf), null, 'aux hears no bus');
  assert.match(recordsTape(4, [4], sources, inputOf), /bus A and B/);
});
