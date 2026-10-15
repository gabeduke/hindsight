import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../objects/motion.js';
import { Scene } from './scene.js';
import { SceneObject } from './object.js';
import { CableModel, ROPE_POINTS, STEP_MS, MAX_FRAME_MS, ropeLength, hang } from './cable.js';
import { sag as p6sag } from '../rig/cables.js';

// A fake ticker: frames run when the test says, `ms` apart.
function fakeTicker({ reduced = false } = {}) {
  let t = 0;
  const queue = [];
  const ticker = new Ticker({ now: () => t, raf: (fn) => queue.push(fn), cancel: () => { queue.length = 0; }, reduced });
  ticker.advance = (ms = 16) => { t += ms; for (const fn of queue.splice(0)) fn(t); };
  return ticker;
}

const A = { x: 40, y: 60 };
const B = { x: 260, y: 80 };
const B2 = { x: 380, y: 10 }; // where the plug is moved to

/** apart is the furthest any point of one rope is from the same point of another. */
const apart = (p, q) => {
  assert.equal(p.length, q.length);
  return Math.max(...p.map((v, i) => Math.hypot(v.x - q[i].x, v.y - q[i].y)));
};

/** hanging is a rope at rest between A and B, about to be moved. */
function hanging(a = A, b = B) {
  const m = new CableModel();
  assert.equal(m.step({ a, b }, 0), false, 'a cable that appears is already still');
  return m;
}

/** run steps a model through frames of `dts`, answering the view after each. */
function run(m, state, dts) {
  const views = [];
  for (const dt of dts) {
    m.step(state, dt);
    views.push(m.view.points);
  }
  return views;
}

// A small seeded PRNG, so a failure can be run again.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('a cable hangs as deep as P6 drew it, a drop falls nearly straight, and a declared one is taut', () => {
  // Side by side, it sags as P6's cable hung below the two sockets.
  for (const dx of [40, 120, 300, 900]) {
    assert.equal(hang({ x: 0, y: 50 }, { x: dx, y: 50 }), p6sag({ x: 0, y: 50 }, { x: dx, y: 50 }), `${dx} px apart`);
  }
  const d = Math.hypot(B.x - A.x, B.y - A.y);
  const s = hang(A, B);
  assert.ok(Math.abs(ropeLength(A, B) - Math.sqrt(d * d + (16 / 3) * s * s)) < 1e-9);
  assert.ok(ropeLength(A, B) > d, 'slack, so it sags');
  // Down a phone's desk, from the interface to the bay: little slack, so it
  // doesn't loop out past the desk's edge below.
  const top = { x: 58, y: 150 }, bottom = { x: 52, y: 850 };
  assert.ok(ropeLength(top, bottom) < 700 * 1.01);
  assert.equal(ropeLength(A, B, true), d, 'a jack you drew is a label: no slack');
  assert.ok(ropeLength(A, A) > 30, 'two ends together hang as a loop');
});

test('a cable that appears hangs still, from socket to socket, below its ends', () => {
  const m = hanging();
  const p = m.view.points;
  assert.equal(p.length, ROPE_POINTS);
  assert.deepEqual(p[0], A);
  assert.deepEqual(p.at(-1), B);
  assert.equal(m.view.moving, false);
  const mid = p[ROPE_POINTS >> 1];
  assert.ok(mid.y > (A.y + B.y) / 2 + 20, `it sags: the middle is at ${mid.y.toFixed(1)}`);
  // Its points are spaced along a rope about as long as it should be.
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  assert.ok(Math.abs(len - ropeLength(A, B)) / ropeLength(A, B) < 0.04, `length ${len.toFixed(1)} against ${ropeLength(A, B).toFixed(1)}`);
});

