import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewRange, editView, barSpan, nearestBar, xOf, frameAt, barLines, bpm, barBeat, fmtSecs, clipBuckets, snapFrame, slideTo, splitAt, joinPartner, fitsDoubled, zoomView, panView, followView, trimBounds, trimTo, trimmed } from './geometry.js';

test('the lanes show the loop, or everything recorded', () => {
  assert.deepEqual(viewRange({ sample_rate: 48000, loop: { in: 100, out: 900 }, tracks: [] }), { from: 100, to: 900 });
  const t = { sample_rate: 48000, loop: { in: 0, out: 0 }, tracks: [{ clips: [{ at: 0, frames: 48000 * 40 }] }] };
  assert.deepEqual(viewRange(t), { from: 0, to: 48000 * 40 });
  assert.deepEqual(viewRange({ sample_rate: 48000, loop: {}, tracks: [] }), { from: 0, to: 48000 * 30 });
});

test('frames and pixels round-trip', () => {
  const v = { from: 1000, to: 3000 };
  assert.equal(xOf(2000, v, 400), 200);
  assert.equal(frameAt(200, v, 400), 2000);
});

test('bar lines land where the Pi puts them, for tempos that are not whole frames', () => {
  // 84 BPM, 4 bars: a bar is 137142.857 frames; the Pi rounds n × that.
  const grid = { frames: 548571, bars: 4 };
  const lines = barLines(grid, { from: 0, to: 548571 });
  assert.deepEqual(lines.map((l) => l.frame), [0, 137143, 274286, 411428, 548571]);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 4, 5]);
  assert.ok(Math.abs(bpm(grid, 48000) - 84) < 0.01);
  assert.equal(barBeat(0, grid), '1.1');
  assert.equal(barBeat(137143 + 34286, grid), '2.2');
  assert.deepEqual(barLines(null, { from: 0, to: 10 }), []);
});

test('a clip draws the part of its file it plays', () => {
  const pd = { duration: 2, sample_rate: 48000, buckets: 1024 };
  assert.deepEqual(clipBuckets({ src: 480, frames: 48000 }, pd), [5, 518]);
  assert.equal(fmtSecs(48000 * 61.25, 48000), '1:01.3');
});

test('the lanes show the loop and a bar either side, to drag it wider', () => {
  const grid = { frames: 192000, bars: 4 }; // a bar is 48000
  assert.deepEqual(editView({ sample_rate: 48000, grid, loop: { in: 96000, out: 288000 }, tracks: [] }), { from: 48000, to: 336000 });
  assert.deepEqual(editView({ sample_rate: 48000, grid, loop: { in: 0, out: 192000 }, tracks: [] }), { from: 0, to: 240000 });
  assert.deepEqual(editView({ sample_rate: 48000, loop: {}, tracks: [] }), { from: 0, to: 48000 * 30 });
});

test('a drag on the ruler takes whole bars, whichever way it goes', () => {
  const grid = { frames: 548571, bars: 4 }; // 84 BPM
  assert.deepEqual(barSpan(grid, 150000, 20000), { from: 0, to: 274286 });
  assert.deepEqual(barSpan(grid, 137143, 137143), { from: 137143, to: 274286 });
  assert.equal(nearestBar(grid, 200000), 137143);
  assert.equal(nearestBar(grid, 210000), 274286);
});

test('a slid clip snaps to the lines the Pi draws', () => {
  // 84 BPM, 4 bars: a bar is 137142.857 frames.
  const grid = { frames: 548571, bars: 4 };
  assert.equal(snapFrame(grid, 137000, 'bar'), 137143);
  assert.equal(snapFrame(grid, 60000, 'bar'), 0);
  assert.equal(snapFrame(grid, 36000, 'beat'), 34286);
  assert.equal(snapFrame(grid, 17000, '8th'), 17143);
  assert.equal(snapFrame(grid, 12345.4, 'off'), 12345);
  assert.equal(snapFrame(null, 12345, 'bar'), 12345);
  assert.equal(snapFrame(grid, -5000, 'bar'), 0);
  assert.equal(snapFrame(grid, -5000, 'off'), 0);
});

