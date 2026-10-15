import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ballistic, lag, settled, spin, slack, Loop, Ticker, VU_WN, VU_ZETA } from './motion.js';

// A fake clock, so motion is tested as maths rather than as a race with a
// real requestAnimationFrame.
function fakeClock() {
  let t = 0;
  const queue = [];
  return {
    now: () => t,
    raf: (fn) => queue.push(fn),
    cancel: () => queue.length = 0,
    pending: () => queue.length,
    /** advance runs one frame `ms` later, as rAF would. */
    advance(ms) {
      t += ms;
      const due = queue.splice(0, queue.length);
      for (const fn of due) fn(t);
    },
  };
}

/** step runs a ballistic movement from rest to 1 at `hz`, for `ms`. */
function toRest(hz, ms, target = 1) {
  let value = 0, velocity = 0;
  const dt = 1000 / hz;
  for (let i = 0; i < Math.round((ms / 1000) * hz); i++) {
    ({ value, velocity } = ballistic(value, velocity, target, dt));
  }
  return { value, velocity };
}

test('ballistic meets the VU standard: 99% at 300ms', () => {
  let value = 0, velocity = 0, t99 = null;
  for (let t = 1; t <= 600; t++) {
    ({ value, velocity } = ballistic(value, velocity, 1, 1));
    if (t99 === null && value >= 0.99) t99 = t;
  }
  // The standard says 300 ms to 99% of a step. This is the number the
  // constants are chosen for, so it is worth failing loudly on.
  assert.equal(t99, 300);
});

test('ballistic overshoots by about 1%, as a real movement does', () => {
  let value = 0, velocity = 0, peak = 0;
  for (let t = 0; t < 1200; t++) {
    ({ value, velocity } = ballistic(value, velocity, 1, 1));
    peak = Math.max(peak, value);
  }
  const overshoot = (peak - 1) * 100;
  assert.ok(overshoot > 0.8 && overshoot < 1.5, `overshoot ${overshoot.toFixed(2)}% outside 0.8-1.5%`);
  // And it is the analytic value for this damping ratio, not a coincidence.
  const analytic = Math.exp(-Math.PI * VU_ZETA / Math.sqrt(1 - VU_ZETA * VU_ZETA)) * 100;
  assert.ok(Math.abs(overshoot - analytic) < 0.05);
});

test('ballistic is frame-rate independent, not merely close', () => {
  // The whole reason for the closed form. A phone dropping from 120 Hz to
  // 20 Hz mid-swing must not change where the needle is.
  const at = [240, 120, 60, 30, 20, 10].map((hz) => toRest(hz, 500).value);
  for (const v of at) assert.ok(Math.abs(v - at[0]) < 1e-9, `${v} != ${at[0]}`);
});

test('ballistic settles rather than exploding on a long frame', () => {
  // A backgrounded tab comes back with one enormous dt. A stiff explicit
  // integrator would fly off; arriving is the right answer.
  assert.deepEqual(ballistic(0, 0, 1, 60_000), { value: 1, velocity: 0 });
  assert.deepEqual(ballistic(0.3, 2, 1, Infinity), { value: 1, velocity: 0 });
});

test('ballistic leaves things alone at dt 0', () => {
  assert.deepEqual(ballistic(0.3, 2, 1, 0), { value: 0.3, velocity: 2 });
});

test('ballistic carries velocity through a target change', () => {
  // Mid-swing the level changes. The needle must keep its momentum rather
  // than restart, which is what makes a meter read as a physical thing.
  let { value, velocity } = toRest(60, 120);
  assert.ok(velocity > 0);
  const next = ballistic(value, velocity, 0, 1000 / 60);
  assert.ok(next.velocity < velocity);
});

test('lag covers 63% in one time constant, at any frame rate', () => {
  for (const hz of [120, 60, 30]) {
    let v = 0;
    for (let i = 0; i < hz / 10; i++) v = lag(v, 1, 100, 1000 / hz); // 100ms
    assert.ok(Math.abs(v - (1 - Math.exp(-1))) < 1e-9, `${hz}Hz gave ${v}`);
  }
});

test('lag arrives on a degenerate tau or an infinite step', () => {
  assert.equal(lag(0, 1, 0, 16), 1);
  assert.equal(lag(0, 1, 100, Infinity), 1);
});

test('settled is true only once it has arrived and stopped', () => {
  assert.ok(settled(1, 0, 1));
  assert.ok(!settled(0.5, 0, 1));
  assert.ok(!settled(1, 5, 1)); // there but still moving: it will overshoot
});

