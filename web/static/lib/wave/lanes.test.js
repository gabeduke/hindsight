import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_H, DRUM_COLOR, MELODIC_COLORS, laneColors, laneLayout, noteRects, alphaFor } from './lanes.js';

const melodic = { name: 'bento ch2', kind: 'notes', notes: [
  { s: 0, e: 4800, p: 60, v: 127 },
  { s: 9600, e: 14400, p: 62, v: 64 },
  { s: 96000, e: 100800, p: 64, v: 1 }, // off-screen in the views below
] };
const drums = { name: 'bento ch1', kind: 'drums', notes: [
  { s: 0, e: 480, p: 36, v: 127 },
  { s: 4800, e: 5280, p: 38, v: 64 },
  { s: 9600, e: 10080, p: 36, v: 127 },
] };
// 10 frames per px, 390px wide: 3900 frames visible... make it 48000 visible.
const view = { start: 0, fpp: 48000 / 390, width: 390 };

test('velocity is opacity', () => {
  assert.equal(alphaFor(127), 1);
  assert.ok(Math.abs(alphaFor(0) - 0.3) < 1e-9);
});

test('drums are amber, melodic tracks cycle, drums do not consume a melodic colour', () => {
  const c = laneColors([drums, melodic, { ...melodic, name: 'x' }]);
  assert.deepEqual(c, [DRUM_COLOR, MELODIC_COLORS[0], MELODIC_COLORS[1]]);
  const five = laneColors([melodic, melodic, melodic, melodic, melodic]);
  assert.equal(five[4], MELODIC_COLORS[0]);
});

test('a melodic layout spans the track\'s pitch range with C rows tinted', () => {
  const L = laneLayout(melodic, false);
  assert.equal(L.h, LANE_H.notes);
  assert.equal(L.lo, 60); assert.equal(L.hi, 64);
  assert.equal(L.rowH, LANE_H.notes / 5);
  // one row per pitch; only C (60) is tinted
  assert.equal(L.rows.length, 5);
  assert.deepEqual(L.rows.filter((r) => r.tint).map((r) => r.top), [4 * L.rowH]);
});

test('a melodic row is never thinner than 4px', () => {
  const wide = { kind: 'notes', notes: [{ s: 0, e: 1, p: 20, v: 1 }, { s: 0, e: 1, p: 100, v: 1 }] };
  const L = laneLayout(wide, false);
  assert.equal(L.rowH, 4);
  assert.equal(L.h, 81 * 4); // span of 81 (pitches 20..100): the body grows to fit it
});

test('a drum layout has one row per distinct pitch, lowest at the bottom', () => {
  const L = laneLayout(drums, false);
  assert.equal(L.h, LANE_H.drums);
  assert.equal(L.rows.length, 2);
  assert.equal(L.rowH, LANE_H.drums / 2);
  assert.equal(L.pitchRow.get(36), 1); // bottom row index 1 of 2 (top = 0)
  assert.equal(L.pitchRow.get(38), 0);
});

test('collapsed is 18px with no rows', () => {
  const L = laneLayout(melodic, true);
  assert.equal(L.h, LANE_H.collapsed);
  assert.equal(L.rows.length, 0);
});

test('melodic note rects sit in their pitch row and are culled to the view', () => {
  const L = laneLayout(melodic, false);
  const r = noteRects(melodic, L, view);
  assert.equal(r.length, 2);            // the third note is past 48000
  assert.equal(r[0].x, 0);
  assert.equal(r[0].w, 4800 / view.fpp);
  assert.equal(r[0].y, (64 - 60) * L.rowH); // pitch 60 is the bottom row
  assert.equal(r[0].h, L.rowH);
  assert.equal(r[0].alpha, 1);
  assert.equal(r[1].y, (64 - 62) * L.rowH);
});

test('a note is at least 2px wide', () => {
  const tiny = { kind: 'notes', notes: [{ s: 0, e: 1, p: 60, v: 127 }] };
  const r = noteRects(tiny, laneLayout(tiny, false), view);
  assert.equal(r[0].w, 2);
});

test('a note overlapping the left edge is kept', () => {
  const late = { start: 2400, fpp: view.fpp, width: 390 };
  const r = noteRects(melodic, laneLayout(melodic, false), late);
  assert.equal(r[0].x, -2400 / view.fpp);
});

test('drum ticks are 2px wide with velocity as height, sitting on the row floor', () => {
  const L = laneLayout(drums, false);
  const r = noteRects(drums, L, view);
  assert.equal(r.length, 3);
  const full = r[0], half = r[1];
  assert.equal(full.w, 2);
  assert.ok(Math.abs(full.h - L.rowH * (0.25 + 0.7)) < 1e-9);
  assert.ok(Math.abs(full.y + full.h - L.h) < 1e-9);          // pitch 36: bottom row, floor at h
  assert.ok(Math.abs(half.h - L.rowH * (0.25 + 0.7 * 64 / 127)) < 1e-9);
  assert.ok(Math.abs(half.y + half.h - L.rowH) < 1e-9);       // pitch 38: top row, floor at rowH
});

test('collapsed rects fill 15%..85% of the strip', () => {
  const L = laneLayout(melodic, true);
  const r = noteRects(melodic, L, view);
  assert.equal(r[0].y, 0.15 * LANE_H.collapsed);
  assert.equal(r[0].h, 0.7 * LANE_H.collapsed);
});