test('split and join find what the Pi would', () => {
  const a = { id: 'a', file: 'f', src: 480, frames: 1000, at: 0, layer: 0, gain_db: 0 };
  const b = { id: 'b', file: 'f', src: 1480, frames: 500, at: 1000, layer: 0, gain_db: 0 };
  const top = { id: 'c', file: 'g', src: 0, frames: 2000, at: 0, layer: 1 };
  const tr = { clips: [a, b, top] };
  assert.equal(splitAt(tr, 500), 2);
  assert.equal(splitAt(tr, 1000), 1); // on a's end: only the layer above runs across
  assert.equal(splitAt(tr, 3000), 0);
  assert.equal(joinPartner(tr, a), b);
  assert.equal(joinPartner(tr, b), a, 'from the second half too');
  assert.equal(joinPartner(tr, top), null);
  assert.equal(joinPartner({ clips: [a, { ...b, src: 1500 }] }, a), null, 'not straight on');
  assert.equal(joinPartner({ clips: [a, { ...b, gain_db: -3 }] }, a), null, 'a different level');
  assert.equal(joinPartner({ clips: [a, { ...b, layer: 1 }] }, a), null, 'another layer');
});

test('a loop doubles only while it fits on the tape', () => {
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 0, out: 500 } }), true);
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 100, out: 600 } }), false);
  assert.equal(fitsDoubled({ length: 1000, loop: { in: 0, out: 0 } }), false);
});

test('a nudged clip splits where it is heard', () => {
  // +100 ms at 48 kHz: it sounds from 4800 to 100800.
  const tr = { clips: [{ at: 0, frames: 96000, layer: 0, nudge_ms: 100 }] };
  assert.equal(splitAt(tr, 2000, 48000), 0);
  assert.equal(splitAt(tr, 98000, 48000), 1);
  assert.equal(splitAt(tr, 100800, 48000), 0);
});

test('a slid clip on the grid lands on a line; off it, keeps its offset', () => {
  const grid = { frames: 548571, bars: 4 }; // a bar is 137142.857 frames
  // On bar 2, dragged most of a bar: bar 3.
  assert.equal(slideTo(grid, 137143, 120000, 'bar'), 274286);
  // A little: stays.
  assert.equal(slideTo(grid, 137143, 30000, 'bar'), 137143);
  // On beat 2 of bar 1, by a bar: beat 2 of bar 2, with the bar snap.
  assert.equal(slideTo(grid, 34286, 140000, 'bar'), 34286 + 137143);
  // 1000 frames late, by a bar: still 1000 frames late.
  assert.equal(slideTo(grid, 138143, 137000, 'bar'), 138143 + 137143);
  // Never before the start: an off-grid clip goes back whole steps only.
  assert.equal(slideTo(grid, 1000, -200000, 'bar'), 1000);
  assert.equal(slideTo(grid, 137143, -400000, 'bar'), 0);
  assert.equal(slideTo(grid, 5000, 12.6, 'off'), 5013);
  assert.equal(slideTo(null, 5000, -9000, 'bar'), 0);
});

test('a pinch zooms about the frame under the fingers, within the tape', () => {
  const v = { from: 1000, to: 3000 };
  // Twice as close about 2000: that frame stays where it was on screen.
  assert.deepEqual(zoomView(v, 2000, 0.5, 100000, 10), { from: 1500, to: 2500 });
  // Anchored off-centre, the anchor keeps its fraction across the view.
  assert.deepEqual(zoomView(v, 1500, 2, 100000, 10), { from: 500, to: 4500 });
  // No closer than minSpan, no wider than the tape, never off either end.
  assert.deepEqual(zoomView(v, 2000, 0.001, 100000, 400), { from: 1800, to: 2200 });
  assert.deepEqual(zoomView(v, 2000, 1000, 100000, 10), { from: 0, to: 100000 });
  assert.deepEqual(zoomView({ from: 0, to: 2000 }, 0, 2, 100000, 10), { from: 0, to: 4000 });
});

test('a drag pans the view, and stops at the tape\'s ends', () => {
  const v = { from: 1000, to: 3000 };
  assert.deepEqual(panView(v, 500, 10000), { from: 1500, to: 3500 });
  assert.deepEqual(panView(v, -5000, 10000), { from: 0, to: 2000 });
  assert.deepEqual(panView(v, 50000, 10000), { from: 8000, to: 10000 });
});

