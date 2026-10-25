// web/static/lib/tape/tape-menu.test.js
// What the tape's menu says (lib/tape/tape-menu.js): each tape's line, the
// confirm sheet's words before Delete this tape…, and which tape opens in
// its place. Delete once asked for another tape's name in the browser's own
// prompt, and could not delete the tape you were on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeRowSub, deleteWords, afterDelete, partsOf, barsOf } from './tape-menu.js';

const SR = 48000;
const bar = SR * 2.5; // 96 BPM, 4 beats
const grid = { frames: 4 * bar, bars: 4 };
const clip = (at, bars) => ({ at, frames: Math.round(bars * bar) });
const tape = (clips, extra = {}) => ({
  name: 'Song sketch', grid, tracks: [{ clips: clips.slice(0, 2) }, { clips: clips.slice(2) }, { clips: [] }, { clips: [] }], ...extra,
});

test('a tape’s line in the menu: its tempo and its parts', () => {
  assert.equal(tapeRowSub({ bpm: 96, clips: 4 }), '96 BPM · 4 parts');
  assert.equal(tapeRowSub({ bpm: 84.25, clips: 1 }), '84.3 BPM · 1 part');
  assert.equal(tapeRowSub({ bpm: 0, clips: 0 }), 'no parts yet');
  assert.equal(tapeRowSub({ clips: 2 }), '2 parts', 'no tempo yet: the parts alone');
});

test('the parts, and the bars they run to from the tape’s start', () => {
  const t = tape([clip(0, 4), clip(4 * bar, 2), clip(bar, 7)]);
  assert.equal(partsOf(t), 3);
  assert.equal(barsOf(t), 8, 'the last part ends in bar 8');
  assert.equal(barsOf(tape([clip(0, 4)])), 4, 'ending on a bar line is that bar, not the next');
  assert.equal(barsOf({ ...t, grid: null }), null, 'no grid, no bars');
  assert.equal(barsOf(tape([])), 0);
});

test('Delete asks by the tape’s name, saying what goes with it and that it can’t be undone', () => {
  assert.deepEqual(deleteWords(tape([clip(0, 4), clip(4 * bar, 2), clip(bar, 7)])), {
    title: 'Delete “Song sketch”?',
    line: '3 parts, 8 bars. This can’t be undone.',
  });
  assert.deepEqual(deleteWords(tape([clip(0, 1)])).line, '1 part, 1 bar. This can’t be undone.');
  assert.equal(deleteWords(tape([], { grid: null })).line, 'Nothing is on it yet. This can’t be undone.');
  assert.equal(deleteWords(tape([clip(0, 2)], { grid: null })).line, '1 part. This can’t be undone.', 'no tempo: the parts alone');
  assert.equal(deleteWords({ name: '  ', tracks: [] }).title, 'Delete “this tape”?');
});

test('after Delete, the most recently changed other tape opens; with none, a new one does', () => {
  const list = [
    { id: 'a', modified: '2026-10-24T10:00:00Z' },
    { id: 'b', modified: '2026-10-25T09:00:00Z' },
    { id: 'c', modified: '2026-10-25T11:00:00Z' },
  ];
  assert.equal(afterDelete(list, 'c'), 'b', 'never the one going');
  assert.equal(afterDelete(list, 'a'), 'c');
  assert.equal(afterDelete([{ id: 'a' }], 'a'), null, 'the last tape: a new empty one');
  assert.equal(afterDelete(null, 'a'), null);
  assert.equal(afterDelete([{ id: 'x', created: '2026-01-01T00:00:00Z' }, { id: 'y' }], 'z'), 'x', 'by when it was made, when the Pi doesn’t say when it changed');
});
