// web/static/lib/ui/canvas.test.js
// sizeCanvas (lib/ui/canvas.js): a canvas at its window's density, so a
// component draws one without reading the window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeCanvas } from './canvas.js';

function aCanvas(dpr) {
  const sets = [];
  const ctx = { transform: null, setTransform(...a) { this.transform = a; } };
  let width = 300, height = 150; // a canvas's own default size
  return {
    sets,
    ctx,
    ownerDocument: dpr === undefined ? null : { defaultView: { devicePixelRatio: dpr } },
    get width() { return width; },
    set width(v) { sets.push(['width', v]); width = v; },
    get height() { return height; },
    set height(v) { sets.push(['height', v]); height = v; },
    getContext: (kind) => (kind === '2d' ? ctx : null),
  };
}

test('sizeCanvas sizes the store at its window’s density and draws in CSS pixels', () => {
  const cv = aCanvas(2);
  const at = sizeCanvas(cv, 300.4, 40);
  assert.equal(at.dpr, 2);
  assert.equal(at.ctx, cv.ctx);
  assert.deepEqual([cv.width, cv.height], [601, 80]);
  assert.deepEqual(cv.ctx.transform, [2, 0, 0, 2, 0, 0]);
});

test('sizeCanvas leaves a store the right size alone: setting it would clear it', () => {
  const cv = aCanvas(2);
  sizeCanvas(cv, 300, 40);
  cv.sets.length = 0;
  sizeCanvas(cv, 300, 40);
  assert.deepEqual(cv.sets, [], 'nothing set the second time');
  sizeCanvas(cv, 310, 40);
  assert.deepEqual(cv.sets, [['width', 620], ['height', 80]]);
});

test('sizeCanvas: no window density is 1, and a canvas with no width yet has nothing to draw', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio');
  delete globalThis.devicePixelRatio;
  try {
    const cv = aCanvas(undefined);
    assert.equal(sizeCanvas(cv, 100, 20).dpr, 1);
    assert.deepEqual([cv.width, cv.height], [100, 20]);
    assert.equal(sizeCanvas(cv, 0, 20), null);
    assert.equal(sizeCanvas(null, 10, 10), null);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'devicePixelRatio', saved);
  }
});
