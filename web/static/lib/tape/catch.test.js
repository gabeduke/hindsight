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
  assert.match(s.why, /waits for one to finish/);
  assert.equal(s.bars, true, 'the last bars do not wait for a pass');
});

test('stopped: it says to press play', () => {
  const s = catchState({ live: live({ playing: false }), tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /Press ▶/);
  assert.match(s.why, /10 s/);
});

test('with the loop off a pass never comes: it says to turn the loop on', () => {
  const s = catchState({ live: live(), tape: tape({ loop: { on: false, in: 0, out: 480000 } }) });
  assert.equal(s.ready, false);
  assert.match(s.why, /loop is off/);
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

// Before Catch said why it waited, a key with no armed track said "arm a
// track". Waiting for ▶ or a pass now said only that, and a person who had
// just disarmed everything was never told Catch had nowhere to land.
test('waiting with no track armed: it says to arm one, and the reason follows', () => {
  for (const l of [live(), live({ playing: false }), live({ aligned: 'none', playing: false })]) {
    const s = catchState({ live: l, tape: tape(), armed: false });
    assert.equal(s.ready, false);
    assert.match(s.why, /^Arm a track first/);
    assert.match(s.why, /Press ▶|waits for one/, 'the reason it waits is still there');
  }
  // With a track armed, or when it does not say, the reason is the line.
  assert.match(catchState({ live: live({ playing: false }), tape: tape(), armed: true }).why, /^Press ▶/);
  assert.match(catchState({ live: live({ playing: false }), tape: tape() }).why, /^Press ▶/);
});

test('a pass has gone round and none is armed: Catch is ready, and the page says "arm a track" itself', () => {
  const s = catchState({ live: live({ cycles: [{ out: 1, in: 0, len: 480000 }] }), tape: tape(), armed: false });
  assert.equal(s.ready, true);
});

test('the bars on offer are the track sheet’s: 1, 2 and 4', () => {
  assert.deepEqual(CATCH_BARS, [1, 2, 4]);
});

// F7 (flow spec): CATCH says why it waits. While it waits for a pass, The
// last pass in ●'s menu says so under it, and C says it in a toast.
test('a Catch that waits for a pass says so, and how long a pass is', () => {
  const s = catchState({ live: live(), tape: tape() });
  assert.equal(s.ready, false);
  assert.match(s.why, /whole pass/);
  assert.match(s.why, /waits for one to finish \(about 10 s here\)/);
});

test('the other reasons keep their words', () => {
  const t = tape();
  assert.match(catchState({ live: live({ playing: false }), tape: t }).why, /^Press ▶: Catch takes the last whole pass/);
  assert.match(catchState({ live: live({ aligned: 'none', playing: true }), tape: t }).why, /^Catch is lining up/);
  assert.match(catchState({ live: live(), tape: tape({ loop: { on: false, in: 0, out: 480000 } }) }).why, /^The loop is off/);
  assert.match(catchState({ live: live(), tape: t, armed: false }).why, /^Arm a track first/);
});
