import { test } from 'node:test';
import assert from 'node:assert/strict';

import { origin, gridFrom, ringAt, JITTER_MS } from './clock.js';
import { Surface } from './surface.js';

// 96 BPM at 48 kHz: a beat is 30000 frames (625 ms), a bar 120000 (2.5 s).
const RATE = 48000;
const BAR = 120000;
const playing = (heard, at, extra = {}) => ({
  bpm: 96, playing: true, heard, rate: RATE, at, bar_frames: BAR, bars: 4,
  loop: { in: 0, out: 4 * BAR, on: true }, ...extra,
});

test('the tape’s frame 0 is placed back in the page’s time', () => {
  assert.equal(origin({ heard: 48000, rate: RATE, at: 5000 }), 4000);
});

test('a pad lands on the tape’s sixteenths, not on a grid of its own', () => {
  // Heard 1.3 s in at page time 10 s: frame 0 passed at 8.7 s.
  const g = gridFrom(playing(1.3 * RATE, 10000), null);
  assert.deepEqual(g, { bpm: 96, originMs: 8700 });
  const s = new Surface({ bpm: 120, originMs: 0, division: '16th' });
  s.setGrid(g);
  const fires = [];
  s.on('arm', (d) => fires.push(d.fireAt));
  s.press('break', 10000);
  // A sixteenth at 96 BPM is 156.25 ms; 1.3 s is 8.32 of them, so the next
  // line is the ninth: 1.40625 s into the tape.
  const tapeSecs = (fires[0] - 8700) / 1000;
  assert.ok(Math.abs(tapeSecs - 1.40625) < 1e-9, `fires at ${tapeSecs}s of tape`);
});

test('a poll that only jitters keeps the grid, so an armed pad stays put', () => {
  const g = gridFrom(playing(1.3 * RATE, 10000), null);
  assert.equal(gridFrom(playing(1.5 * RATE, 10200 + JITTER_MS - 5), g), null);
  assert.equal(gridFrom(playing(1.5 * RATE, 10200 - (JITTER_MS - 5)), g), null);
});

test('a loop that wrapped is the same grid, a whole number of bars on', () => {
  const g = gridFrom(playing(1.3 * RATE, 10000), null);
  // Ten seconds later the 4-bar loop has gone round once: heard is back near
  // the start, and the line it implies is exactly four bars (10 s) later.
  assert.equal(gridFrom(playing(1.3 * RATE, 20000 + 3), g), null);
});

test('a real move takes a new grid', () => {
  const g = gridFrom(playing(1.3 * RATE, 10000), null);
  const moved = gridFrom(playing(1.3 * RATE, 10000 + JITTER_MS + 15), g);
  assert.equal(moved.originMs, 8700 + JITTER_MS + 15, 'a locate, or a tape that drifted');
  assert.ok(gridFrom({ ...playing(1.3 * RATE, 10000), bpm: 120 }, g), 'a new tempo is a new grid');
});

test('a stopped tape gives no grid, and the last one stays', () => {
  const g = gridFrom(playing(1.3 * RATE, 10000), null);
  assert.equal(gridFrom({ ...playing(1.3 * RATE, 99000), playing: false }, g), null);
  assert.equal(gridFrom(null, g), null);
  assert.equal(gridFrom({ ...playing(1.3 * RATE, 10000), bpm: 0 }, g), null, 'no tempo, no grid');
});

test('the ring sweeps between polls and wraps at the loop’s end', () => {
  const s = playing(0, 1000);
  assert.deepEqual(ringAt(s, 1000), { frac: 0, bar: 1, bars: 4 });
  assert.deepEqual(ringAt(s, 1000 + 2500 * 1.5), { frac: 1.5 / 4, bar: 2, bars: 4 });
  // 11.25 s at 2.5 s a bar is 4.5 bars: round once and half a bar in.
  const r = ringAt(s, 1000 + 11250);
  assert.ok(Math.abs(r.frac - 0.5 / 4) < 1e-9);
  assert.equal(r.bar, 1);
});

test('the ring is the loop when there is one, and the grid when there isn’t', () => {
  const inner = playing(2 * BAR, 0, { loop: { in: 2 * BAR, out: 4 * BAR, on: true } });
  assert.deepEqual(ringAt(inner, 0), { frac: 0, bar: 3, bars: 2 });
  const open = playing(BAR, 0, { loop: { in: 0, out: 0, on: false } });
  assert.deepEqual(ringAt(open, 0), { frac: 0.25, bar: 2, bars: 4 });
});

test('a stopped tape holds the ring still', () => {
  const s = { ...playing(BAR, 1000), playing: false };
  assert.deepEqual(ringAt(s, 1000), ringAt(s, 60000));
});

test('no tape, no ring', () => {
  assert.deepEqual(ringAt(null, 0), { frac: 0, bar: null, bars: null });
  assert.deepEqual(ringAt({ heard: 0, rate: 0 }, 0), { frac: 0, bar: null, bars: null });
});

test('the hub’s beat: which beat of the bar the playhead is in', async () => {
  const { beatAt } = await import('./clock.js');
  const s = { heard: 0, rate: 48000, at: 1000, playing: true, bar_frames: 96000, bars: 4, loop: { in: 0, out: 384000, on: true } };
  assert.equal(beatAt(s, 1000), 1);
  assert.equal(beatAt(s, 1000 + 500), 2);  // a beat at 120 BPM
  assert.equal(beatAt(s, 1000 + 1999), 4);
  assert.equal(beatAt(s, 1000 + 2000), 1);  // the next bar
  assert.equal(beatAt(s, 1000 + 8000 + 500), 2, 'round the loop');
  assert.equal(beatAt({ ...s, bar_frames: 0 }, 1000), null);
});
