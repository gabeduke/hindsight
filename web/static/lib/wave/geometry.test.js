// web/static/lib/wave/geometry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameToX, xToFrame, levelFor, tileSpan, tilesFor, fileLevel,
  gridLines, barBeat, fmtTime, clampRegion, TILE_BUCKETS,
  edgeScrollStep, EDGE_MARGIN_PX, EDGE_MAX_STEP_PX, fmtRegionLength,
} from './geometry.js';

const view = { start: 48000, fpp: 100, width: 390 };

test('frame and pixel round-trip', () => {
  assert.equal(frameToX(48000, view), 0);
  assert.equal(frameToX(48000 + 39000, view), 390);
  assert.equal(xToFrame(195, view), 48000 + 19500);
  assert.equal(xToFrame(frameToX(50123, view), view), 50123);
});

test('level picks at most two buckets per device pixel', () => {
  assert.equal(levelFor(1, 1), 0);      // 1 frame/px: 2^0 >= 0.5
  assert.equal(levelFor(4, 1), 1);      // need 2^k >= 2
  assert.equal(levelFor(4, 3), 3);      // need 2^k >= 6 -> 8
  assert.equal(levelFor(1000, 2), 10);  // need >= 1000 -> 1024
});

test('tile span and indices with one tile margin, clamped', () => {
  assert.equal(tileSpan(0), TILE_BUCKETS);
  assert.equal(tileSpan(3), TILE_BUCKETS * 8);
  // level 2: 4096 frames per tile. View [48000, 87000).
  const t = tilesFor(view, 2, 1_000_000);
  assert.deepEqual(t, { first: Math.floor(48000 / 4096) - 1, last: Math.floor(86999 / 4096) + 1 });
  const edge = tilesFor({ start: 0, fpp: 10, width: 100 }, 0, 2000);
  assert.deepEqual(edge, { first: 0, last: 1 }); // 2000 frames = tiles 0..1, no tile -1 or 2
});

test('file level is where the saved peaks are exact', () => {
  assert.equal(fileLevel(1024), 0);
  assert.equal(fileLevel(1024 * 8), 3);
  assert.equal(fileLevel(1024 * 8 + 1), 4);
  assert.equal(fileLevel(48000 * 900), 16); // 15 min: 43.2M/1024 = 42187 -> 2^16
});

test('grid lines: bars and beats from the downbeat, hidden when dense', () => {
  const g = { bpm: 120, sampleRate: 48000, downbeat: 0 }; // 24000 frames per beat
  // 100 fpp: beat = 240px apart, all shown.
  const lines = gridLines({ start: 0, fpp: 100, width: 390 }, g);
  assert.deepEqual(lines.map((l) => [l.frame, l.bar]), [[0, true], [24000, false]]);
  // 4000 fpp: beats 6px apart -> hidden; bars 24px -> shown.
  const coarse = gridLines({ start: 0, fpp: 4000, width: 100 }, g);
  assert.ok(coarse.every((l) => l.bar));
  assert.equal(coarse.length, 5); // bars at 0, 96000, 192000, 288000, 384000 within 400000
  // 30000 fpp: bars 3.2px -> nothing.
  assert.deepEqual(gridLines({ start: 0, fpp: 30000, width: 100 }, g), []);
  // No bpm, no grid.
  assert.deepEqual(gridLines(view, { bpm: null, sampleRate: 48000, downbeat: 0 }), []);
  // Downbeat offset shifts everything; lines before the downbeat still draw.
  const shifted = gridLines({ start: 0, fpp: 100, width: 390 }, { ...g, downbeat: 10000 });
  assert.deepEqual(shifted.map((l) => l.frame), [10000, 34000]);
});

test('bar.beat readout', () => {
  const g = { bpm: 120, sampleRate: 48000, downbeat: 0 };
  assert.equal(barBeat(0, g), '1.1');
  assert.equal(barBeat(24000 * 5, g), '2.2');
  assert.equal(barBeat(24000 * 5 + 100, g), '2.2');
  assert.equal(barBeat(-1, g), '-1.4');
  assert.equal(barBeat(0, { ...g, bpm: null }), '');
});

