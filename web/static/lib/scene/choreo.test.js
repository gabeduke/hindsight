import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRAMES, HOLD, SEAT_AT, SEATED, EJECT_MS, BACK_RATE, LIFT_PX, PULL_SCALE, TILT_DEG, SEAT_FROM,
  T_TOUCH, T_MOVE, T_FLIGHT, EASES, bezier, easeSeat, frameAt, phaseAt,
} from './choreo.js';

// A spine on the right of a laptop's room, the deck's window to its left
// and a little above: the doorway at 1440 × 900.
const from = { x: 1000, y: 330, w: 30, h: 112 };
const to = { x: 400, y: 390, w: 180, h: 90 };
const at = (t, turn = true) => frameAt(t, { from, to, turn });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the frames are the Choreography board’s', () => {
  assert.deepEqual(FRAMES.map((f) => [f.name, f.at, f.for]), [
    ['pick', 0, 120], ['pull', 120, 180], ['turn', 300, 200], ['fly', 500, 420], ['seat', 920, 160], ['spin', 1080, 450],
  ]);
  // Each starts where the last ends.
  for (let i = 1; i < FRAMES.length; i++) assert.equal(FRAMES[i].at, FRAMES[i - 1].at + FRAMES[i - 1].for);
  assert.equal(HOLD, 300);
  assert.equal(SEAT_AT, 920);
  assert.equal(SEATED, 1080);
  assert.ok(near(SEATED / BACK_RATE, EJECT_MS), 'the way back takes 700 ms');
  // The board's own numbers, said out loud rather than read back from the module.
  assert.equal(LIFT_PX, 6, 'PICK lifts it 6 px');
  assert.equal(PULL_SCALE, 1.12, 'PULL: 1 → 1.12');
  assert.equal(EJECT_MS, 700);
  assert.equal(phaseAt(0), 'shelf');
  assert.equal(phaseAt(60), 'pick');
  assert.equal(phaseAt(300), 'turn');
  assert.equal(phaseAt(919), 'fly');
  assert.equal(phaseAt(920), 'seat');
  assert.equal(phaseAt(1080), 'seated');
});

test('bezier agrees with CSS at its ends and its middle', () => {
  const linear = bezier(0, 0, 1, 1);
  for (const x of [0, 0.25, 0.5, 0.75, 1]) assert.ok(near(linear(x), x, 1e-6));
  const ease = bezier(0.25, 0.1, 0.25, 1); // CSS `ease`: 0.5 → 0.8024
  assert.ok(near(ease(0.5), 0.8024, 1e-3), String(ease(0.5)));
  // The seat curve overshoots, and comes back.
  let peak = 0;
  for (let i = 0; i <= 100; i++) peak = Math.max(peak, easeSeat(i / 100));
  assert.ok(peak > 1.05 && peak < 1.15, `seat peaks at ${peak}`);
  assert.equal(easeSeat(1), 1);
});

test('at rest it is where it stands; PICK lifts it 6 px; PULL brings it out to 1.12', () => {
  const r = at(0);
  assert.equal(r.x, from.x + from.w / 2);
  assert.equal(r.y, from.y + from.h / 2);
  assert.equal(r.spine.s, 1);
  assert.equal(r.spine.o, 1);
  assert.equal(r.face.o, 0);
  const picked = at(120);
  assert.ok(near(picked.lift, LIFT_PX));
  assert.ok(near(picked.y, from.y + from.h / 2 - LIFT_PX));
  assert.equal(picked.spine.s, 1, 'PICK lifts; it doesn’t grow');
  assert.ok(picked.shadow.o > r.shadow.o, 'its shadow deepens');
  const pulled = at(HOLD);
  assert.ok(near(pulled.spine.s, PULL_SCALE));
  assert.ok(near(pulled.lift, LIFT_PX));
  assert.equal(pulled.spine.ry, 0, 'still spine out');
  assert.ok(pulled.shadow.o > picked.shadow.o);
});

test('TURN shows the face: the spine goes edge-on, then the face comes round', () => {
  const half = at(300 + 60);
  assert.ok(half.spine.ry > 0 && half.spine.ry < 90 && half.spine.o === 1 && half.face.o === 0);
  const late = at(300 + 150);
  assert.equal(late.spine.o, 0);
  assert.equal(late.face.o, 1);
  assert.ok(late.face.ry > -90 && late.face.ry < 0);
  const done = at(500);
  assert.ok(near(done.face.ry, 0));
  // The face's long edge is the pulled spine's.
  assert.ok(near(done.face.s * to.w, from.h * PULL_SCALE));
  // A face already out (a phone's shelf) cross-fades instead of turning.
  const flat = frameAt(400, { from, to, turn: false });
  assert.equal(flat.face.ry, 0);
  assert.ok(flat.spine.o > 0 && flat.spine.o < 1 && near(flat.spine.o + flat.face.o, 1));
});

