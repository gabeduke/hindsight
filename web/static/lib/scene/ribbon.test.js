import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ribbonView, RibbonModel } from './ribbon.js';
import { leftPct, ageOf } from '../objects/ribbonmath.js';

// A 15-minute ring, 7 minutes recorded, at 48 kHz.
const SR = 48000;
const ring = { ring: 900, edge: 10, buffered: 420, total: 2000 * SR, sr: SR };
const px = (age, W) => (leftPct(age, ring.edge, ring.ring) / 100) * W;

test('nothing to draw without an axis', () => {
  assert.equal(ribbonView({}), null);
  assert.equal(new RibbonModel().view, null);
});

test('the chosen length is lit from its age to now, and the whole ring is the ring', () => {
  const v = ribbonView({ ...ring, selected: 120 });
  assert.deepEqual(v.lit, [leftPct(120, 10, 900) / 100, 1]);
  assert.deepEqual(ribbonView({ ...ring, selected: 0 }).lit, [0, 1]);
  assert.equal(ribbonView({ ...ring }).lit, null, 'nothing chosen, nothing lit');
});

test('it lands on the same pixels the ribbon drew before it had a model', () => {
  // Ribbon.paint computed px(age) = axisPct(age) / 100 * W; the renderer now
  // multiplies the view's fraction by W, in the same order, so the two are
  // the same float.
  const W = 337;
  const sel = { from: ring.total - 90 * SR, to: ring.total - 30 * SR };
  const v = ribbonView({ ...ring, sel, selected: 120 });
  assert.equal(v.lit[0] * W, px(Math.min(ageOf(sel.from, ring.total, SR), ring.buffered), W));
  assert.equal(v.lit[1] * W, px(ageOf(sel.to, ring.total, SR), W));
  assert.equal(v.recordedFrom * W, px(ring.buffered, W));
});

test('a span held on the ribbon wins over the chosen length, and runs to now when open', () => {
  const v = ribbonView({ ...ring, sel: { from: ring.total - 60 * SR, to: null }, selected: 0 });
  assert.equal(v.lit[1], 1);
  assert.ok(v.lit[0] > 0.5);
});

test('a span older than what was recorded starts where recording did', () => {
  const v = ribbonView({ ...ring, sel: { from: 0, to: null } });
  assert.equal(v.lit[0], v.recordedFrom);
});

test('a span needs the ring\'s frames to be drawn', () => {
  const v = ribbonView({ ...ring, total: 0, sel: { from: 1, to: null }, selected: 30 });
  assert.deepEqual(v.lit, [leftPct(30, 10, 900) / 100, 1], 'falls back to the chosen length');
});

test('the model keeps its view while nothing changes, and never asks for a frame', () => {
  const m = new RibbonModel();
  assert.equal(m.step({ ...ring, selected: 30 }), false);
  const v = m.view;
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.lit));
  m.step({ ...ring, selected: 30, levels: new Float32Array(4) });
  assert.equal(m.view, v);
  m.step({ ...ring, selected: 60 });
  assert.notEqual(m.view, v);
});
