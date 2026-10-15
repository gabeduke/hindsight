// web/static/lib/rooms/grab.test.js
// GRAB, from a take and from the feed (docs/superpowers/specs/2026-10-15-flow-design.md,
// decision 12): a take's GRAB is the feed's GRAB, with N starting at the
// loop's length.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loopBars, pickFor, followLoop, takeStartN, takeGrabSpan, takeGrabLabel, loadedLoopBars } from './grab.js';

const SR = 48000;
const BAR = 96000; // 120 BPM
const tape = (over = {}) => ({ sample_rate: SR, grid: { frames: 8 * BAR, bars: 8 }, loop: { in: 0, out: 4 * BAR, on: true }, ...over });

test('the loop’s length in bars: the bracket when it is on', () => {
  assert.equal(loopBars(tape()), 4);
  assert.equal(loopBars(tape({ loop: { in: BAR, out: 3 * BAR, on: true } })), 2);
  assert.equal(loopBars(tape({ loop: { in: 0, out: 3 * BAR + 48000, on: true } })), 3.5);
});

test('with the bracket off, the tape’s first loop is the loop', () => {
  assert.equal(loopBars(tape({ loop: { in: 0, out: BAR, on: false } })), 8);
  assert.equal(loopBars(tape({ loop: undefined })), 8);
  assert.equal(loopBars(tape({ loop: { in: 5, out: 5, on: true } })), 8, 'an empty bracket is no bracket');
});

test('no tempo, no tape: no bars', () => {
  assert.equal(loopBars(tape({ grid: null })), null);
  assert.equal(loopBars(null), null);
  assert.equal(loopBars(undefined), null);
});

test('the picker takes the largest of 1 2 4 8 that fits inside the loop', () => {
  assert.equal(pickFor(1), 1);
  assert.equal(pickFor(2), 2);
  assert.equal(pickFor(3), 2);
  assert.equal(pickFor(4), 4);
  assert.equal(pickFor(6), 4);
  assert.equal(pickFor(8), 8);
  assert.equal(pickFor(16), 8, 'a longer loop is the most it offers');
  assert.equal(pickFor(0.5), 1, 'a loop under a bar is the least it offers');
  assert.equal(pickFor(3.9995), 4, 'a 4-bar loop at a fractional bar length is still the 4');
  assert.equal(pickFor(3.9), 2);
  assert.equal(pickFor(null), null);
  assert.equal(pickFor(NaN), null);
  assert.equal(pickFor(0), null);
});

test('the picker starts at the loop’s bars, and follows the loop until picked by hand', () => {
  const two = tape({ loop: { in: 0, out: 2 * BAR, on: true } });
  let s = { n: 4, picked: false, loopBars: null };
  s = followLoop(s, two);
  assert.deepEqual(s, { n: 2, picked: false, loopBars: 2 }, 'the tape’s loop is 2 bars: GRAB starts at 2');
  s = followLoop({ ...s, n: 8, picked: true }, two);
  assert.equal(s.n, 8, 'a hand-picked 8 stays while the loop is as it was');
  assert.equal(s.picked, true);
  s = followLoop(s, tape());
  assert.deepEqual(s, { n: 4, picked: false, loopBars: 4 }, 'the loop changed: it follows again');
});

test('no loop to follow leaves the picker where it is', () => {
  assert.deepEqual(followLoop({ n: 1, picked: true, loopBars: null }, tape({ grid: null })), { n: 1, picked: true, loopBars: null });
  assert.deepEqual(followLoop({ n: 8, picked: false, loopBars: 8 }, null), { n: 8, picked: false, loopBars: 8 });
});

test('a take’s N starts at the loop’s bars; else the saved pick; else 4', () => {
  assert.equal(takeStartN({ loopBars: 2, stored: 8 }), 2);
  assert.equal(takeStartN({ loopBars: 3, stored: 8 }), 2);
  assert.equal(takeStartN({ loopBars: null, stored: 8 }), 8);
  assert.equal(takeStartN({ loopBars: null, stored: 5 }), 4, 'a saved pick the picker does not have');
  assert.equal(takeStartN({ loopBars: null }), 4);
  assert.equal(takeStartN(), 4);
});

