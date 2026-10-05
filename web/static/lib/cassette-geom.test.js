// web/static/lib/cassette-geom.test.js
// A take as a cassette: its stripe, its date stamp, the tape packs, and where
// everything sits in the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeOf, packRadii, stampOf, windowLayout, playedX, fracAt, inOutLabels, greaseMark } from './cassette-geom.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('stripeOf gives a take the same stripe every time, one of five', () => {
  for (let i = 0; i < 200; i++) {
    const name = `jam_2026-10-0${i % 9}_${String(100000 + i * 37).slice(0, 6)}.wav`;
    const s = stripeOf(name);
    assert.ok(Number.isInteger(s) && s >= 1 && s <= 5);
    assert.equal(stripeOf(name), s);
  }
});

test('stripeOf spreads takes across the stripes', () => {
  const count = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 200; i++) count[stripeOf(`jam_2026-10-${String(1 + (i % 28)).padStart(2, '0')}_${String(i * 4111).padStart(6, '0').slice(-6)}.wav`)]++;
  for (let s = 1; s <= 5; s++) assert.ok(count[s] >= 20 && count[s] <= 60, `stripe ${s}: ${count[s]} of 200`);
});

test('packRadii trades tape from the left reel to the right, area for area', () => {
  assert.deepEqual(packRadii(0, 22, 44), [44, 22]);
  assert.deepEqual(packRadii(1, 22, 44), [22, 44]);
  const [l, r] = packRadii(0.5, 22, 44);
  near(l, r);
  near(l * l, (22 * 22 + 44 * 44) / 2);
  assert.deepEqual(packRadii(-1, 22, 44), [44, 22]);
  assert.deepEqual(packRadii(2, 22, 44), [22, 44]);
});

test('stampOf prints the day and time the take was caught', () => {
  assert.equal(stampOf({ name: 'jam_2026-10-04_201512.wav' }), 'SUN 4 OCT · 20:15');
  assert.equal(stampOf({ name: 'phone_take.wav' }), '');
});

test('windowLayout puts the desk cassette as the design draws it', () => {
  const L = windowLayout(786, 'desk');
  assert.equal(L.H, 300);
  assert.equal(L.win.w, 638);
  assert.equal(L.win.h, 104);
  assert.equal(L.win.x0, 118);
  assert.equal(L.win.n, 101);
  assert.equal(L.win.pitch, 4);
  assert.deepEqual([L.win.rMin, L.win.rMax], [22, 44]);
});

test('windowLayout puts the phone cassette as the design draws it', () => {
  const L = windowLayout(358, 'phone');
  assert.equal(L.H, 228);
  assert.equal(L.win.w, 302);
  assert.equal(L.win.h, 84);
  assert.equal(L.win.x0, 76);
  assert.equal(L.win.n, 43);
  assert.deepEqual([L.win.rMin, L.win.rMax], [15, 30]);
});

test('windowLayout fits more bars into a wider cassette', () => {
  assert.ok(windowLayout(900, 'desk').win.n > 101);
});

test('playedX runs the playhead along the bars, start to end', () => {
  const L = windowLayout(786, 'desk');
  assert.equal(playedX(0, L), 118);
  assert.equal(playedX(1, L), 118 + 100 * 4);
  assert.equal(playedX(2, L), 518);
});

test('fracAt reads a press in the window back as a place in the take', () => {
  const L = windowLayout(786, 'desk');
  near(fracAt(318, L), 0.5);
  assert.equal(fracAt(0, L), 0);
  assert.equal(fracAt(9999, L), 1);
});

test('inOutLabels writes IN and OUT inside a selection wide enough to hold them', () => {
  const L = windowLayout(786, 'desk');
  const lab = inOutLabels({ start: 0.25, end: 0.75 }, L);
  assert.equal(lab.inX, Math.round(playedX(0.25, L) + 2));
  assert.equal(lab.outX, Math.round(playedX(0.75, L) - 2));
  assert.equal(inOutLabels({ start: 0.5, end: 0.6 }, L), null); // 40 px: no room
  assert.equal(inOutLabels(null, L), null);
});

test('greaseMark is a wobbling stroke with a hook at each end, pointing inward', () => {
  const L = windowLayout(786, 'desk');
  const pts = greaseMark(200, 1, 51, L);
  assert.deepEqual(pts[0], [206, 14]);
  assert.deepEqual(pts.at(-1), [206, 91]);
  for (const [x] of pts.slice(1, -1)) assert.ok(Math.abs(x - 200) <= 1.5);
  assert.deepEqual(greaseMark(200, 1, 51, L), pts); // the same seed, the same stroke
  assert.equal(greaseMark(300, -1, 52, L)[0][0], 294);
});
