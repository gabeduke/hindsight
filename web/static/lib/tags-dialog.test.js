import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextColor } from './tags-dialog.js';

test('a new tag takes the first color nobody wears, then the least worn', () => {
  assert.equal(nextColor([]), 1);
  assert.equal(nextColor([{ color: 1 }, { color: 2 }]), 3);
  assert.equal(nextColor([{ color: 1 }, { color: 3 }]), 2);
  const all = Array.from({ length: 8 }, (_, i) => ({ color: i + 1 }));
  assert.equal(nextColor(all), 1);
  assert.equal(nextColor([...all, { color: 1 }]), 2);
});
