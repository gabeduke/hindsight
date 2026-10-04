import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptSpan, onsets, roundTrip, guessRoundTrip, barStart } from './away.js';

const sr = 48000;
const grid = { frames: 96000, bars: 1 }; // 2 s bars, 120 BPM
const loop4 = { from: 0, frames: 4 * 96000, loop: true }; // four bars, 8 s

test('a recording over the loop keeps its last full pass', () => {
  // The tape started at t=1; the round trip is 100 ms; the recording began
  // at t=2 and ran 20 s. Passes begin (heard back) at 1.1, 9.1, 17.1 s:
  // 9.1 and 17.1 are in it, and only 9.1's pass ends inside it.
  const k = keptSpan({ t0: 1, rt: 0.1, recStart: 2, seconds: 20, listen: loop4, grid, sr });
  assert.deepEqual(k, { from: Math.round((9.1 - 2) * sr), to: Math.round((9.1 - 2) * sr) + 4 * 96000, at: 0, wrap: true });
});

test('with no full pass, the bars played, wrapped at the loop', () => {
  // Recording from t=6 to t=11.5: tape heard 4.9..10.4 s into the loop's
  // run, so the bars from 6 s (bar 4) round to 10 s (2 s into the next
  // pass): four seconds, starting at bar 4.
  const k = keptSpan({ t0: 1, rt: 0.1, recStart: 6, seconds: 5.5, listen: loop4, grid, sr });
  const from = Math.round((6 + 1.1 - 6) * sr); // unwrapped 6 s is t = 7.1
  assert.deepEqual(k, { from, to: from + 4 * sr, at: 3 * 96000, wrap: true }); // bar 4, 6 s in
});

test('never more than a loop of bars, nor less than one', () => {
  // Just under two passes, starting mid-pass: the last loop's worth of bars.
  const k = keptSpan({ t0: 0, rt: 0, recStart: 3, seconds: 14.5, listen: loop4, grid, sr });
  assert.equal(k.to - k.from, 4 * 96000);
  assert.equal(k.wrap, true);
  // Under a bar: nothing.
  assert.equal(keptSpan({ t0: 0, rt: 0, recStart: 0.5, seconds: 1.2, listen: loop4, grid, sr }), null);
  // All before the tape began.
  assert.equal(keptSpan({ t0: 10, rt: 0, recStart: 0, seconds: 5, listen: loop4, grid, sr }), null);
});

test('a loop that starts mid-tape goes back to its own bars', () => {
  const listen = { from: 2 * 96000, frames: 2 * 96000, loop: true }; // bars 3-4
  const k = keptSpan({ t0: 0, rt: 0, recStart: 1, seconds: 9, listen, grid, sr });
  // Passes start at 0, 4, 8 s; the last full one in [1, 10] is 4..8.
  assert.deepEqual(k, { from: 3 * sr, to: 3 * sr + 2 * 96000, at: 2 * 96000, wrap: true });
});

test('over the whole tape, the bars played, straight', () => {
  const listen = { from: 0, frames: 10 * 96000, loop: false };
  const k = keptSpan({ t0: 0, rt: 0.2, recStart: 3, seconds: 6, listen, grid, sr });
  // Heard 2.8..8.8 s of the tape: bars 2 (4 s) to 4 (8 s).
  const from = Math.round((4 + 0.2 - 3) * sr);
  assert.deepEqual(k, { from, to: from + 4 * sr, at: 4 * sr, wrap: false });
  // No grid: all of it that was over the tape.
  const free = keptSpan({ t0: 0, rt: 0, recStart: 1, seconds: 2, listen, grid: null, sr });
  assert.deepEqual(free, { from: 0, to: 2 * sr, at: sr, wrap: false });
});

test('barStart rounds as the Pi does', () => {
  assert.equal(barStart({ frames: 100000, bars: 3 }, 1), 33333);
  assert.equal(barStart({ frames: 100000, bars: 3 }, 2), 66667);
});

test('a calibration finds its clicks and agrees on the delay', () => {
  const rate = 48000;
  const x = new Float32Array(rate * 3);
  const scheduled = [0.2, 0.7, 1.2, 1.7, 2.2];
  for (const s of scheduled) {
    const at = Math.round((s + 0.123) * rate);
    for (let i = 0; i < 200; i++) x[at + i] = 0.5 * Math.sin(i / 3);
  }
  x[1000] = 0.05; // a little noise before
  const heard = onsets(x, rate);
  assert.equal(heard.length, 5);
  const rt = roundTrip(scheduled, heard);
  assert.ok(Math.abs(rt - 0.123) < 0.001, `rt ${rt}`);
  // Too few heard, or disagreeing: no answer.
  assert.equal(roundTrip(scheduled, [0.323]), null);
  assert.equal(roundTrip(scheduled, [0.25, 0.9, 1.25, 1.95, 2.21]), null);
  // A beep every second, against clicks every half second: half the clicks
  // agree, which isn't enough.
  assert.equal(roundTrip(scheduled, [0.259, 1.259, 2.259]), null);
  // One click lost in four or five is fine.
  assert.ok(Math.abs(roundTrip(scheduled, [0.323, 0.823, 1.323, 1.823]) - 0.123) < 1e-9);
  assert.deepEqual(onsets(new Float32Array(100), rate), []);
});

test('the browser’s guess', () => {
  assert.ok(Math.abs(guessRoundTrip({ outputLatency: 0.04, baseLatency: 0.01 }, { latency: 0.02 }) - 0.06) < 1e-9);
  assert.ok(Math.abs(guessRoundTrip({ baseLatency: 0.01 }) - 0.02) < 1e-9);
});