test('a heavy reel spins up more slowly than a light one', () => {
  // The supply reel is heavy when full and light when nearly empty, which
  // is the whole point of passing the pack radius as inertia.
  let heavy = { angle: 0, rate: 0 }, light = { angle: 0, rate: 0 };
  for (let i = 0; i < 30; i++) {
    heavy = spin(heavy.angle, heavy.rate, 1, 64, 1000 / 60);
    light = spin(light.angle, light.rate, 1, 20, 1000 / 60);
  }
  assert.ok(light.rate > heavy.rate, `light ${light.rate} should lead heavy ${heavy.rate}`);
  assert.ok(heavy.rate > 0 && light.rate < 1);
});

test('spin coasts down rather than stopping dead', () => {
  let s = { angle: 0, rate: 1 };
  const first = spin(s.angle, s.rate, 0, 40, 1000 / 60);
  assert.ok(first.rate > 0 && first.rate < 1);
  assert.ok(first.angle > 0, 'it keeps moving while it slows');
});

test('spin wraps its angle and never winds on through a long frame', () => {
  const { angle } = spin(350, 100, 100, 40, 1000 / 60);
  assert.ok(angle >= 0 && angle < 360);
  // A tab gone for four seconds must not unwind four seconds of tape.
  const long = spin(0, 10, 10, 40, 4000);
  const capped = spin(0, 10, 10, 40, 64);
  assert.equal(long.angle.toFixed(6), capped.angle.toFixed(6));
});

test('the ticker parks when nothing is moving and wakes when something is', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  let wants = true;
  const remove = ticker.add(() => wants);
  assert.ok(ticker.running);

  c.advance(16);
  assert.ok(ticker.running, 'still wanted, so still scheduled');

  wants = false;
  c.advance(16);
  assert.ok(!ticker.running, 'nothing wants frames, so it parks');

  remove();
  const again = ticker.add(() => true);
  assert.ok(ticker.running, 'a new object starts it again');
  again();
});

test('the ticker steps everything once per frame with the elapsed time', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  const seen = [];
  ticker.add((dt) => { seen.push(dt); return true; });
  c.advance(16);
  c.advance(32);
  assert.deepEqual(seen, [16, 32]);
});

test('one object throwing does not stop the others', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false, onError: () => {} });
  let ran = 0;
  ticker.add(() => { throw new Error('bad object'); });
  ticker.add(() => { ran++; return true; });
  c.advance(16);
  c.advance(16);
  assert.equal(ran, 2);
});

test('reduced motion lands on the target in one frame', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: true });
  let got = null;
  ticker.add((dt) => { got = dt; return false; });
  c.advance(16);
  assert.equal(got, Infinity);
  // Which is what makes every object arrive at once, with no per-object code.
  assert.deepEqual(ballistic(0, 0, 1, got), { value: 1, velocity: 0 });
});

test('removing the last object stops the loop', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  const remove = ticker.add(() => true);
  assert.ok(ticker.running);
  remove();
  assert.ok(!ticker.running);
});

test('the chosen natural frequency is the one that puts 99% at 300ms', () => {
  // Guards the constant against a well-meaning round number: solving it
  // again here is cheap, and it documents where 13.9923 came from.
  const t99 = (wn) => {
    let value = 0, velocity = 0;
    for (let t = 1; t <= 2000; t++) {
      ({ value, velocity } = ballistic(value, velocity, 1, 1, { wn, zeta: VU_ZETA }));
      if (value >= 0.99) return t;
    }
    return Infinity;
  };
  assert.equal(t99(VU_WN), 300);
  assert.ok(t99(VU_WN * 1.2) < 300, 'a faster movement reaches 99% sooner');
  assert.ok(t99(VU_WN * 0.8) > 300, 'a slower one takes longer');
});

test('waking the ticker from inside a step does not start a second loop', () => {
  // A step that sets another object's state wakes the ticker mid-frame (the
  // bar's frame polls the reels, whose scene wakes the ticker). Two loops
  // would step everything twice a frame, and only ever on someone's phone.
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  let calls = 0;
  ticker.add(() => { calls++; ticker.start(); return true; });
  c.advance(16);
  assert.equal(c.pending(), 1, 'one frame scheduled, not two');
  c.advance(16);
  assert.equal(calls, 2, 'stepped once a frame');
});

test('a step added from inside a step runs from the next frame, on the same loop', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  let late = 0;
  let once = true;
  ticker.add(() => {
    if (once) { once = false; ticker.add(() => { late++; return false; }); }
    return false;
  });
  c.advance(16);
  assert.equal(c.pending(), 1, 'the new step asks for a frame, once');
  c.advance(16);
  assert.equal(late, 1);
  assert.ok(!ticker.running, 'and nothing wants another, so it parks');
});

test('each step is told the time as well as the elapsed time', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  const seen = [];
  ticker.add((dt, now) => { seen.push([dt, now]); return seen.length < 2; });
  c.advance(16);
  c.advance(20);
  assert.deepEqual(seen, [[16, 16], [20, 36]]);
});

