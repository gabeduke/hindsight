import { test } from 'node:test';
import assert from 'node:assert/strict';
import { punchStart, traceAdd, recRegion, wrappedSince, fullPasses } from './rec.js';

const grid = { frames: 192000, bars: 4 }; // a bar is 48000

test('a punch armed and counted in starts at the first bar line from where the tape stood', () => {
  assert.equal(punchStart(grid, {}, { counting: true, pos: 96000 }), 96000);
  assert.equal(punchStart(grid, {}, { counting: true, pos: 100000 }), 144000);
});

test('a punch while playing starts at the first bar line after it was asked for', () => {
  // Asked 12000 output frames ago, with the device now at tape frame 130000.
  const obs = { heard: 130000, delivered: 1000000, from: 1000000 - 12000 };
  assert.equal(punchStart(grid, {}, obs), 144000);
  // Asked right on a bar line: that one.
  assert.equal(punchStart(grid, {}, { heard: 100000, delivered: 500, from: 500 - 4000 }), 96000);
});

test('a punch asked for just before the loop came round starts at In', () => {
  const loop = { in: 48000, out: 240000, on: true };
  // The tape has wrapped since: 24000 frames ago it was 12000 before Out.
  const obs = { heard: 60000, delivered: 1000000, from: 1000000 - 24000 };
  assert.equal(punchStart(grid, loop, obs), 48000);
  // And one asked for mid-loop starts at the next bar inside it.
  assert.equal(punchStart(grid, loop, { heard: 110000, delivered: 9000, from: 9000 - 1000 }), 144000);
});

test('the trace keeps what this pass recorded, and starts again when the loop comes round', () => {
  let t = traceAdd(null, 1000, -20);
  t = traceAdd(t, 2000, -18);
  assert.deepEqual(t, { passes: 0, samples: [{ pos: 1000, db: -20 }, { pos: 2000, db: -18 }] });
  t = traceAdd(t, 500, -30);
  assert.deepEqual(t, { passes: 1, samples: [{ pos: 500, db: -30 }] });
  // A poll with no level for the source adds nothing.
  assert.equal(traceAdd(t, 900, undefined), t);
});

test('the lane shows the punch from its start, or the loop\'s In once it has wrapped, to the playhead', () => {
  const loop = { in: 48000, out: 240000, on: true };
  assert.deepEqual(recRegion(false, 96000, loop, 120000), { from: 96000, to: 120000 });
  assert.equal(recRegion(false, 96000, loop, 90000), null, 'not at the punch yet');
  assert.deepEqual(recRegion(true, 96000, loop, 60000), { from: 48000, to: 60000 });
  assert.deepEqual(recRegion(true, 96000, {}, 100000), { from: 96000, to: 100000 }, 'no loop to wrap');
});

test('a page opened mid-punch can tell the loop has come round since it began', () => {
  const loop = { in: 48000, out: 240000, on: true };
  // Asked 100000 frames ago, but the tape is only 12000 past In: it wrapped.
  assert.equal(wrappedSince(loop, { heard: 60000, delivered: 200000, from: 100000 }), true);
  assert.equal(wrappedSince(loop, { heard: 160000, delivered: 200000, from: 100000 }), false);
  assert.equal(wrappedSince({ in: 0, out: 0, on: false }, { heard: 10, delivered: 200000, from: 0 }), false);
});

test('the full passes a punch has covered, as the Pi logged them', () => {
  const cycles = [{ out: 1000, in: 0, len: 500 }, { out: 5000, in: 0, len: 500 }, { out: 5500, in: 0, len: 500 }];
  assert.equal(fullPasses(cycles, 4000), 2);
  assert.equal(fullPasses(cycles, 9000), 0);
  assert.equal(fullPasses(undefined, 0), 0);
});