test('the same moment looks the same at 20, 30, 60 and 120 Hz', () => {
  const rates = [20, 30, 60, 120];
  // Every 100 ms is a frame boundary at all four rates.
  const at = {};
  for (const hz of rates) {
    const m = hanging();
    const frames = Math.round(1.5 * hz);
    const views = run(m, { a: A, b: B2 }, Array(frames).fill(1000 / hz));
    at[hz] = Array.from({ length: 15 }, (_, k) => views[Math.round(((k + 1) * hz) / 10) - 1]);
  }
  let worst = 0;
  for (const hz of rates) for (let k = 0; k < 15; k++) worst = Math.max(worst, apart(at[hz][k], at[120][k]));
  assert.ok(worst < 0.01, `the rates differ by ${worst} px`);
  // And it did move: this isn't four still ropes agreeing.
  assert.ok(apart(at[120][0], at[120][14]) > 5);
});

test('ragged frames show the same rope as smooth ones, at every frame', () => {
  for (const seed of [1, 7, 42]) {
    const r = rng(seed);
    const dts = Array.from({ length: 120 }, () => 3 + r() * 45);
    const ragged = run(hanging(), { a: A, b: B2 }, dts);
    // The same span of time in frames of 5 ms or less, ending where each
    // ragged frame ends.
    const smooth = hanging();
    let worst = 0;
    dts.forEach((dt, i) => {
      const k = Math.ceil(dt / 5);
      for (let j = 0; j < k; j++) smooth.step({ a: A, b: B2 }, dt / k);
      worst = Math.max(worst, apart(ragged[i], smooth.view.points));
    });
    assert.ok(worst < 0.01, `seed ${seed}: ${worst} px apart`);
  }
});

test('on a 144 Hz screen, faster than the rope steps, a moving rope still moves every frame', () => {
  const m = hanging();
  let last = m.view.points;
  let frames = 0;
  while (m.step({ a: A, b: B2 }, 1000 / 144) && frames < 600) {
    frames++;
    assert.ok(apart(m.view.points, last) > 0, `frame ${frames} showed the frame before again`);
    last = m.view.points;
  }
  assert.ok(frames > 50);
});

test('the ends are always exactly where the page put them, even between steps', () => {
  const m = hanging();
  const end = { x: 300, y: 20 };
  for (const dt of [3, 5, 7, 11]) {
    end.x += 9;
    m.step({ a: A, b: { ...end } }, dt);
    assert.deepEqual(m.view.points[0], A);
    assert.deepEqual(m.view.points.at(-1), end);
  }
});

test('a swing settles, and parks within two and a half seconds; then it asks for nothing', () => {
  const m = hanging();
  let frames = 0;
  const state = { a: A, b: B2 };
  while (m.step(state, 1000 / 60)) {
    frames++;
    assert.ok(frames < 150, 'still swinging after two and a half seconds');
    assert.equal(m.view.moving, true);
  }
  assert.ok(frames > 20, `it swung for ${frames} frames`);
  assert.equal(m.view.moving, false);
  const still = m.view;
  assert.equal(m.step(state, 16), false, 'a still rope stays still');
  assert.equal(m.view, still, 'and derives no new view, so nothing redraws');
  assert.equal(m.step({ a: { ...A }, b: { ...B2 } }, 16), false, 'the same ends, set again, move nothing');
  assert.equal(m.view, still);
});

test('reduced motion (dt = Infinity) lands it where the swing would have come to rest', () => {
  const swung = hanging();
  while (swung.step({ a: A, b: B2 }, 1000 / 60));
  const landed = hanging();
  assert.equal(landed.step({ a: A, b: B2 }, Infinity), false, 'at once');
  assert.equal(landed.view.moving, false);
  const d = apart(landed.view.points, swung.view.points);
  assert.ok(d < 0.2, `${d} px from the settled rope`);
  // And a cable that appears is the same rope again.
  const fresh = hanging(A, B2);
  assert.ok(apart(fresh.view.points, swung.view.points) < 0.2);
});

test('a frame longer than 100 ms steps only 100 ms: a tab back from the background', () => {
  const long = hanging();
  long.step({ a: A, b: B2 }, 10_000);
  const capped = hanging();
  capped.step({ a: A, b: B2 }, MAX_FRAME_MS);
  assert.ok(apart(long.view.points, capped.view.points) < 1e-9);
  assert.equal(long.view.moving, true, 'and it carries on swinging from there');
});

