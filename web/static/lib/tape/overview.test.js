import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overviewWindow, onWindow, dragTo, tapAt, isDoubleTap, OVERVIEW_MIN_WINDOW_PX } from './overview.js';

const LEN = 48000 * 360; // six minutes
const W = 720;           // the strip, px: 30 s a 60 px

test('the window is where the lanes look, at least a fingertip wide', () => {
  assert.deepEqual(overviewWindow({ from: 48000 * 60, to: 48000 * 120 }, LEN, W), { x: 120, w: 120 });
  const tiny = overviewWindow({ from: 48000 * 359, to: 48000 * 360 }, LEN, W);
  assert.equal(tiny.w, OVERVIEW_MIN_WINDOW_PX);
  assert.equal(tiny.x, W - OVERVIEW_MIN_WINDOW_PX, 'a widened window stays on the strip');
});

test('a press on the window, or near enough to it, grabs it', () => {
  const win = { x: 120, w: 120 };
  assert.equal(onWindow(119, win), true);
  assert.equal(onWindow(240, win), true);
  assert.equal(onWindow(100, win), false);
  assert.equal(onWindow(300, win), false);
});

test('dragging the window moves the view and keeps its span', () => {
  const view = { from: 48000 * 60, to: 48000 * 120 };
  // Grabbed 20 px into the window, dropped with that point at x = 320.
  const v = dragTo(320, 20, view, LEN, W);
  assert.deepEqual(v, { from: 48000 * 150, to: 48000 * 210 });
  assert.deepEqual(dragTo(-50, 20, view, LEN, W), { from: 0, to: 48000 * 60 }, 'stops at the start');
  assert.deepEqual(dragTo(W + 50, 20, view, LEN, W), { from: LEN - 48000 * 60, to: LEN }, 'and at the end');
});

test('a tap is a playhead position, on the nearest bar when the tape has bars', () => {
  assert.equal(tapAt(360, LEN, W, null), 48000 * 180);
  const grid = { frames: 48000 * 8, bars: 4 }; // 2 s bars
  assert.equal(tapAt(361, LEN, W, grid), 48000 * 180, 'snaps');
  assert.equal(tapAt(-10, LEN, W, null), 0);
  assert.equal(tapAt(W + 10, LEN, W, null), LEN);
});

test('two taps close in time and place are a double tap', () => {
  assert.equal(isDoubleTap({ t: 1000, x: 100 }, { t: 1250, x: 108 }), true);
  assert.equal(isDoubleTap({ t: 1000, x: 100 }, { t: 1400, x: 100 }), false);
  assert.equal(isDoubleTap({ t: 1000, x: 100 }, { t: 1100, x: 160 }), false);
  assert.equal(isDoubleTap(null, { t: 1100, x: 100 }), false);
});
