import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ticker } from '../objects/motion.js';
import { Scene } from './scene.js';
import { SceneObject } from './object.js';
import { CableModel, ROPE_POINTS, STEP_MS, MAX_FRAME_MS, ropeLength, hang, layout, LINK_PX } from './cable.js';
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

// --- a cable led through waypoints (lib/rig/route.js) ----------------------------
// From a socket across to another's, led round the sockets between: down to a
// channel, along it, and down again. The rope is pinned to each waypoint and
// hangs between them.
const LA = { x: 480, y: 80 };
const LB = { x: 215, y: 222 };
const VIA = [{ x: 480, y: 194 }, { x: 215, y: 194 }];

test('a led rope passes exactly through its waypoints, and has links enough in each span', () => {
  const m = new CableModel();
  m.step({ a: LA, b: LB, via: VIA }, 0);
  const pts = m.view.points;
  for (const w of VIA) assert.ok(pts.some((p) => p.x === w.x && p.y === w.y), `through ${w.x},${w.y}`);
  assert.deepEqual([pts[0].x, pts[0].y, pts.at(-1).x, pts.at(-1).y], [LA.x, LA.y, LB.x, LB.y]);
  // No span is left with fewer than three links: it bends as a rope.
  const lay = layout(LA, LB, VIA, false);
  const spans = [0, ...lay.pins, lay.n - 1];
  for (let i = 0; i + 1 < spans.length; i++) assert.ok(spans[i + 1] - spans[i] >= 3, `span ${i}`);
});

test('a led rope hangs between its waypoints: nearly taut, and under the line it was led along, not through the gear', () => {
  const m = new CableModel();
  m.step({ a: LA, b: LB, via: VIA }, 0);
  const pts = m.view.points;
  // Down the first leg: it stays on it.
  for (const p of pts.filter((q) => q.y < 180 && q.x > 400)) assert.ok(Math.abs(p.x - 480) < 3, `leg one is at x ${p.x}`);
  // Along the channel: it hangs below the line, a little, and never above it.
  const run = pts.filter((q) => q.x < 470 && q.x > 225);
  assert.ok(run.length >= 4);
  for (const p of run) assert.ok(p.y >= 194 - 0.5 && p.y <= 194 + 12, `the run is at y ${p.y.toFixed(1)}`);
  assert.ok(Math.max(...run.map((p) => p.y)) > 194 + 1, 'and it does hang');
  // Without waypoints it ran straight across to the end, through the middle of the row.
  const free = new CableModel();
  free.step({ a: LA, b: LB }, 0);
  const mid = free.view.points.find((p) => p.x < 350);
  assert.ok(mid.y > 194 + 12 || mid.y < 194 - 12 || mid.x > 230, 'as it was drawn, nothing held it to the channel');
});

test('a led rope is the same at 20, 60 and 120 Hz, and on ragged frames, after its waypoints move', () => {
  const state = { a: LA, b: LB, via: VIA };
  const moved = { a: LA, b: LB, via: [{ x: 480, y: 170 }, { x: 215, y: 170 }] };
  const make = () => { const m = new CableModel(); m.step(state, 0); return m; };
  const at = (hz, ms) => { const m = make(); m.step(moved, 0); const n = Math.round(ms * hz / 1000); for (let i = 0; i < n; i++) m.step(moved, 1000 / hz); return m.view.points; };
  const ref = at(120, 600);
  assert.ok(ref.some((p) => p.x === 480 && p.y === 170), 'the rope is pinned to the waypoint it was moved to');
  assert.ok(apart(at(60, 600), ref) < 0.01, '60 Hz');
  assert.ok(apart(at(20, 600), ref) < 0.01, '20 Hz');
  const rag = make();
  rag.step(moved, 0);
  const r = rng(7);
  let t = 0;
  while (t < 600) { const dt = Math.min(600 - t, 5 + r() * 30); rag.step(moved, dt); t += dt; }
  assert.ok(apart(rag.view.points, ref) < 0.5, 'ragged frames, at the same moment, to within a step');
});

