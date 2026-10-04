import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withAlpha } from './theme.js';

test('a token colour takes an alpha, whichever way it is written', () => {
  assert.equal(withAlpha('#cb4b16', 0.5), 'rgba(203,75,22,0.5)');
  assert.equal(withAlpha('#abc', 1), 'rgba(170,187,204,1)');
  assert.equal(withAlpha('  #268BD2 ', 0.25), 'rgba(38,139,210,0.25)');
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1,2,3,0.2)');
  assert.equal(withAlpha('rgba(1, 2, 3, 0.9)', 0.2), 'rgba(1,2,3,0.2)');
});

test('a colour it cannot read comes back as it was, never NaN', () => {
  assert.equal(withAlpha('nonsense', 0.2), 'nonsense');
  assert.equal(withAlpha('', 0.2), '');
  assert.equal(withAlpha('#12345', 0.2), '#12345');
});