test('a Loop leaves the ticker when it stops wanting frames', () => {
  // A parked player must cost nothing while the meters keep the ticker going.
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  ticker.add(() => true); // something else, always moving
  let frames = 0, playing = true;
  const loop = new Loop(() => { frames++; return playing; }, ticker);
  loop.start();
  loop.start(); // twice is once
  c.advance(16);
  c.advance(16);
  assert.equal(frames, 2);
  playing = false;
  c.advance(16);
  assert.ok(!loop.running);
  c.advance(16);
  c.advance(16);
  assert.equal(frames, 3, 'not stepped once it said it was done');
  playing = true;
  loop.start();
  c.advance(16);
  assert.equal(frames, 4, 'and started again on demand');
});

test('a Loop that throws is taken off, and can be started again', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false, onError: () => {} });
  let n = 0;
  const loop = new Loop(() => { n++; if (n === 1) throw new Error('bad frame'); return true; }, ticker);
  loop.start();
  c.advance(16);
  assert.ok(!loop.running, 'a throw ends it, as a rAF loop that threw would end');
  loop.start();
  c.advance(16);
  assert.equal(n, 2);
  loop.stop();
  assert.ok(!ticker.running);
});

test('a step taken off by an earlier step in the same frame is not run', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  let calls = 0, offB = null;
  ticker.add(() => { offB?.(); return true; });
  offB = ticker.add(() => { calls++; return true; });
  c.advance(16);
  assert.equal(calls, 0, 'removed before its turn, so not stepped');
});

test('a Loop that restarts itself from inside its step keeps running', () => {
  const c = fakeClock();
  const ticker = new Ticker({ ...c, reduced: false });
  let n = 0;
  const loop = new Loop(() => {
    n++;
    if (n === 1) { loop.stop(); loop.start(); return false; }
    return true;
  }, ticker);
  loop.start();
  c.advance(16);
  assert.ok(loop.running, 'the new start is not undone by the old step saying false');
  c.advance(16);
  assert.equal(n, 2);
});

test('a step that throws is reported once, and the rest keep going', () => {
  // A loop that broke used to surface as an uncaught error; on the shared
  // ticker it must still be heard, once, not sixty times a second.
  const c = fakeClock();
  const errors = [];
  const ticker = new Ticker({ ...c, reduced: false, onError: (e) => errors.push(e.message) });
  let ok = 0, fail = true;
  ticker.add(() => { if (fail) throw new Error('broken'); return true; });
  ticker.add(() => { ok++; return true; });
  for (let i = 0; i < 10; i++) c.advance(16);
  assert.deepEqual(errors, ['broken']);
  assert.equal(ok, 10);
  fail = false;
  c.advance(16);
  fail = true;
  c.advance(16);
  assert.deepEqual(errors, ['broken', 'broken'], 'a fresh failure after it recovered is reported again');
});

test('a Loop that throws is reported and taken off', () => {
  const c = fakeClock();
  const errors = [];
  const ticker = new Ticker({ ...c, reduced: false, onError: (e) => errors.push(e.message) });
  const loop = new Loop(() => { throw new Error('paint broke'); }, ticker);
  loop.start();
  c.advance(16);
  c.advance(16);
  assert.deepEqual(errors, ['paint broke']);
  assert.ok(!loop.running);
});

/** kicked runs a stop's slack from taut, kicked at `v` per second, at `hz` for `ms`; returns every sag. */
function kicked(v, hz, ms) {
  let sag = 0, velocity = v;
  const dt = 1000 / hz, out = [];
  for (let i = 0; i < Math.round((ms / 1000) * hz); i++) {
    ({ sag, velocity } = slack(sag, velocity, dt));
    out.push(sag);
  }
  return { sag, velocity, out };
}

test('slack: a stop’s loose tape hangs, then is taken up with one small bounce', () => {
  const { out } = kicked(150, 1000, 600);
  const peak = Math.max(...out);
  const dip = Math.min(...out);
  assert.ok(peak > 2 && peak < 6, `it hangs a few px (${peak.toFixed(2)})`);
  assert.ok(dip < 0, 'it goes a touch past taut');
  assert.ok(-dip < peak * 0.4, `the bounce is small (${dip.toFixed(2)} after ${peak.toFixed(2)})`);
  // Taken up in about a third of a second.
  const loose = out.findLastIndex((s) => Math.abs(s) > 0.1 * peak);
  assert.ok(loose < 400, `still loose at ${loose} ms`);
});

test('slack is the same at 20 Hz and 120 Hz, and lands taut at an infinite step', () => {
  const a = kicked(150, 20, 300), b = kicked(150, 120, 300);
  assert.ok(Math.abs(a.sag - b.sag) < 1e-9, `${a.sag} vs ${b.sag}`);
  assert.deepEqual(slack(4, 50, Infinity), { sag: 0, velocity: 0 });
  assert.deepEqual(slack(0, 0, 16), { sag: 0, velocity: 0 });
});