test('FLY is an arc to the window, shrinking to fit, tilted into the turn', () => {
  const start = at(500), end = at(SEAT_AT);
  const wx = to.x + to.w / 2, wy = to.y + to.h / 2;
  assert.ok(near(end.x, wx) && near(end.y, wy), 'it reaches the window');
  assert.ok(near(end.face.s, SEAT_FROM), 'just bigger than the window, to settle in');
  // Above the straight line half way: thrown, not slid.
  const mid = at(500 + 210);
  const k = (mid.x - start.x) / (wx - start.x);
  const straightY = start.y + (wy - start.y) * k;
  assert.ok(mid.y < straightY - 30, `the arc rises (${mid.y.toFixed(1)} vs ${straightY.toFixed(1)})`);
  // Tilted most in the air, none at either end; going left, it leans right.
  assert.equal(start.tilt === 0 || Object.is(start.tilt, -0), true);
  assert.ok(Math.abs(end.tilt) < 1e-9);
  assert.ok(mid.tilt > 0 && mid.tilt <= TILT_DEG);
  const rightward = frameAt(710, { from: to, to: from, turn: true });
  assert.ok(rightward.tilt < 0);
});

test('up a phone’s page the arc bows to the side, and never rises past the deck', () => {
  // A cassette on a shelf row below the deck card, the deck's window above.
  const shelf = { x: 20, y: 470, w: 112, h: 70 }, win = { x: 34, y: 100, w: 124, h: 60 };
  const ys = [], xs = [];
  for (let t = 500; t <= SEAT_AT; t += 10) {
    const f = frameAt(t, { from: shelf, to: win, turn: false });
    ys.push(f.y); xs.push(f.x);
  }
  assert.ok(Math.min(...ys) >= win.y + win.h / 2 - 1e-9, 'not above the window');
  const straight = (shelf.x + shelf.w / 2 + win.x + win.w / 2) / 2;
  assert.ok(Math.max(...xs.map((x) => Math.abs(x - straight))) > 40, 'but out to the side');
});

test('the arc keeps the cassette on the page: on a narrow phone it does not bow off the left edge', () => {
  const shelf = { x: 20, y: 470, w: 112, h: 70 }, win = { x: 34, y: 100, w: 124, h: 60 };
  const left = (room) => {
    let m = Infinity;
    for (let t = 500; t <= SEAT_AT; t += 10) m = Math.min(m, frameAt(t, { from: shelf, to: win, turn: false, room }).x - win.w / 2);
    return m;
  };
  assert.ok(left(0) < -10, `the unbounded arc runs off the page (${left(0).toFixed(1)})`);
  assert.ok(left(390) >= -1e-9, `bounded, the face stays on the page (${left(390).toFixed(1)})`);
});

test('SEAT settles it into the window, and after it the face is exactly the window', () => {
  const s = at(SEAT_AT + 80);
  assert.ok(s.face.s < SEAT_FROM && s.face.s > 1);
  const seated = at(SEATED);
  assert.equal(seated.face.s, 1);
  assert.equal(seated.x, to.x + to.w / 2);
  assert.equal(seated.y, to.y + to.h / 2);
  assert.equal(seated.shadow.o, 0);
  assert.equal(seated.phase, 'seated');
});

// The motion tokens live in styles.css (Rooms R2): not materials, so not in
// objects.css, and the same in both schemes, so not in the dark block. The
// timeline above uses the same numbers, and this keeps the two in step.
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const objects = readFileSync(new URL('../../objects.css', import.meta.url), 'utf8');
const TOKENS = ['--t-touch', '--t-move', '--t-flight', '--ease-out', '--ease-flight', '--ease-seat'];
const value = (name) => {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m && m[1].trim();
};

test('the motion tokens in styles.css are the timeline’s', () => {
  assert.equal(value('--t-touch'), `${T_TOUCH}ms`);
  assert.equal(value('--t-move'), `${T_MOVE}ms`);
  assert.equal(value('--t-flight'), `${T_FLIGHT}ms`);
  const pts = (v) => v.match(/cubic-bezier\(([^)]+)\)/)[1].split(',').map(Number);
  assert.deepEqual(pts(value('--ease-out')), [...EASES.out]);
  assert.deepEqual(pts(value('--ease-flight')), [...EASES.flight]);
  assert.deepEqual(pts(value('--ease-seat')), [...EASES.seat]);
  assert.equal(FRAMES[0].for, T_TOUCH);
  assert.equal(FRAMES[2].for, T_MOVE);
  assert.equal(FRAMES[3].for, T_FLIGHT);
});

test('the motion tokens follow no scheme and are no material', () => {
  for (const t of TOKENS) {
    assert.equal([...css.matchAll(new RegExp(`${t}\\s*:`, 'g'))].length, 1, `${t} is declared once in styles.css`);
    assert.ok(!objects.includes(`${t}:`), `${t} is not a material`);
  }
  const dark = css.indexOf('@media (prefers-color-scheme: dark)');
  let depth = 0, end = dark;
  for (let i = dark; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = css.slice(dark, end);
  for (const t of TOKENS) assert.ok(!body.includes(`${t}:`), `${t} has no dark value`);
});