test('a dropped cable starts from the rope that was in the hand, and moves on', () => {
  const seed = Array.from({ length: ROPE_POINTS }, (_, i) => ({ x: A.x + (B.x - A.x) * (i / (ROPE_POINTS - 1)), y: A.y + (B.y - A.y) * (i / (ROPE_POINTS - 1)) }));
  const m = new CableModel();
  assert.equal(m.step({ a: A, b: B, seed }, 0), true, 'still moving');
  assert.ok(apart(m.view.points, seed) < 1e-9, 'from the seed');
  m.step({ a: A, b: B, seed }, STEP_MS * 3);
  assert.ok(m.view.points[ROPE_POINTS >> 1].y > seed[ROPE_POINTS >> 1].y, 'and falls from there');
  // A seed of the wrong length is ignored: it starts at rest.
  const n = new CableModel();
  assert.equal(n.step({ a: A, b: B, seed: seed.slice(3) }, 0), false);
});

test('a declared cable, a jack you drew, is a straight line and never swings', () => {
  const m = new CableModel();
  assert.equal(m.step({ a: A, b: B, declared: true }, 0), false);
  for (const p of m.view.points) {
    const t = (p.x - A.x) / (B.x - A.x);
    assert.ok(Math.abs(p.y - (A.y + (B.y - A.y) * t)) < 1e-9);
  }
  assert.equal(m.step({ a: A, b: B2, declared: true }, 16), false);
  assert.deepEqual(m.view.points.at(-1), B2);
});

test('a cable with an end nowhere draws nothing', () => {
  const m = new CableModel();
  assert.equal(m.step({ a: A, b: null }, 16), false);
  assert.deepEqual(m.view.points, []);
});

test('twelve ropes swinging at once settle, and the ticker parks', () => {
  const ticker = fakeTicker();
  const scene = new Scene({ ticker });
  const ropes = [];
  for (let i = 0; i < 12; i++) {
    const a = { x: 30 + i * 40, y: 50 + (i % 3) * 70 };
    const b = { x: 120 + i * 35, y: 300 - (i % 4) * 50 };
    ropes.push(scene.add(new SceneObject(`cable:${i}`, 'cable', { kind: 'patch', a, b })));
  }
  scene.start();
  let frames = 0;
  while (ticker.running && frames < 1000) { ticker.advance(1000 / 60); frames++; }
  assert.ok(!ticker.running);
  assert.ok(frames <= 2, `appearing moved nothing (${frames} frames)`);
  // Every plug moved at once: the desk was laid out again.
  ropes.forEach((o, i) => o.set({ b: { x: o.state.b.x + 60 - i * 9, y: o.state.b.y - 40 } }));
  assert.ok(ticker.running);
  frames = 0;
  let moving = 0;
  while (ticker.running && frames < 1000) {
    ticker.advance(1000 / 60);
    frames++;
    if (ropes.some((o) => o.view.moving)) moving = frames;
  }
  assert.ok(!ticker.running, 'parked');
  assert.ok(frames < 150 && moving > 20, `swung for ${moving} frames, parked after ${frames}`);
  const views = ropes.map((o) => o.view);
  ticker.advance(1000 / 60);
  assert.ok(!ticker.running, 'and stays parked');
  assert.deepEqual(ropes.map((o) => o.view), views);
});

test('with reduced motion, twelve moved ropes land in one frame', () => {
  const ticker = fakeTicker({ reduced: true });
  const scene = new Scene({ ticker });
  const ropes = Array.from({ length: 12 }, (_, i) => scene.add(new SceneObject(`cable:${i}`, 'cable', { a: { x: i * 30, y: 0 }, b: { x: i * 30 + 100, y: 40 } })));
  scene.start();
  ticker.advance(16);
  ropes.forEach((o) => o.set({ b: { x: o.state.b.x + 80, y: 0 } }));
  ticker.advance(16);
  assert.ok(ropes.every((o) => !o.view.moving));
  ticker.advance(16);
  assert.ok(!ticker.running);
});
