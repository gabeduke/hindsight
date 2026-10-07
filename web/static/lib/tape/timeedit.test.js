// web/static/lib/tape/timeedit.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertPreview, deletePreview, spanWords, barOf, insertRefusal } from './timeedit.js';

// As internal/tape timeedit_test.go's arranged(): a bar is 96000.
const tape = () => ({
  loop: { in: 96000, out: 192000, on: true },
  tracks: [
    { n: 1, clips: [{ id: 'A', at: 0, src: 0, frames: 96000, layer: 0 }] },
    { n: 2, clips: [{ id: 'B', at: 96000, src: 0, frames: 96000, layer: 0 }] },
    { n: 3, clips: [{ id: 'C', at: 48000, src: 100, frames: 96000, layer: 0, fade_in: 480, fade_out: 480 }] },
    { n: 4, clips: [] },
  ],
  sections: [{ id: 'v', name: 'Verse', at: 0, end: 96000 }, { id: 'c', name: 'Chorus', at: 96000, end: 192000 }],
});

test('insertPreview pushes everything from the point on, and shows the board in the gap', () => {
  const t = insertPreview(tape(), 96000, { frames: 48000, tracks: [[{ at: 0, frames: 48000, src: 0 }]] }, 4);
  assert.equal(t.tracks[0].clips[0].at, 0);
  assert.equal(t.tracks[1].clips[0].at, 144000);
  const [head, tail] = t.tracks[2].clips;
  assert.deepEqual([head.at, head.frames, head.fade_out, tail.at, tail.src, tail.fade_in], [48000, 48000, 0, 144000, 48100, 0]);
  assert.equal(t.tracks[3].clips[0].ghost, true);
  assert.equal(t.tracks[3].clips[0].at, 96000);
  assert.deepEqual(t.sections.map((s) => [s.at, s.end]), [[0, 96000], [144000, 240000]]);
  assert.deepEqual([t.loop.in, t.loop.out], [144000, 240000]);
});

test('insertPreview inside a section stretches it', () => {
  const t = insertPreview(tape(), 120000, { frames: 1000, tracks: [[{ at: 0, frames: 1000, src: 0 }]] }, 1);
  assert.deepEqual([t.sections[1].at, t.sections[1].end], [96000, 193000]);
});

test('deletePreview cuts the span out and closes the gap', () => {
  const t = deletePreview(tape(), 48000, 144000);
  assert.deepEqual(t.tracks[0].clips.map((c) => [c.at, c.frames]), [[0, 48000]]);
  assert.deepEqual(t.tracks[1].clips.map((c) => [c.at, c.frames, c.src]), [[48000, 48000, 48000]]);
  assert.equal(t.tracks[2].clips.length, 0);
  assert.deepEqual(t.sections.map((s) => [s.at, s.end]), [[0, 48000], [48000, 96000]]);
  const whole = deletePreview(tape(), 96000, 192000);
  assert.deepEqual(whole.sections.map((s) => s.name), ['Verse']);
});

test('spanWords and barOf: bars with a tempo, else seconds', () => {
  const grid = { frames: 96000, bars: 1 };
  assert.equal(spanWords(4 * 96000, grid, 48000), '4 bars');
  assert.equal(spanWords(96000, grid, 48000), '1 bar');
  assert.equal(spanWords(48000, null, 48000), '1.0 s');
  assert.equal(barOf(0, grid), 1);
  assert.equal(barOf(8 * 96000, grid), 9);
  // A bar that isn't a whole number of frames: bar 4's line rounds down to
  // 411428, a hair under 3 × 137142.75, and is still bar 4 there.
  const odd = { frames: 548571, bars: 4 };
  assert.equal(barOf(411428, odd), 4);
  assert.equal(barOf(411427, odd), 3);
  assert.equal(barOf(137143, odd), 2);
  assert.equal(barOf(137142, odd), 1);
});

test('insertPreview stacks a board’s overlapping clips as the Pi does', () => {
  const tape = { length: 10 * 96000, loop: { in: 0, out: 0 }, sections: [], tracks: [{ clips: [{ id: 'a', at: 0, frames: 96000, src: 0, layer: 0 }] }] };
  const board = { frames: 96000, tracks: [[{ at: 0, frames: 96000, src: 0, layer: 0 }, { at: 48000, frames: 48000, src: 0, layer: 1 }]] };
  const g = insertPreview(tape, 96000, board, 1).tracks[0].clips.filter((c) => c.ghost);
  assert.deepEqual(g.map((c) => [c.at, c.layer]), [[96000, 0], [144000, 1]]);
});

test('insertRefusal: tracks that do not fit, or a push past the end', () => {
  const four = { clips: [] };
  const tape = { length: 4 * 96000, loop: { in: 0, out: 96000 }, sections: [], tracks: [{ clips: [{ id: 'a', at: 0, frames: 2 * 96000, src: 0, layer: 0 }] }, four, four, four] };
  const one = { frames: 96000, tracks: [[{ at: 0, frames: 96000, src: 0, layer: 0 }]] };
  assert.equal(insertRefusal(tape, 0, one, 1), '');
  assert.equal(insertRefusal(tape, 0, one, 5), 'tracks');
  assert.equal(insertRefusal(tape, 0, { ...one, tracks: [[], [], []] }, 3), 'tracks');
  assert.equal(insertRefusal(tape, 0, { ...one, frames: 3 * 96000 }, 1), 'length'); // 2 bars on it, 3 more
  assert.equal(insertRefusal(tape, 3.5 * 96000, one, 1), 'length'); // the point itself near the end
});
