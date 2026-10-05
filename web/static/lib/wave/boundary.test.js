import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewAbout, zoomBy, positionBy, stepFrames, stepLabel, placeEdge, fmtSample, beatOffset, fmtOffset, crossedLine, seamHalves, snapRadius, playFrom, wholeFrames, ZOOM_PER_PAD } from './boundary.js';

const sr = 48000;

test('the view keeps the point in the middle, as far as the take allows', () => {
  assert.deepEqual(viewAbout(100000, 10, 400, 1000000, 0.125), { start: 98000, fpp: 10, width: 400 });
  assert.deepEqual(viewAbout(500, 10, 400, 1000000, 0.125), { start: 0, fpp: 10, width: 400 }, 'near the start');
  assert.deepEqual(viewAbout(999900, 10, 400, 1000000, 0.125), { start: 996000, fpp: 10, width: 400 }, 'near the end');
  assert.equal(viewAbout(100000, 0.001, 400, 1000000, 0.125).fpp, 0.125, 'no closer than 8 px a sample');
  assert.equal(viewAbout(100000, 1e9, 400, 1000000, 0.125).fpp, 2500, 'no wider than the take');
});

test('a full pad of ZOOM zooms 64 times; right is closer', () => {
  assert.equal(zoomBy(640, 300, 300), 640 / ZOOM_PER_PAD);
  assert.equal(zoomBy(10, -300, 300), 10 * ZOOM_PER_PAD);
  assert.equal(zoomBy(10, 0, 300), 10);
});

test('a full pad of POSITION moves half of what is on screen, so it scales with the zoom', () => {
  assert.equal(positionBy(300, 300, { width: 400, fpp: 100 }), 20000);   // far out: 0.42 s
  assert.equal(positionBy(-150, 300, { width: 400, fpp: 0.125 }), -12.5); // fully in: samples
});

test('a step is a sample when zoomed past a pixel a sample, else a millisecond', () => {
  assert.equal(stepFrames(0.5, sr), 1);
  assert.equal(stepFrames(1, sr), 48);
  assert.equal(stepFrames(1, 44100), 44);
  assert.equal(stepLabel(1, sr), '1 smp');
  assert.equal(stepLabel(48, sr), '1 ms');
});

test('a boundary stays in the take, and In stays before Out', () => {
  const ctx = { region: { start: 1000, end: 5000 }, total: 10000, minLen: 100 };
  assert.equal(placeEdge('start', 4990, ctx), 4900);
  assert.equal(placeEdge('end', 1010, ctx), 1100);
  assert.equal(placeEdge('start', -50, ctx), 0);
  assert.equal(placeEdge('downbeat', 12000, ctx), 9999);
  assert.equal(placeEdge('downbeat', 123.6, ctx), 124);
});

test('Out may sit at the take\'s very end; In and bar 1 may not', () => {
  const ctx = { region: { start: 1000, end: 5000 }, total: 10000, minLen: 100 };
  assert.equal(placeEdge('end', 10000 + 48, ctx), 10000);
  assert.equal(placeEdge('end', 10000, ctx), 10000);
  assert.equal(placeEdge('start', 10000 + 48, { ...ctx, region: { start: 1000, end: 10000 } }), 9900);
  assert.equal(placeEdge('downbeat', 10000, ctx), 9999);
});

test('the point reads to the sample', () => {
  assert.equal(fmtSample(120031, sr), '0:02.500 +31');
  assert.equal(fmtSample(0, sr), '0:00.000 +0');
  assert.equal(fmtSample(48000 * 61 + 47, sr), '1:01.000 +47');
  assert.equal(fmtSample(110251, 44100), '0:02.500 +1'); // 2.5 s is 110250 at 44.1 kHz
});

test('how far the point sits from its nearest beat', () => {
  const grid = { bpm: 96, sampleRate: sr, downbeat: 1000 }; // a beat is 30000
  assert.deepEqual(beatOffset(1000 + 2 * 30000 + 149, grid), { ms: 149 / 48, at: '1.3' });
  assert.equal(fmtOffset(beatOffset(1000 + 2 * 30000 + 149, grid)), '+3.1 ms from 1.3');
  assert.equal(fmtOffset(beatOffset(1000 + 4 * 30000 - 96, grid)), '−2.0 ms from 2.1');
  assert.equal(fmtOffset(beatOffset(1000 + 30000, grid)), 'on 1.2');
  assert.equal(beatOffset(5000, { bpm: null, sampleRate: sr, downbeat: 0 }), null);
});

test('the editor ticks when the point crosses a line', () => {
  assert.equal(crossedLine(29990, 30010, 0, 30000), true);
  assert.equal(crossedLine(30010, 29990, 0, 30000), true);
  assert.equal(crossedLine(30010, 30020, 0, 30000), false);
  assert.equal(crossedLine(1, 2, 0, 0), false);
});

test('the seam view: the end of the loop on the left, its start on the right, meeting in the middle', () => {
  const { left, right } = seamHalves({ start: 48000, end: 528000 }, 2, 400);
  assert.deepEqual(left, { start: 528000 - 400, fpp: 2, width: 200 });
  assert.deepEqual(right, { start: 48000, fpp: 2, width: 200 });
});

test('a beat that is not a whole number of frames is still named for the beat the frame is on', () => {
  const grid = { bpm: 97, sampleRate: sr, downbeat: 0 };
  const beat = (60 / 97) * 48000;
  for (let k = 0; k < 16; k++) {
    assert.equal(beatOffset(Math.round(k * beat), grid).at, `${Math.floor(k / 4) + 1}.${(k % 4) + 1}`, `beat ${k}`);
  }
});

test('Attack looks 60 ms either side, or half the screen if less; Zero 5 ms', () => {
  assert.equal(snapRadius('attack', sr, { width: 400, fpp: 100 }), 2880, 'a wide view: 60 ms');
  assert.equal(snapRadius('attack', sr, { width: 400, fpp: 1 }), 200, 'a close view: half of what is on screen');
  assert.equal(snapRadius('zero', sr, { width: 400, fpp: 1 }), 240, '5 ms, whatever the view');
});

test('play from here: In and bar 1 at the point, Out a second ahead of it, never before 0', () => {
  assert.equal(playFrom('start', 100000, sr), 100000);
  assert.equal(playFrom('downbeat', 100000, sr), 100000);
  assert.equal(playFrom('end', 100000, sr), 52000);
  assert.equal(playFrom('end', 1000, sr), 0);
});

test('fractional frames add up, backwards as well as forwards, and never give -0', () => {
  assert.deepEqual(wholeFrames(2.75), { whole: 2, rest: 0.75 });
  assert.deepEqual(wholeFrames(-2.75), { whole: -2, rest: -0.75 });
  const small = wholeFrames(-0.5);
  assert.ok(Object.is(small.whole, 0), 'not -0');
  assert.equal(small.rest, -0.5);
  let acc = 0, moved = 0;
  for (let i = 0; i < 4; i++) { const w = wholeFrames(acc - 0.3); moved += w.whole; acc = w.rest; }
  assert.equal(moved, -1, 'four small backward notches add up to a frame');
});
