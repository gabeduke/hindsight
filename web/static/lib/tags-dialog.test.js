import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextColor, createdTags } from './tags-dialog.js';

test('a new tag takes the first color nobody wears, then the least worn', () => {
  assert.equal(nextColor([]), 1);
  assert.equal(nextColor([{ color: 1 }, { color: 2 }]), 3);
  assert.equal(nextColor([{ color: 1 }, { color: 3 }]), 2);
  const all = Array.from({ length: 8 }, (_, i) => ({ color: i + 1 }));
  assert.equal(nextColor(all), 1);
  assert.equal(nextColor([...all, { color: 1 }]), 2);
});

// "+ New tag" on a take's sheet (or "Make a sticker" in the chair) saved the
// tag and left the take bare: five taps and a keyboard before it did anything
// to the take it was made for. What Save made new is what the take is given.
test('the tags a save made are the ones that were not there before', () => {
  const before = [{ id: 'a', name: 'bento', color: 2 }];
  assert.deepEqual(createdTags(before, [{ id: 'a', name: 'bento', color: 2 }, { id: 'b', name: 'Funk', color: 3 }]), [{ id: 'b', name: 'Funk', color: 3 }]);
  assert.deepEqual(createdTags([], [{ id: 'b', name: 'Funk', color: 3 }]), [{ id: 'b', name: 'Funk', color: 3 }], 'the first tag');
});

test('renaming, recoloring or deleting makes nothing new', () => {
  const before = [{ id: 'a', name: 'bento', color: 2 }, { id: 'c', name: 'late', color: 5 }];
  assert.deepEqual(createdTags(before, [{ id: 'a', name: 'Bento box', color: 4 }, { id: 'c', name: 'late', color: 5 }]), []);
  assert.deepEqual(createdTags(before, [{ id: 'a', name: 'bento', color: 2 }]), []);
});
