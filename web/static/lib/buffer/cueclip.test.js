import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardOf, clipOn, ringOf, grabbedWords } from './cueclip.js';
import { boardKey, bufferMeta, clampWindow } from './model.js';

const grab = { sources: ['ch1', 'aux'], frames: 96000, before: 48000, after: 48000, in: 0, out: 96000, bar_frames: 48000, downbeat: 0 };
const clip = {
  id: 'c1', name: 'ch1 + aux', file: 'audio/a.wav', src: 48000, frames: 96000, loop: true, gain_db: -3,
  fade_in: 100, fade_in_shape: 'linear', grab,
  lanes: [{ file: 'audio/a.wav', src: 48000, frames: 96000, source: 'ch1' }, { file: 'audio/b.wav', src: 48000, frames: 96000, source: 'aux' }],
};

test('a cue clip reads as a board: a track per lane, the clip’s level and fades on each', () => {
  const b = boardOf(clip);
  assert.equal(b.created, 'c1');
  assert.equal(b.frames, 96000);
  assert.equal(b.tracks.length, 2);
  for (const [i, source] of ['ch1', 'aux'].entries()) {
    const l = b.tracks[i][0];
    assert.equal(l.source, source);
    assert.equal(l.at, 0);
    assert.equal(l.gain_db, -3);
    assert.equal(l.fade_in, 100);
    assert.equal(l.fade_in_shape, 'linear');
  }
  // What the buffer's model reads, it reads the same.
  assert.equal(bufferMeta(b, 48000), '2 bars · 2.00 s · 240 BPM');
  assert.deepEqual(clampWindow(b.grab, -1e9, 1e9, 48000), { in: -48000 + 480, out: 96000 + 48000 - 480 });
  // A change of level is a change of what it plays.
  assert.notEqual(boardKey(b), boardKey(boardOf({ ...clip, gain_db: 0 })));
});

test('a clip from before clips kept their inputs is one lane, its file, and no grab', () => {
  const b = boardOf({ id: 'old', file: 'audio/cue1.wav', src: 0, frames: 1000, source: 'buffer' });
  assert.equal(b.tracks.length, 1);
  assert.equal(b.tracks[0][0].file, 'audio/cue1.wav');
  assert.equal(b.grab, null);
  assert.equal(boardOf(null), null);
});

test('clipOn finds a clip on the lane by id', () => {
  const tape = { cue: { clips: [clip] } };
  assert.equal(clipOn(tape, 'c1'), clip);
  assert.equal(clipOn(tape, 'gone'), null);
  assert.equal(clipOn({}, 'c1'), null);
  assert.equal(clipOn(tape, ''), null);
});

test('the ring counts to the next bar line', () => {
  const grid = { frames: 192000, bars: 4 }; // a bar is 48000
  assert.equal(ringOf(0, grid), 0);
  assert.equal(ringOf(24000, grid), 0.5);
  assert.equal(ringOf(48000 + 12000, grid), 0.25);
  assert.equal(ringOf(-12000, grid), 0.75);
  assert.equal(ringOf(1000, null), null);
  assert.equal(ringOf(NaN, grid), null);
});

test('a GRAB says what it took, and what it took the place of', () => {
  assert.equal(grabbedWords('the last 2 bars', { cue_clip: clip }), 'Grabbed the last 2 bars onto the cue lane');
  assert.match(grabbedWords('the last 2 bars', { cue_replaced: { name: 'aux' } }), /in place of “aux”/);
});