test('time readout', () => {
  assert.equal(fmtTime(0, 48000), '0:00.000');
  assert.equal(fmtTime(48000 * 61.5, 48000), '1:01.500');
  assert.equal(fmtTime(47, 48000), '0:00.000'); // floors to ms
});

test('region length in seconds and bars', () => {
  const g = { bpm: 120, sampleRate: 48000, downbeat: 0 };
  assert.equal(fmtRegionLength({ start: 0, end: 48000 * 8 }, g), '8.0 s · 4.0 bars');
  assert.equal(fmtRegionLength({ start: 0, end: 48000 * 29.5 }, { ...g, bpm: null }), '29.5 s');
  assert.equal(fmtRegionLength(null, g), '');
});

test('region clamp keeps order, bounds and minimum length', () => {
  assert.deepEqual(clampRegion({ start: -5, end: 100 }, 1000, 10), { start: 0, end: 100 });
  assert.deepEqual(clampRegion({ start: 900, end: 2000 }, 1000, 10), { start: 900, end: 1000 });
  assert.deepEqual(clampRegion({ start: 500, end: 503 }, 1000, 10), { start: 500, end: 510 });
  assert.deepEqual(clampRegion({ start: 995, end: 998 }, 1000, 10), { start: 990, end: 1000 });
});

// A selection dragged against a screen edge has to be able to grow past what
// is visible: the view pans under it, a little per frame, faster the harder
// the finger is pressed into the edge.
test('edge scroll step ramps inside the margins and is zero elsewhere', () => {
  assert.equal(edgeScrollStep(195, 390), 0);            // mid-canvas: still
  assert.equal(edgeScrollStep(EDGE_MARGIN_PX, 390), 0); // the margin's inner edge is the zero point
  assert.equal(edgeScrollStep(0, 390), -EDGE_MAX_STEP_PX);
  assert.equal(edgeScrollStep(EDGE_MARGIN_PX / 2, 390), -EDGE_MAX_STEP_PX / 2);
  assert.equal(edgeScrollStep(390, 390), EDGE_MAX_STEP_PX);
  assert.equal(edgeScrollStep(390 - EDGE_MARGIN_PX / 2, 390), EDGE_MAX_STEP_PX / 2);
  assert.equal(edgeScrollStep(-50, 390), -EDGE_MAX_STEP_PX); // clamped past the edge
});

import { snapFrame, snapStep, nudgeStep, nudgeFrame, setPoint, prevFlag, nextFlag, fmtPoint, rulerTicks } from './geometry.js';

const grid120 = { bpm: 120, sampleRate: 48000, downbeat: 1000 }; // a beat is 24000 frames

test('snap moves a frame to the nearest bar, beat or eighth from the downbeat', () => {
  assert.equal(snapFrame(1000 + 24000 * 1.4, grid120, 'beat'), 1000 + 24000);
  assert.equal(snapFrame(1000 + 24000 * 1.6, grid120, 'beat'), 1000 + 48000);
  assert.equal(snapFrame(1000 + 24000 * 1.3, grid120, 'eighth'), 1000 + 36000);
  assert.equal(snapFrame(1000 + 24000 * 1.9, grid120, 'bar'), 1000);
  assert.equal(snapFrame(1000 + 24000 * 2.9, grid120, 'bar'), 97000);
  assert.equal(snapFrame(12345.6, grid120, 'off'), 12346);
  assert.equal(snapFrame(12345, { bpm: null, sampleRate: 48000, downbeat: 0 }, 'beat'), 12345, 'no BPM, no snap');
  assert.equal(snapStep(grid120, 'bar'), 96000);
});

test('a nudge is one snap step, or 10 ms with snap off', () => {
  assert.equal(nudgeStep(grid120, 'beat'), 24000);
  assert.equal(nudgeStep(grid120, 'off'), 480);
  assert.equal(nudgeStep({ bpm: null, sampleRate: 44100, downbeat: 0 }, 'beat'), 441);
});

