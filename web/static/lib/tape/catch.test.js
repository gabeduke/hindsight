import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchState, CATCH_BARS } from './catch.js';

// CATCH was greyed with nothing to say why: it lights after one whole pass of
// the loop (about 10 s at 96 BPM and 4 bars), and "the last 4 bars" is not on
// it at all. The state says why it waits, in words a person can act on, and
// whether the bars can go meanwhile (they need the tape lined up, not a pass).

const SR = 48000;
const tape = (over = {}) => ({ sample_rate: SR, grid: { frames: 480000, bars: 4 }, loop: { on: true, in: 0, out: 480000 }, ...over });
const live = (over = {}) => ({ playing: true, aligned: 'exact', cycles: [], ...over });

test('a pass has gone round: Catch can go', () => {
  const s = catchState({ live: live({ cycles: [{ out: 1, in: 0, len: 480000 }] }), tape: tape() });
  assert.deepEqual([s.ready, s.why], [true, '']);
});

test('playing, no pass yet: it says it waits for one, and how long', () => {
  const s = catchState({ live: live(), tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /whole pass/);
  assert.match(s.why, /about 10 s/);
  assert.equal(s.short, 'waits for a pass', 'the key’s second line');
  assert.equal(s.bars, true, 'the last bars do not wait for a pass');
});

test('stopped: it says to press play', () => {
  const s = catchState({ live: live({ playing: false }), tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /Press ▶/);
  assert.match(s.why, /10 s/);
  assert.equal(s.short, 'press ▶');
});

test('with the loop off a pass never comes: it says to turn the loop on', () => {
  const s = catchState({ live: live(), tape: tape({ loop: { on: false, in: 0, out: 480000 } }) });
  assert.equal(s.ready, false);
  assert.match(s.why, /loop is off/);
  assert.equal(s.short, 'loop is off');
});

test('not lined up yet: it says the tape has to play for Catch to line it up, and offers no bars', () => {
  const s = catchState({ live: live({ aligned: 'none', playing: false }), tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /Press ▶/);
  assert.match(s.why, /line/);
  assert.equal(s.bars, false);
  assert.match(s.barsWhy, /Press ▶/);
});

test('no tempo: no bars, and it says why', () => {
  const s = catchState({ live: live(), tape: tape({ grid: null }) });
  assert.equal(s.bars, false);
  assert.match(s.barsWhy, /tempo/);
});

test('the Pi has not answered', () => {
  const s = catchState({ live: null, tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /Pi/);
});

test('on a phone playing the tape late, Catch is left to the jam-room sheet that explains it', () => {
  const s = catchState({ live: live({ aligned: 'none' }), tape: tape(), phoneOut: true });
  assert.deepEqual([s.ready, s.why, s.bars], [true, '', false]);
});

test('the bars on offer are the track sheet’s: 1, 2 and 4', () => {
  assert.deepEqual(CATCH_BARS, [1, 2, 4]);
});
