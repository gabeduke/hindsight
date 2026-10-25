import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ballistic, lag, settled, spin, spring, springEasing, project, Loop, Ticker, T, SPRINGS, EASING_EPS, VU_WN, VU_ZETA,
} from './motion.js';

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

// ---------- spring(): every damping, against the equation itself ----------

/**
 * integrate runs x'' = -wn²(x - target) - 2ζwn·x' with RK4 at a fine,
 * fixed step: slow and only approximate, but free of every closed form, so
 * it is an honest referee for them.
 */
function integrate(x, v, target, ms, { zeta, wn }, h = 1e-5) {
  const a = (x, v) => -wn * wn * (x - target) - 2 * zeta * wn * v;
  for (let t = 0; t < ms / 1000 - h / 2; t += h) {
    const k1x = v, k1v = a(x, v);
    const k2x = v + (h / 2) * k1v, k2v = a(x + (h / 2) * k1x, v + (h / 2) * k1v);
    const k3x = v + (h / 2) * k2v, k3v = a(x + (h / 2) * k2x, v + (h / 2) * k2v);
    const k4x = v + h * k3v, k4v = a(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return { value: x, velocity: v };
}

const DAMPINGS = [
  ['ringing (the needle)', SPRINGS.needle],
  ['lid', SPRINGS.lid],
  ['carry', SPRINGS.carry],
  ['critical (snap)', SPRINGS.snap],
  ['overdamped', { zeta: 1.6, wn: 30 }],
];

test('spring is the equation’s exact answer at every damping, from rest and from a flick', () => {
  for (const [name, s] of DAMPINGS) {
    for (const [x0, v0] of [[0, 0], [0, 40], [2, -25]]) {
      for (const ms of [5, 40, 160]) {
        const got = spring(x0, v0, 1, ms, s);
        const want = integrate(x0, v0, 1, ms, s);
        assert.ok(Math.abs(got.value - want.value) < 1e-6, `${name} from ${x0},${v0} after ${ms} ms: ${got.value} vs ${want.value}`);
        assert.ok(Math.abs(got.velocity - want.velocity) < 1e-4, `${name}'s speed from ${x0},${v0} after ${ms} ms`);
      }
    }
  }
});

test('critical damping is finite where the ringing form divides by nothing', () => {
  for (const zeta of [1, 1 - 1e-9, 1 + 1e-9]) {
    const r = spring(0, 0, 1, 16, { zeta, wn: 55 });
    assert.ok(Number.isFinite(r.value) && Number.isFinite(r.velocity), `ζ ${zeta}`);
  }
  // The form ballistic() alone would take: 0/0.
  const wd = 55 * Math.sqrt(1 - 1);
  assert.equal(wd, 0);
  // Either side of 1 agrees with 1 itself.
  const at1 = spring(0, 0, 1, 30, { zeta: 1, wn: 55 }).value;
  assert.ok(Math.abs(spring(0, 0, 1, 30, { zeta: 1 - 1e-4, wn: 55 }).value - at1) < 1e-4);
  assert.ok(Math.abs(spring(0, 0, 1, 30, { zeta: 1 + 1e-4, wn: 55 }).value - at1) < 1e-4);
});

test('every spring settles on its target, at 30, 60 and 120 Hz alike', () => {
  for (const [name, s] of DAMPINGS) {
    const at = (hz) => {
      let value = 0, velocity = 0;
      for (let i = 0; i < hz * 2; i++) ({ value, velocity } = spring(value, velocity, 1, 1000 / hz, s));
      return value;
    };
    assert.ok(Math.abs(at(60) - 1) < 1e-3, `${name} arrives`);
    assert.ok(Math.abs(at(30) - at(120)) < 1e-9, `${name} is the same at any frame rate`);
  }
});

test('a spring at ζ ≥ 1 never passes its target, and never turns back', () => {
  for (const s of [SPRINGS.snap, { zeta: 1.6, wn: 30 }]) {
    let value = 0, velocity = 0, last = 0;
    for (let i = 0; i < 120; i++) {
      ({ value, velocity } = spring(value, velocity, 1, 1000 / 60, s));
      assert.ok(value >= last - 1e-12 && value <= 1 + 1e-12, `ζ ${s.zeta}: ${last} → ${value}`);
      last = value;
    }
  }
});

test('spring lands at once on an infinite step, and stays put at dt 0', () => {
  for (const [, s] of DAMPINGS) {
    assert.deepEqual(spring(0, 3, 1, Infinity, s), { value: 1, velocity: 0 });
    assert.deepEqual(spring(0.4, 3, 1, 0, s), { value: 0.4, velocity: 3 });
  }
});

test('ballistic is spring with the needle’s numbers', () => {
  for (const [x, v, ms] of [[0, 0, 16], [0.3, -2, 33], [1.2, 5, 7]]) {
    assert.deepEqual(ballistic(x, v, 1, ms), spring(x, v, 1, ms, SPRINGS.needle));
  }
  assert.deepEqual(SPRINGS.needle, { zeta: VU_ZETA, wn: VU_WN });
});

test('a key is back up by T.release: the snap spring’s 99%', () => {
  let value = 0, velocity = 0, t = 0;
  while (value < 0.99) { ({ value, velocity } = spring(value, velocity, 1, 1, SPRINGS.snap)); t++; }
  assert.ok(Math.abs(t - T.release) <= 1000 / 60, `99% at ${t} ms`);
});

// ---------- springEasing(): a spring as CSS plays it ----------

test('springEasing is a linear() from 0 to 1, one point a 60 Hz frame, over the spring’s own time', () => {
  for (const name of ['snap', 'lid', 'carry']) {
    const s = SPRINGS[name];
    const { duration, easing } = springEasing(s);
    const points = /^linear\((.*)\)$/.exec(easing)[1].split(', ').map(Number);
    assert.equal(points[0], 0);
    assert.equal(points.at(-1), 1);
    assert.equal(duration, Math.round(((points.length - 1) * 1000) / 60), name);
    // Each point is where the spring is at that frame, to 0.1%.
    let value = 0, velocity = 0;
    for (let i = 1; i < points.length - 1; i++) {
      ({ value, velocity } = spring(value, velocity, 1, 1000 / 60, s));
      assert.ok(Math.abs(points[i] - value) <= 0.0005 + 1e-12, `${name} frame ${i}`);
    }
    // And the end is where it has settled: within 0.1%, and no further to go.
    ({ value, velocity } = spring(value, velocity, 1, 1000 / 60, s));
    assert.ok(Math.abs(1 - value) < EASING_EPS && Math.abs(velocity) / s.wn < EASING_EPS, `${name} ends settled`);
  }
});

test('springEasing overshoots only where the spring does', () => {
  const peak = (name) => Math.max(...springEasing(SPRINGS[name]).easing.slice(7, -1).split(', ').map(Number));
  assert.equal(peak('snap'), 1, 'snap never passes its target');
  assert.ok(peak('lid') > 1 && peak('lid') < 1.01, 'lid: a soft stop, ½% over');
  assert.ok(peak('carry') > 1.02 && peak('carry') < 1.04, 'carry: 3% over as it seats');
});

test('springEasing is worked out once a spring', () => {
  assert.equal(springEasing(SPRINGS.lid), springEasing({ zeta: 0.86, wn: 22 }));
});

// ---------- project(): where a flick comes to rest ----------

test('project carries a flick as far as its speed takes it, and no flick nowhere', () => {
  assert.equal(project(0), 0);
  // 1000 px/s at UIScrollView's normal rate: 1 px a ms, keeping .998 of it each ms.
  assert.ok(Math.abs(project(1000) - 499) < 1e-9);
  assert.ok(Math.abs(project(-1000) + 499) < 1e-9, 'either way');
  assert.ok(project(1000, 0.99) < project(1000), 'a faster stop carries less far');
  assert.equal(project(1000, 1), 0, 'a rate that never stops is not a rate');
  assert.equal(project(NaN), 0);
});

// ---------- the ticker hears less motion turned on ----------

/** fakeMedia is a MediaQueryList whose answer the test changes. */
function fakeMedia(matches) {
  const heard = new Set();
  return {
    matches,
    addEventListener: (type, fn) => { if (type === 'change') heard.add(fn); },
    set(v) { this.matches = v; for (const fn of heard) fn({ matches: v }); },
  };
}

test('less motion turned on with the app open lands the next frame', () => {
  const c = fakeClock();
  const media = fakeMedia(false);
  const ticker = new Ticker({ ...c, media });
  const dts = [];
  ticker.add((dt) => { dts.push(dt); return true; });
  c.advance(16);
  media.set(true);
  c.advance(16);
  media.set(false);
  c.advance(16);
  assert.deepEqual(dts, [16, Infinity, 16]);
});

test('a ticker told its motion keeps it, whatever the device says later', () => {
  const media = fakeMedia(true);
  const ticker = new Ticker({ ...fakeClock(), reduced: false, media });
  media.set(true);
  assert.equal(ticker.reduced, false);
  assert.equal(new Ticker({ ...fakeClock(), media: fakeMedia(true) }).reduced, true, 'and one not told starts where the device is');
});