test('a snapped nudge goes to the next grid line, from on or off the grid', () => {
  // 120 BPM at 48 kHz, downbeat 1000: beats at 1000, 25000, 49000 ...
  const g = { bpm: 120, sampleRate: 48000, downbeat: 1000 };
  assert.equal(nudgeFrame(25000, 1, g, 'beat'), 49000);   // on a line: one step
  assert.equal(nudgeFrame(25000, -1, g, 'beat'), 1000);
  assert.equal(nudgeFrame(30000, 1, g, 'beat'), 49000);   // off it: onto the next line
  assert.equal(nudgeFrame(30000, -1, g, 'beat'), 25000);
  assert.equal(nudgeFrame(25000.3, 1, g, 'beat'), 49000); // a rounding error is on the line
  assert.equal(nudgeFrame(30000, 1, g, 'off'), 30480);    // snap off: 10 ms
  assert.equal(nudgeFrame(30000, -1, { ...g, bpm: null }, 'beat'), 29520);
});

test('In then Out makes a selection, through a pending point', () => {
  let s = { selection: null, pending: null };
  s = setPoint('start', 1000, s, 100000, 289);
  assert.deepEqual(s, { selection: null, pending: { edge: 'start', frame: 1000 } });
  s = setPoint('end', 5000, s, 100000, 289);
  assert.deepEqual(s, { selection: { start: 1000, end: 5000 }, pending: null });
});

test('Out then In works too, and so does moving one end of a selection', () => {
  let s = setPoint('end', 5000, { selection: null, pending: null }, 100000, 289);
  s = setPoint('start', 1000, s, 100000, 289);
  assert.deepEqual(s.selection, { start: 1000, end: 5000 });
  s = setPoint('start', 2000, s, 100000, 289);
  assert.deepEqual(s.selection, { start: 2000, end: 5000 });
  s = setPoint('end', 9000, s, 100000, 289);
  assert.deepEqual(s.selection, { start: 2000, end: 9000 });
});

test('an In past the Out starts over from a pending In', () => {
  const s = setPoint('start', 9500, { selection: { start: 2000, end: 9000 }, pending: null }, 100000, 289);
  assert.deepEqual(s, { selection: null, pending: { edge: 'start', frame: 9500 } });
  // Two Ins in a row: the second replaces the first.
  const t = setPoint('start', 300, s, 100000, 289);
  assert.deepEqual(t.pending, { edge: 'start', frame: 300 });
});

test('flag stepping finds the flags either side of the playhead', () => {
  const flags = [{ frame: 100 }, { frame: 500 }, { frame: 900 }];
  assert.equal(prevFlag(flags, 500).frame, 100);
  assert.equal(nextFlag(flags, 500).frame, 900);
  assert.equal(prevFlag(flags, 50), null);
  assert.equal(nextFlag(flags, 950), null);
});

test('points read m:ss.cc', () => {
  assert.equal(fmtPoint(48000 * 62.345, 48000), '1:02.34');
});

test('the ruler numbers bars from the downbeat, thinning when they are narrow', () => {
  const view = { start: 0, fpp: 100, width: 400 }; // 40000 frames shown
  const ticks = rulerTicks(view, { bpm: 120, sampleRate: 48000, downbeat: 0 }); // a bar is 960 px... at fpp 100
  assert.equal(ticks[0].label, '1');
  const dense = rulerTicks({ start: 0, fpp: 10000, width: 400 }, { bpm: 120, sampleRate: 48000, downbeat: 0 });
  // A bar is 9.6 px here: labels every 4th bar at least 34 px apart.
  assert.ok(dense.length >= 2);
  assert.ok((dense[1].frame - dense[0].frame) / 10000 >= 34);
  const secs = rulerTicks({ start: 0, fpp: 1000, width: 400 }, { bpm: null, sampleRate: 48000, downbeat: 0 });
  assert.deepEqual(secs.slice(0, 2).map((t) => t.label), ['0:00', '0:01']);
});