test('a take’s GRAB is the N bars before the playhead, at the take’s tempo', () => {
  // 120 BPM: a bar is 2 s.
  const span = takeGrabSpan({ playhead: 20 * SR, total: 60 * SR, sampleRate: SR, bpm: 120, n: 4 });
  assert.deepEqual(span, { from: 12 * SR, to: 20 * SR });
  // 90 BPM: a bar is 8/3 s; 2 bars is 16/3 s.
  const slow = takeGrabSpan({ playhead: 30 * SR, total: 60 * SR, sampleRate: SR, bpm: 90, n: 2 });
  assert.deepEqual(slow, { from: 30 * SR - Math.round((16 / 3) * SR), to: 30 * SR });
});

test('with no tempo, GRAB takes twice N seconds, as the feed’s does', () => {
  assert.deepEqual(takeGrabSpan({ playhead: 20 * SR, total: 60 * SR, sampleRate: SR, bpm: null, n: 4 }), { from: 12 * SR, to: 20 * SR });
  assert.deepEqual(takeGrabSpan({ playhead: 20 * SR, total: 60 * SR, sampleRate: SR, bpm: 0, n: 2 }), { from: 16 * SR, to: 20 * SR });
});

test('a take’s GRAB never starts before 0', () => {
  const span = takeGrabSpan({ playhead: 3 * SR, total: 60 * SR, sampleRate: SR, bpm: 120, n: 4 });
  assert.deepEqual(span, { from: 0, to: 3 * SR });
});

test('with nothing before the playhead, GRAB is the first N bars', () => {
  assert.deepEqual(takeGrabSpan({ playhead: 0, total: 60 * SR, sampleRate: SR, bpm: 120, n: 4 }), { from: 0, to: 8 * SR });
  assert.deepEqual(takeGrabSpan({ playhead: 0, total: 5 * SR, sampleRate: SR, bpm: 120, n: 4 }), { from: 0, to: 5 * SR }, 'a take shorter than that is all of it');
});

test('a playhead past the end is the end', () => {
  assert.deepEqual(takeGrabSpan({ playhead: 99 * SR, total: 60 * SR, sampleRate: SR, bpm: 120, n: 4 }), { from: 52 * SR, to: 60 * SR });
});

test('a take with no length has no span', () => {
  assert.equal(takeGrabSpan({ playhead: 0, total: 0, sampleRate: SR, bpm: 120, n: 4 }), null);
});

test('a selection is the span, whatever N and the playhead say', () => {
  const span = takeGrabSpan({ region: { start: 10 * SR, end: 14 * SR }, playhead: 50 * SR, total: 60 * SR, sampleRate: SR, bpm: 120, n: 4 });
  assert.deepEqual(span, { from: 10 * SR, to: 14 * SR });
});

test('the key names what it grabs', () => {
  assert.equal(takeGrabLabel({ n: 4, bpm: 120 }), 'GRAB 4 BARS');
  assert.equal(takeGrabLabel({ n: 1, bpm: 120 }), 'GRAB 1 BAR');
  assert.equal(takeGrabLabel({ n: 4, bpm: null }), 'GRAB 8s', 'no tempo: twice N seconds');
  assert.equal(takeGrabLabel({ n: 4, bpm: 120, selection: true }), 'GRAB SELECTION');
});

const fetchOf = (routes) => async (url) => {
  const r = routes[url.split('?')[0]];
  if (!r) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => (typeof r === 'function' ? r(url) : r) };
};

test('the loaded tape’s loop, asked of the Pi', async () => {
  const f = fetchOf({
    '/api/tapes': { loaded: 'tp1', tapes: [] },
    '/api/tapes/state': (u) => (u.includes('id=tp1') ? { tape: tape({ loop: { in: 0, out: 2 * BAR, on: true } }) } : {}),
  });
  assert.equal(await loadedLoopBars(f), 2);
});

test('no tape loaded, the tape off, or the Pi unreachable: no bars, no throw', async () => {
  assert.equal(await loadedLoopBars(fetchOf({ '/api/tapes': { loaded: '', tapes: [] } })), null);
  assert.equal(await loadedLoopBars(fetchOf({})), null);
  assert.equal(await loadedLoopBars(async () => { throw new Error('offline'); }), null);
});
