// web/static/lib/scene/choreo.js
// The Choreography board's first move, off the shelf and into the deck, as
// numbers (docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md).
//
//   PICK     0  120 ms  it lifts 6 px; its shadow deepens
//   PULL   120  180 ms  it slides out toward you, 1 → 1.12
//   TURN   300  200 ms  spine to face, rotateY 90° → 0
//   FLY    500  420 ms  an arc to the deck's window, shrinking to fit, tilted into the turn
//   SEAT   920  160 ms  the door shuts (the room's flight ends here; the sound started at the tap)
//   SPIN  1080  450 ms  the reels catch up with the sound (the deck's model)
//
// Eject is the same, backwards, in about 700 ms.
//
// frameAt() is pure: a time on that timeline, where the thing came from and
// where it's going, in, and the drawing out. The flight model (flight.js)
// moves a playhead along it; the room's ghost (lib/room/ghost.js) draws what it says. The
// motion tokens in styles.css carry the same numbers, and a test keeps the
// two in step.

/** The motion tokens (styles.css, Rooms R2): ms, and the eases' control points. */
export const T_TOUCH = 120;  // --t-touch: the answer to a finger
export const T_MOVE = 200;   // --t-move: slides and turns
export const T_FLIGHT = 420; // --t-flight: between places
export const EASES = Object.freeze({
  out: Object.freeze([0.2, 0.8, 0.2, 1]),       // --ease-out
  flight: Object.freeze([0.3, 0, 0.2, 1]),      // --ease-flight
  seat: Object.freeze([0.34, 1.56, 0.64, 1]),   // --ease-seat: the overshoot
});

/** The frames, in order: name, start and length in ms. */
export const FRAMES = Object.freeze([
  Object.freeze({ name: 'pick', at: 0, for: T_TOUCH }),
  Object.freeze({ name: 'pull', at: 120, for: 180 }),
  Object.freeze({ name: 'turn', at: 300, for: T_MOVE }),
  Object.freeze({ name: 'fly', at: 500, for: T_FLIGHT }),
  Object.freeze({ name: 'seat', at: 920, for: 160 }),
  Object.freeze({ name: 'spin', at: 1080, for: 450 }),
]);
const at = (name) => FRAMES.find((f) => f.name === name);

/** HOLD: pulled out, where the timeline waits while the card is open. */
export const HOLD = at('turn').at;
/** SEAT_AT: the door shuts, and the sound starts. */
export const SEAT_AT = at('seat').at;
/** SEATED: in the deck. The flight ends here; SPIN UP is the deck's. */
export const SEATED = at('spin').at;
/** EJECT_MS: the whole way back; BACK_RATE is how much faster than going in. */
export const EJECT_MS = 700;
export const BACK_RATE = SEATED / EJECT_MS;

export const LIFT_PX = 6;
export const PULL_SCALE = 1.12;
export const TILT_DEG = 8;
/** The face arrives this much bigger than the window, and settles into it on SEAT. */
export const SEAT_FROM = 1.04;
/** How long a thing without a face in the deck takes to dissolve into it. */
export const VANISH_MS = 120;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, k) => a + (b - a) * k;

/**
 * bezier is CSS's cubic-bezier(x1, y1, x2, y2) as a function of progress:
 * x is solved for by Newton's method, falling back to bisection where the
 * slope is flat, so it agrees with the browser to well under a pixel.
 */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-7) return Y(t);
      const d = dX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = X(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return Y(t);
  };
}

export const easeOut = bezier(...EASES.out);
export const easeFlight = bezier(...EASES.flight);
export const easeSeat = bezier(...EASES.seat);

/** phaseAt names the frame a time is in: 'shelf' before PICK, 'seated' after SEAT. */
export function phaseAt(t) {
  if (t <= 0) return 'shelf';
  if (t >= SEATED) return 'seated';
  for (let i = FRAMES.length - 1; i >= 0; i--) if (t >= FRAMES[i].at) return FRAMES[i].name;
  return 'shelf';
}

/** progress is how far through frame `name` time `t` is, 0 to 1. */
export function progress(t, name) {
  const f = at(name);
  return clamp01((t - f.at) / f.for);
}

const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/**
 * frameAt is the drawing at time `t` (ms on the timeline) of a thing that
 * stood in `from` (its slot: {x, y, w, h}, viewport px) going to `to` (the
 * deck's window, the same). `room`, when given, is the page's width, which
 * the arc stays inside. `turn` says the thing stands spine out and turns
 * to show its face; without it (a face already out, as on a phone's shelf)
 * the spine cross-fades into the face instead.
 *
 * It answers the centre (x, y), the lift, the tilt, and two planes: the
 * spine, drawn at the slot's size, and the face, drawn at the window's size,
 * each with its scale (s), its turn about the vertical (ry, degrees) and
 * its opacity (o); and the shadow under it: its opacity (o) and how far
 * below it falls (dy, px).
 */
