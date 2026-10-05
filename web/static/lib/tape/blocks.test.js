// web/static/lib/tape/blocks.test.js
// A clip on a tape lane as a block: what it's labelled, and the bars inside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clipLabel, blockLevels, labelFits, placeLabel } from './blocks.js';

test('clipLabel says reversed, repeat, or where the clip came from', () => {
  const a = { id: 'a', file: 'audio/x.wav', src: 0, at: 0, source: 'aux' };
  const b = { id: 'b', file: 'audio/x.wav', src: 0, at: 96000, source: 'aux' };
  const c = { id: 'c', file: 'audio/y.wav', src: 0, at: 0, source: 'main', reversed: { file: 'audio/z.wav' } };
  const d = { id: 'd', file: 'audio/w.wav', src: 0, at: 0 };
  const track = { clips: [b, a, c, d] };
  assert.equal(clipLabel(a, track), 'aux');
  assert.equal(clipLabel(b, track), 'repeat');
  assert.equal(clipLabel(c, track), 'reversed');
  assert.equal(clipLabel(d, track), '');
});

test('clipLabel calls a clip of the same file but other audio by its source', () => {
  const a = { id: 'a', file: 'audio/x.wav', src: 0, at: 0, source: 'ch1' };
  const b = { id: 'b', file: 'audio/x.wav', src: 48000, at: 96000, source: 'ch1' };
  assert.equal(clipLabel(b, { clips: [a, b] }), 'ch1');
});

// One channel, eight buckets of a one-second file at 8 frames a second.
const pd = {
  channels: 1, buckets: 8, sample_rate: 8, duration: 1,
  data: [Float32Array.from([-0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.9, 0.9, -0.9, 0.9, -0.9, 0.9, -0.9, 0.9])],
};

test("blockLevels reads only the clip's part of its file", () => {
  const second = blockLevels(pd, { src: 4, frames: 4 }, 40);
  for (const v of second) assert.ok(Math.abs(v - 0.9) < 1e-6);
  const first = blockLevels(pd, { src: 0, frames: 4 }, 40);
  for (const v of first) assert.ok(Math.abs(v - 0.1) < 1e-6);
});

test('blockLevels holds as many bars as fit, 4 px apart', () => {
  assert.equal(blockLevels(pd, { src: 0, frames: 8 }, 48).length, 11);
  assert.equal(blockLevels(pd, { src: 0, frames: 8 }, 2).length, 1);
});

test('a label fits a block 64 px wide or more', () => {
  assert.equal(labelFits(63), false);
  assert.equal(labelFits(64), true);
});

test('placeLabel keeps a label clear of the ones already on its lane', () => {
  const placed = [];
  assert.equal(placeLabel(placed, { x: 10, y: 4, w: 30, h: 12 }), true);
  assert.equal(placeLabel(placed, { x: 12, y: 7, w: 30, h: 12 }), false); // a layer's, 3 px lower: skipped
  assert.equal(placeLabel(placed, { x: 60, y: 4, w: 30, h: 12 }), true);
  assert.equal(placed.length, 2);
});