test('a led rope settles, parks, and reduced motion lands it where the swing comes to rest', () => {
  const swing = new CableModel();
  swing.step({ a: LA, b: LB, via: VIA }, 0);
  const to = { a: LA, b: LB, via: [{ x: 480, y: 170 }, { x: 215, y: 170 }] };
  let parked = -1;
  for (let i = 0; i < 400; i++) {
    if (!swing.step(to, 16)) { parked = i; break; }
  }
  assert.ok(parked > 0 && parked * 16 < 3000, `parked after ${parked * 16} ms`);
  const land = new CableModel();
  land.step({ a: LA, b: LB, via: VIA }, 0);
  assert.equal(land.step(to, Infinity), false);
  assert.ok(apart(land.view.points, swing.view.points) < 0.2, 'within 0.2 px');
});

test('moving a waypoint moves the rope, from where it was; the same waypoints are left alone', () => {
  const m = new CableModel();
  m.step({ a: LA, b: LB, via: VIA }, 0);
  const before = m.view.points;
  assert.equal(m.step({ a: LA, b: LB, via: VIA.map((p) => ({ ...p })) }, 16), false, 'the same waypoints, still');
  // Led through a longer way: a rope with more points, carrying on from the one it was.
  const longer = [...VIA.slice(0, 1), { x: 350, y: 194 }, { x: 350, y: 160 }, { x: 215, y: 160 }];
  assert.equal(m.step({ a: LA, b: LB, via: longer }, 16), true, 'moves');
  assert.notEqual(m.view.points.length, before.length, 'cut into other points');
  // Taken back to no waypoints it is the plain rope again.
  m.step({ a: LA, b: LB }, Infinity);
  assert.equal(m.view.points.length, ROPE_POINTS);
});

test('a dropped led cable starts from the rope that was in the hand, taken onto its own points', () => {
  const seed = Array.from({ length: ROPE_POINTS }, (_, i) => ({ x: LA.x + (LB.x - LA.x) * (i / (ROPE_POINTS - 1)), y: LA.y + (LB.y - LA.y) * (i / (ROPE_POINTS - 1)) }));
  const m = new CableModel();
  assert.equal(m.step({ a: LA, b: LB, via: VIA, seed }, 0), true, 'moving on from it');
  const pts = m.view.points;
  assert.notEqual(pts.length, seed.length, 'a rope of its own points, not the seed’s');
  // The first frame is the rope in the hand, not the settled shape.
  assert.ok(Math.abs(pts[Math.floor(pts.length / 2)].y - (LA.y + LB.y) / 2) < 12);
  for (let i = 0; i < 300 && m.step({ a: LA, b: LB, via: VIA, seed }, 16); i++);
  assert.equal(m.step({ a: LA, b: LB, via: VIA, seed }, 16), false, 'and it comes to rest');
});

test('a declared cable is not led: it is taut from its tag whatever it is told', () => {
  const m = new CableModel();
  m.step({ a: LA, b: LB, declared: true, via: VIA }, 0);
  assert.equal(m.view.points.length, ROPE_POINTS);
  for (const p of m.view.points) assert.ok(Math.abs((p.x - LA.x) * (LB.y - LA.y) - (p.y - LA.y) * (LB.x - LA.x)) < 1e-6);
});

test('the links of a led rope are about LINK_PX, and sum to the length of its spans', () => {
  const lay = layout(LA, LB, VIA, false);
  const chords = [114, 265, 28];
  assert.ok(Math.abs(lay.seg.reduce((t, v) => t + v, 0) - chords.reduce((t, v) => t + v, 0)) < 3);
  for (const v of lay.seg) assert.ok(v <= LINK_PX * 1.6 && v >= 3, `link ${v.toFixed(1)}`);
});
