import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pennant, drawPennant, drawPennantName, drawPin, pinTag, PENNANT_TOP } from './pennant.js';

/** A 2d context that writes down what it is asked to do. */
function recorder(textWidth = 40) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'calls') return calls;
      if (k === 'measureText') return (s) => ({ width: textWidth, text: s });
      return (...a) => calls.push([k, ...a]);
    },
    set(_, k, v) { calls.push([`${String(k)}=`, v]); return true; },
  });
  return ctx;
}

test('the pennant flies right of its stem, 8 px out and 8 px deep', () => {
  assert.deepEqual(pennant(100), [[102, PENNANT_TOP], [110, PENNANT_TOP + 4], [102, PENNANT_TOP + 8]]);
  assert.deepEqual(pennant(0, 10), [[2, 10], [10, 14], [2, 18]]);
});

test('a flag is its line through the audio, its stem, and its pennant', () => {
  const ctx = recorder();
  drawPennant(ctx, 50.4, { pinH: 16, bottom: 200, ink: '#e5a50a' });
  assert.deepEqual(ctx.calls, [
    ['fillStyle=', '#e5a50a'],
    ['fillRect', 50, 16, 1, 184],
    ['fillRect', 50, 2, 2, 14],
    ['beginPath'],
    ['moveTo', 52.4, 2],
    ['lineTo', 60.4, 6],
    ['lineTo', 52.4, 10],
    ['closePath'],
    ['fill'],
  ]);
});

test('the selected flag has the thicker line', () => {
  const ctx = recorder();
  drawPennant(ctx, 50, { pinH: 16, bottom: 200, selected: true, ink: '#e5a50a' });
  assert.deepEqual(ctx.calls[1], ['fillRect', 49, 16, 3, 184]);
});

test('a name is written beside the pennant, and says where it ends', () => {
  const ctx = recorder(40);
  const right = drawPennantName(ctx, 50, 'the riff', { pinH: 16, ink: '#f2e6c8' });
  assert.deepEqual(ctx.calls, [['fillStyle=', '#f2e6c8'], ['fillText', 'the riff', 62, 12, 140]]);
  assert.equal(right, 50 + 12 + 40 + 6);
  // A long name is held to 140 px, and so is where it ends.
  assert.equal(drawPennantName(recorder(500), 0, 'x', { pinH: 16, ink: '#fff' }), 12 + 140 + 6);
});

test('a note’s pin is a tag with its number, wider for two figures', () => {
  assert.deepEqual(pinTag(100.4, 3, 16), { x: 100, y: PENNANT_TOP, w: 14, h: 14 });
  assert.deepEqual(pinTag(100, 12, 16), { x: 100, y: PENNANT_TOP, w: 18, h: 14 });
  const ctx = recorder();
  const right = drawPin(ctx, 50, 7, { pinH: 16, bottom: 200, ink: '#e5a50a', numInk: '#fff', font: 'x' });
  assert.equal(right, 64, 'it answers where the tag ends, for the words');
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText' && c[1] === '7'), 'its number is written on it');
  assert.ok(ctx.calls.some((c) => c[0] === 'fillRect' && c[1] === 50 && c[2] === 16 && c[4] === 184), 'and its line goes through the audio');
});
