import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soundingAt, toFile, toTape, fileView, gridMove, beatGrid, clipUnder, placeAt,
  alignLand, alignView, clipNumber, alignReadout,
} from './align.js';

const sr = 48000;
const clip = { at: 100000, src: 480, frames: 96000, layer: 0, nudge_ms: 2.5 }; // heard 120 frames late

test('a clip sounds at its at plus its nudge, and tape and file frames map both ways', () => {
  assert.equal(soundingAt(clip, sr), 100120);
  assert.equal(soundingAt({ ...clip, nudge_ms: undefined }, sr), 100000);
  assert.equal(toFile(clip, 100120, sr), 480);
  assert.equal(toFile(clip, 101120, sr), 1480);
  assert.equal(toTape(clip, 1480, sr), 101120);
});

test('the view of the clip\'s file under a tape view', () => {
  assert.deepEqual(fileView(clip, { from: 100120, to: 100520 }, 400, sr), { start: 480, fpp: 1, width: 400 });
  assert.deepEqual(fileView(clip, { from: 90000, to: 130000 }, 400, sr), { start: 480 - 10120, fpp: 100, width: 400 });
});

test('Hit → Grid moves the hit onto the nearest line of the snap, or the beat with it off', () => {
  const grid = { frames: 480000, bars: 4 }; // 120000 a bar, 30000 a beat (96 BPM)
  assert.equal(gridMove(120119, grid, 'bar'), -119);
  assert.equal(gridMove(149880, grid, 'beat'), 120);
  assert.equal(gridMove(149880, grid, 'off'), 120);
  assert.equal(gridMove(16000, grid, '8th'), -1000);
  assert.equal(gridMove(5000, null, 'bar'), 0);
});

test('the tape grid as a beat grid', () => {
  assert.deepEqual(beatGrid({ frames: 480000, bars: 4 }, sr), { bpm: 96, sampleRate: sr, downbeat: 0 });
  assert.equal(beatGrid(null, sr).bpm, null);
});

test('the clip heard at a tape frame: the top layer where clips overlap', () => {
  const tr = { clips: [
    { at: 0, src: 0, frames: 48000, layer: 0 },
    { at: 24000, src: 0, frames: 48000, layer: 1 },
  ] };
  assert.equal(clipUnder(tr, 1000, sr).layer, 0);
  assert.equal(clipUnder(tr, 30000, sr).layer, 1);
  assert.equal(clipUnder(tr, 80000, sr), null);
  assert.equal(clipUnder({ clips: [] }, 0, sr), null);
});

test('a moved clip stays on the tape', () => {
  assert.equal(placeAt(clip, -119, 10000000), 99881);
  assert.equal(placeAt(clip, -200000, 10000000), 0);
  assert.equal(placeAt(clip, 9999999, 10000000), 9999999);
  assert.equal(placeAt(clip, 0.6, 10000000), 100001);
});

test('a move of the hit lands the whole clip, the nudge kept and counted', () => {
  // The hit is 500 frames into the clip, which sounds 120 frames after its at.
  assert.deepEqual(alignLand(clip, 100000, 500, 100720, 10000000, sr), { at: 100100, point: 100720 });
  // Mid-gesture the clip is at its previewed at, not its stored one.
  assert.deepEqual(alignLand(clip, 100100, 500, 100721, 10000000, sr), { at: 100101, point: 100721 });
  // Not before the tape's start: the hit stops where the clip does.
  assert.deepEqual(alignLand(clip, 100000, 500, 0, 10000000, sr), { at: 0, point: 620 });
});

test('the view about the hit: centred, whole frames, within the tape and the zoom', () => {
  assert.deepEqual(alignView(100000, 10, 400, 10000000), { from: 98000, to: 102000 });
  // No closer than 8 px a sample.
  assert.deepEqual(alignView(100000, 0.01, 400, 10000000), { from: 99975, to: 100025 });
  // No wider than the tape, and not off its ends.
  assert.deepEqual(alignView(100, 1e6, 400, 48000), { from: 0, to: 48000 });
  assert.deepEqual(alignView(10, 10, 400, 48000), { from: 0, to: 4000 });
  assert.deepEqual(alignView(47990, 10, 400, 48000), { from: 44000, to: 48000 });
});

test('a clip is numbered by where it starts on its track', () => {
  const tr = { clips: [{ id: 'b', at: 500 }, { id: 'a', at: 0 }, { id: 'c', at: 500 }] };
  assert.equal(clipNumber(tr, { id: 'a' }), 1);
  assert.equal(clipNumber(tr, { id: 'b' }), 2);
  assert.equal(clipNumber(tr, { id: 'c' }), 3);
});

test('the readout: the point, its beat, and the reference track\'s hit', () => {
  const grid = { frames: 480000, bars: 4 }; // 30000 a beat
  assert.equal(alignReadout({ track: 2, n: 1, point: 30120, sampleRate: sr, grid, ref: null }),
    'Clip 2.1 0:00.627 +24 · +2.5 ms from 1.2');
  assert.equal(alignReadout({ track: 2, n: 1, point: 30000, sampleRate: sr, grid: null, ref: null }), 'Clip 2.1 0:00.625 +0');
  assert.equal(alignReadout({ track: 2, n: 3, point: 30000, sampleRate: sr, grid, ref: { track: 1, hit: 30000 } }),
    'Clip 2.3 0:00.625 +0 · on 1.2 · 0.0 ms from track 1');
  assert.equal(alignReadout({ track: 2, n: 1, point: 30000, sampleRate: sr, grid: null, ref: { track: 4, hit: 30062 } }),
    'Clip 2.1 0:00.625 +0 · −1.3 ms from track 4');
});