test('the view pages to follow a playhead that leaves it', () => {
  const v = { from: 1000, to: 3000 };
  assert.equal(followView(v, 2000, 100000), v, 'in view: unchanged, the same object');
  assert.equal(followView(v, 3000, 100000), v);
  // Past the right edge: the playhead lands a tenth of the way in.
  assert.deepEqual(followView(v, 3001, 100000), { from: 2801, to: 4801 });
  // Before the left edge (a wrap, a locate): the same.
  assert.deepEqual(followView(v, 100, 100000), { from: 0, to: 2000 });
  // At the tape's end the view stops there.
  assert.deepEqual(followView(v, 99900, 100000), { from: 98000, to: 100000 });
});

// levelAt: what the meter bridge shows for a track at the playhead.
import { levelAt } from './geometry.js';

// A pool file of 10 s at 48 kHz in 100 buckets, one channel, its level in
// each bucket set by `amp(bucket)`.
const pool = (amp) => {
  const d = [];
  for (let b = 0; b < 100; b++) { const a = amp(b); d.push(-a, a); }
  return { duration: 10, sample_rate: 48000, buckets: 100, channels: 1, data: [d] };
};

test('a track reads the clip under the playhead, through its gains', () => {
  const pd = pool((b) => (b < 50 ? 0.5 : 0.1));
  const tr = { gain_db: 0, mute: false, clips: [{ file: 'a', src: 0, frames: 480000, at: 0, gain_db: 0, layer: 0 }] };
  const peaksOf = (f) => (f === 'a' ? pd : null);
  const db = (x) => 20 * Math.log10(x);
  assert.ok(Math.abs(levelAt(tr, 1000, peaksOf, 48000) - db(0.5)) < 0.01);
  assert.ok(Math.abs(levelAt(tr, 300000, peaksOf, 48000) - db(0.1)) < 0.01);
  tr.gain_db = -6;
  tr.clips[0].gain_db = 3;
  assert.ok(Math.abs(levelAt(tr, 1000, peaksOf, 48000) - (db(0.5) - 3)) < 0.01);
});

test('a clip plays its file from src, and is heard where its nudge puts it', () => {
  const pd = pool((b) => (b === 60 ? 0.8 : 0.01));
  const tr = { gain_db: 0, clips: [{ file: 'a', src: 288000, frames: 48000, at: 96000, gain_db: 0, layer: 0, nudge_ms: 10 }] };
  // Tape frame 96000 + 480 (the nudge) is the file's frame 288000: bucket 60.
  assert.ok(Math.abs(levelAt(tr, 96000 + 480, () => pd, 48000) - 20 * Math.log10(0.8)) < 0.01);
  assert.equal(levelAt(tr, 96000 - 1, () => pd, 48000), -Infinity, 'before the clip');
  assert.equal(levelAt(tr, 96000 + 480 + 48000, () => pd, 48000), -Infinity, 'after the clip');
});

test('the loudest of the clips sounding wins', () => {
  const loud = pool(() => 0.9), quiet = pool(() => 0.1);
  const tr = { gain_db: 0, clips: [
    { file: 'q', src: 0, frames: 480000, at: 0, gain_db: 0, layer: 0 },
    { file: 'l', src: 0, frames: 480000, at: 0, gain_db: 0, layer: 1 },
  ] };
  const peaksOf = (f) => (f === 'l' ? loud : quiet);
  assert.ok(Math.abs(levelAt(tr, 1000, peaksOf, 48000) - 20 * Math.log10(0.9)) < 0.01);
});

test('silence, a mute, a solo elsewhere or peaks not loaded read as the stop', () => {
  const pd = pool(() => 0.5);
  const clip = { file: 'a', src: 0, frames: 480000, at: 0, gain_db: 0, layer: 0 };
  assert.equal(levelAt({ gain_db: 0, clips: [] }, 0, () => pd, 48000), -Infinity);
  assert.equal(levelAt({ gain_db: 0, mute: true, clips: [clip] }, 0, () => pd, 48000), -Infinity);
  assert.equal(levelAt({ gain_db: 0, clips: [clip] }, 0, () => pd, 48000, true), -Infinity, 'another track is soloed');
  assert.ok(Number.isFinite(levelAt({ gain_db: 0, solo: true, clips: [clip] }, 0, () => pd, 48000, true)));
  assert.equal(levelAt({ gain_db: 0, clips: [clip] }, 0, () => undefined, 48000), -Infinity);
  assert.equal(levelAt({ gain_db: 0, clips: [clip] }, 0, () => Promise.resolve(), 48000), -Infinity);
  assert.equal(levelAt({ gain_db: 0, clips: [clip] }, 0, () => pool(() => 0), 48000), -Infinity);
});

