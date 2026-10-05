// web/static/lib/cassette-geom.test.js
// A take as a cassette: its stripe, its date stamp, the tape packs, and where
// everything sits in the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeOf, packRadii, stampOf, windowLayout } from './cassette-geom.js';

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
