import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchState, catchSub, catchMini, CATCH_BARS } from './catch.js';

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

// Before Catch said why it waited, a key with no armed track said "arm a
// track". Waiting for ▶ or a pass now said only that, and a person who had
// just disarmed everything was never told Catch had nowhere to land.
test('waiting with no track armed: the key says to arm one, and the reason follows', () => {
  for (const l of [live(), live({ playing: false }), live({ aligned: 'none', playing: false })]) {
    const s = catchState({ live: l, tape: tape(), armed: false });
    assert.equal(s.ready, false);
    assert.equal(s.short, 'arm a track');
    assert.match(s.why, /^Arm a track first/);
    assert.match(s.why, /Press ▶|waits for one/, 'the reason it waits is still there');
  }
  // With a track armed, or when it does not say, the reason is the line.
  assert.equal(catchState({ live: live({ playing: false }), tape: tape(), armed: true }).short, 'press ▶');
  assert.equal(catchState({ live: live({ playing: false }), tape: tape() }).short, 'press ▶');
});

test('a pass has gone round and none is armed: Catch is ready, and the page says "arm a track" itself', () => {
  const s = catchState({ live: live({ cycles: [{ out: 1, in: 0, len: 480000 }] }), tape: tape(), armed: false });
  assert.equal(s.ready, true);
});

test('the bars on offer are the track sheet’s: 1, 2 and 4', () => {
  assert.deepEqual(CATCH_BARS, [1, 2, 4]);
});

// F7 (flow spec): CATCH says what it catches, and why it waits. In the Studio
// the key reads "last pass → 2" and, while it waits for a pass, "after one
// pass"; the old pages keep "waits for a pass".
test('with the rooms on a Catch that waits for a pass says "after one pass"', () => {
  const s = catchState({ live: live(), tape: tape(), rooms: true });
  assert.equal(s.ready, false);
  assert.equal(s.short, 'after one pass');
  assert.match(s.why, /whole pass/, 'the reason in full is still there');
  assert.equal(catchState({ live: live(), tape: tape() }).short, 'waits for a pass', 'the rooms off: as before');
});

test('with the rooms on the other reasons keep their words', () => {
  const t = tape();
  assert.equal(catchState({ live: live({ playing: false }), tape: t, rooms: true }).short, 'press ▶');
  assert.equal(catchState({ live: live({ aligned: 'none', playing: true }), tape: t, rooms: true }).short, 'lining up');
  assert.equal(catchState({ live: live(), tape: tape({ loop: { on: false, in: 0, out: 480000 } }), rooms: true }).short, 'loop is off');
  assert.equal(catchState({ live: live(), tape: t, rooms: true, armed: false }).short, 'arm a track');
});

test('the key’s second line says what it catches: the last pass, onto which tracks', () => {
  const ready = catchState({ live: live({ cycles: [{ out: 1, in: 0, len: 480000 }] }), tape: tape(), rooms: true });
  assert.equal(catchSub(ready, { armed: [2], rooms: true }), 'last pass → 2');
  assert.equal(catchSub(ready, { armed: [2, 3], rooms: true }), 'last pass → 2, 3');
  assert.equal(catchSub(ready, { armed: [], rooms: true }), 'arm a track');
  // The old pages keep their words.
  assert.equal(catchSub(ready, { armed: [2], rooms: false }), 'last pass → track 2');
  assert.equal(catchSub(ready, { armed: [2, 3], rooms: false }), 'last pass → 2, 3');
  assert.equal(catchSub(ready, { armed: [], rooms: false }), 'arm a track');
});

test('waiting, it says why in the same place; on a phone playing late, that it needs the jam room', () => {
  const waits = catchState({ live: live(), tape: tape(), rooms: true });
  assert.equal(catchSub(waits, { armed: [2], rooms: true }), 'after one pass');
  const stopped = catchState({ live: live({ playing: false }), tape: tape(), rooms: true, armed: false });
  assert.equal(catchSub(stopped, { armed: [], rooms: true }), 'arm a track');
  const late = catchState({ live: live({ aligned: 'none' }), tape: tape(), phoneOut: true, rooms: true });
  assert.equal(catchSub(late, { armed: [2], phoneOut: true, rooms: true }), 'jam room only');
});

test('on the phone’s mini bar the key’s second line is short enough to leave the transport its bar number', () => {
  assert.equal(catchMini('last pass → 2'), '→ 2');
  assert.equal(catchMini('last pass → 2, 3'), '→ 2, 3');
  assert.equal(catchMini('after one pass'), 'in 1 pass');
  assert.equal(catchMini('loop is off'), 'loop off');
  assert.equal(catchMini('arm a track'), 'arm track');
  assert.equal(catchMini('jam room only'), 'jam room');
  for (const s of ['press ▶', 'lining up', 'waiting']) assert.equal(catchMini(s), s, s);
  // Every word the key can say in the Studio is nine characters or fewer, for any armed set.
  const words = ['after one pass', 'press ▶', 'loop is off', 'lining up', 'arm a track', 'jam room only', 'waiting'];
  for (let mask = 1; mask < 64; mask++) {
    const ns = [1, 2, 3, 4, 5, 6].filter((n) => mask & (1 << (n - 1)));
    words.push(catchSub({ ready: true }, { armed: ns, rooms: true }));
  }
  for (const s of words) assert.ok(catchMini(s).length <= 9, `${s} -> ${catchMini(s)}`);
  // A run of tracks is a range; anything else that is long says how many.
  assert.equal(catchMini('last pass → 1, 2, 3, 4'), '→ 1–4');
  assert.equal(catchMini('last pass → 2, 3, 4'), '→ 2, 3, 4');
  assert.equal(catchMini('last pass → 1, 2, 3, 4, 5'), '→ 1–5');
  assert.equal(catchMini('last pass → 1, 2, 4, 5, 6'), '→ 5 trk');
  assert.equal(catchMini('last pass → 1, 2, 3'), '→ 1, 2, 3', 'nine already: said in full');
});