// --- trimming ----------------------------------------------------------------

test('trimBounds: the In edge goes back to the file’s start, the Out edge on to its overhang', () => {
  // A clip at 192000 playing 96000 frames from 48000 of a 192000-frame file.
  const c = { id: 'c', at: 192000, src: 48000, frames: 96000, layer: 0 };
  const opts = { fileFrames: 192000, length: 48000 * 1200, sampleRate: 48000 };
  assert.deepEqual(trimBounds(c, 'in', { clips: [c] }, opts), { lo: 144000, hi: 288000 - 480 });
  assert.deepEqual(trimBounds(c, 'out', { clips: [c] }, opts), { lo: 192480, hi: 192000 + 191520 - 48000 });
});

test('trimBounds: the clips beside it on its layer stop it; another layer’s don’t', () => {
  const c = { id: 'c', at: 192000, src: 48000, frames: 96000, layer: 0 };
  const before = { id: 'b', at: 100000, frames: 60000, layer: 0 };
  const after = { id: 'a', at: 300000, frames: 1000, layer: 0 };
  const above = { id: 'x', at: 150000, frames: 300000, layer: 1 };
  const tr = { clips: [before, c, after, above] };
  const opts = { fileFrames: 192000, length: 48000 * 1200, sampleRate: 48000 };
  assert.equal(trimBounds(c, 'in', tr, opts).lo, 160000);
  assert.equal(trimBounds(c, 'out', tr, opts).hi, 300000);
});

test('trimBounds: with the file unknown, only the neighbours and the tape', () => {
  const c = { id: 'c', at: 192000, src: 48000, frames: 96000, layer: 0 };
  const opts = { fileFrames: 0, length: 1000000, sampleRate: 48000 };
  assert.deepEqual(trimBounds(c, 'in', { clips: [c] }, opts), { lo: 0, hi: 288000 - 480 });
  assert.deepEqual(trimBounds(c, 'out', { clips: [c] }, opts), { lo: 192480, hi: 1000000 });
});

test('trimBounds: a clip with no room is null', () => {
  const c = { id: 'c', at: 1000, src: 0, frames: 100, layer: 0 };
  assert.equal(trimBounds(c, 'in', { clips: [c] }, { fileFrames: 100, length: 1e6, sampleRate: 48000 }), null);
});

test('trimTo snaps to the grid, or not when free, and holds inside the bounds', () => {
  const grid = { frames: 192000, bars: 4 }; // a bar is 48000
  const b = { lo: 100000, hi: 300000 };
  assert.deepEqual(trimTo(192000, 30000, b, grid, 'bar', false), { at: 240000, limited: false });
  assert.deepEqual(trimTo(192000, 30000, b, grid, 'bar', true), { at: 222000, limited: false });
  assert.deepEqual(trimTo(192000, 20000, b, grid, 'beat', false), { at: 216000, limited: false });
  assert.deepEqual(trimTo(192000, 500000, b, grid, 'bar', false), { at: 300000, limited: true });
  assert.deepEqual(trimTo(192000, -500000, b, grid, 'off', false), { at: 100000, limited: true });
  assert.deepEqual(trimTo(192000, 1, b, null, 'bar', false), { at: 192001, limited: false });
});

test('trimmed moves the In edge with the audio, the Out edge alone', () => {
  const c = { id: 'c', at: 192000, src: 48000, frames: 96000 };
  assert.deepEqual(trimmed(c, 'in', 200000), { id: 'c', at: 200000, src: 56000, frames: 88000 });
  assert.deepEqual(trimmed(c, 'in', 150000), { id: 'c', at: 150000, src: 6000, frames: 138000 });
  assert.deepEqual(trimmed(c, 'out', 250000), { id: 'c', at: 192000, src: 48000, frames: 58000 });
});