export function frameAt(t, { from, to, turn = true, vanish = false, room = 0 }) {
  const f = centre(from);
  const w = to ? centre(to) : f;
  const toW = to ? to.w : Math.max(from.w, from.h);
  // PICK, PULL: up 6 px, then out toward you.
  const kPick = easeOut(progress(t, 'pick'));
  const kPull = easeOut(progress(t, 'pull'));
  const kTurn = easeOut(progress(t, 'turn'));
  const kFly = easeFlight(progress(t, 'fly'));
  const kSeat = easeOut(progress(t, 'seat'));
  const pull = lerp(1, PULL_SCALE, kPull);
  // The face first shows as big as the pulled spine is long: the long edge
  // stays the long edge.
  const faceFrom = (Math.max(from.w, from.h) * PULL_SCALE) / toW;

  let lift = LIFT_PX * kPick;
  let x = f.x, y = f.y - lift, tilt = 0;
  if (t > at('fly').at) {
    // A quadratic arc from the pulled spot to the window, bowed out a third
    // of the way's length (at least 40 px) on the upper side of the straight
    // line, so it reads as thrown rather than slid. Across a room that is
    // upward; up a phone's page it is sideways, so it never rises past where
    // it's going.
    const p0 = { x: f.x, y: f.y - LIFT_PX };
    const dx0 = w.x - p0.x, dy0 = w.y - p0.y;
    const dist = Math.hypot(dx0, dy0) || 1;
    const bow = Math.max(40, dist / 3);
    let nx = -dy0 / dist, ny = dx0 / dist; // a unit normal to the way
    if (ny > 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
    const c = { x: (p0.x + w.x) / 2 + nx * bow, y: (p0.y + w.y) / 2 + ny * bow };
    // `room` is the page's width: a curve lies inside its control points, so
    // keeping the control point half a face (its larger size) from either edge keeps the
    // cassette on the page. (Up a phone's page the bow is sideways.)
    // The face is bigger than the window while it flies (it starts as big as
    // the pulled spine is long), so the margin is the larger of the two.
    const half = Math.max(toW, Math.max(from.w, from.h) * PULL_SCALE) / 2 + 4;
    if (room > 0) c.x = Math.min(Math.max(c.x, half), Math.max(half, room - half));
    const k = kFly;
    x = (1 - k) * (1 - k) * p0.x + 2 * (1 - k) * k * c.x + k * k * w.x;
    y = (1 - k) * (1 - k) * p0.y + 2 * (1 - k) * k * c.y + k * k * w.y;
    // Tilted into the turn, most at the top of the arc, none at either end:
    // the board's FLY leans back from the way it's going.
    const dx = w.x - p0.x;
    tilt = Math.abs(dx) < 8 ? 0 : -Math.sign(dx) * TILT_DEG * Math.sin(Math.PI * k);
    lift = LIFT_PX * (1 - k);
  }

  // The two planes. A spine turns edge-on in the first half of TURN, then
  // the face turns in from edge-on; without a turn they cross-fade.
  const spine = { s: pull, ry: 0, o: 1 };
  const face = { s: faceFrom, ry: turn ? -90 : 0, o: 0 };
  if (turn) {
    // Half the time each: the spine speeds away to edge-on, then the face
    // comes round and eases to a stop facing you.
    const u = progress(t, 'turn');
    const a = clamp01(u * 2), b = clamp01(u * 2 - 1);
    spine.ry = 90 * a * a;
    face.ry = -90 * (1 - easeOut(b));
    spine.o = u < 0.5 ? 1 : 0;
    face.o = u < 0.5 ? 0 : 1;
  } else {
    spine.o = 1 - kTurn;
    face.o = kTurn;
  }
  if (t <= at('turn').at) face.o = 0;
  // FLY shrinks it to just over the window; SEAT settles it in.
  face.s = t < SEAT_AT ? lerp(faceFrom, SEAT_FROM, kFly) : lerp(SEAT_FROM, 1, kSeat);
  if (t >= SEATED) { face.s = 1; x = w.x; y = w.y; }
  // A thing with no face of its own in the deck (a reel box: the deck's
  // reels are its reels) dissolves over FLY's last VANISH_MS.
  if (vanish && t > SEAT_AT - VANISH_MS) face.o = clamp01((SEAT_AT - t) / VANISH_MS);

  // The shadow deepens as it lifts and comes out, follows it through the
  // air further below it, and is gone once it's in the deck.
  const air = t > at('fly').at ? Math.sin(Math.PI * kFly) : 0;
  const shadow = {
    o: t >= SEAT_AT ? 0.35 * (1 - kSeat) : clamp01(0.25 + 0.3 * kPick + 0.25 * kPull + 0.1 * air),
    dy: 2 + 2 * lift + 14 * air,
  };
  return { t, phase: phaseAt(t), x, y, lift, tilt, spine, face, shadow };
}
