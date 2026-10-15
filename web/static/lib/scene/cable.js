// web/static/lib/scene/cable.js
// The cable's model: a rope that hangs between two sockets (the scene
// contract's brief R4, docs/superpowers/specs/2026-10-15-r4-cables-design.md).
//
// State the page sets: what the cable is -- `from`, `to`, `kind`, `pending`,
// `declared`, copied from /api/rig -- and where its two ends are, `a` and
// `b`, in desk pixels: the sockets' holes, or the finger for a plug in the
// hand. `seed` is the points a new cable starts from (the rope that was in
// the hand when it was dropped); without one it starts hanging still. The
// view is the rope: `points`, ROPE_POINTS of {x, y} from a to b, and
// whether it's `moving`.
//
// The rope is verlet integration: each point remembers where it was, so its
// velocity is implicit, gravity pulls it down and a damping takes the swing
// out; then a few passes pull each pair of neighbours back to their length.
// Verlet on its own is tied to the frame rate, so the rope steps at a fixed
// 120 Hz and the view is interpolated between the last two steps: the view
// at a given moment is the same at 20 Hz, at 120 Hz and on ragged frames.
// It parks: once every point has stopped moving the rope stops stepping,
// and step() returns false until the page moves an end.

export const ROPE_POINTS = 16;
/** The rope's fixed step, in ms: 120 Hz, whatever the display does. */
export const STEP_MS = 1000 / 120;
/** Constraint passes a step: enough for a cable, not a chain. */
export const PASSES = 4;
/** Gravity, in px/s²: a cable's weight. Lighter, and a long one down a phone's desk crawls for seconds. */
export const GRAVITY = 3600;
/** The swing's time constant, in ms: how quickly a cable stops swinging. */
export const DAMP_MS = 120;
/** A point moving less than this a step is still; REST_STEPS in a row and the rope stops. */
export const REST_PX = 0.02;
const REST_STEPS = 6;
/** A frame longer than this steps only this much: a tab back from the background. */
export const MAX_FRAME_MS = 100;
// Landing (reduced motion, a cable that has just appeared, and the end of
// every swing): the same steps, damped about critically, until it moves
// less than LAND_PX a step. That is within a few hundredths of a pixel of
// where it would hang for ever. The cap is a guard; a rope lands in a few
// hundred steps.
const LAND_DAMP_MS = 100;
const LAND_PX = 0.005;
const LAND_MAX = 4000;
// A step is taken when the clock has reached it, give or take this much
// floating-point dust, so 60 frames of 1000/60 ms make exactly 120 steps.
const EPS_MS = 1e-7;

/**
 * hang is how far a cable between a and b sags: by how far it reaches
 * across, as P6's drawn cable hung below two sockets side by side (its
 * `sag`, lib/rig/cables.js), never more than a hand's length. A cable
 * dropping from one row to another reaches across little, so it falls
 * nearly straight, as P6's S did, rather than looping below the lower end.
 */
export function hang(a, b) {
  return Math.min(140, 18 + Math.abs(b.x - a.x) * 0.22);
}

/**
 * ropeLength is how long a cable between a and b is. A parabola that sags
 * s over a chord d is about √(d² + 16⁄3·s²) long, which is also right for
 * two ends close together, where it hangs as a loop. A declared cable -- a
 * jack you drew, a label -- is taut.
 */
export function ropeLength(a, b, declared = false) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (declared) return d;
  const s = hang(a, b);
  return Math.sqrt(d * d + (16 / 3) * s * s);
}

const same = (p, q) => !!p && !!q && p.x === q.x && p.y === q.y;
const point = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

export class CableModel {
  constructor({ n = ROPE_POINTS } = {}) {
    this.n = n;
    this.x = null; // where each point is
    this.y = null;
    this.px = null; // where it was a step ago: the velocity, and the interpolation
    this.py = null;
    this.a = null; // the ends as last pinned, and the rope's length for them
    this.b = null;
    this.declared = false;
    this.seg = 0;
    this.acc = 0; // ms the clock is ahead of the last step
    this.still = 0; // steps in a row with nothing moving
    this.resting = false;
    this.view = Object.freeze({ points: Object.freeze([]), moving: false });
  }

  /**
   * step moves the rope `dt` ms on toward rest between the state's ends.
   * True while it still moves; false once it's still.
   */
  step(state, dt) {
    const { a, b } = state;
    if (!point(a) || !point(b)) {
      if (this.view.points.length) this.view = Object.freeze({ points: Object.freeze([]), moving: false });
      this.x = null;
      return false;
    }
    const declared = !!state.declared;
    if (!this.x) {
      this.start(a, b, declared, state.seed);
    } else if (!same(a, this.a) || !same(b, this.b) || declared !== this.declared) {
      this.pin(a, b, declared);
    }
    if (this.resting) return false;
    if (declared) return this.straight();
    if (!(dt < Infinity)) {
      // Reduced motion: the ticker's dt = Infinity lands the rope at once.
      this.land();
      return false;
    }
    this.acc += Math.min(Math.max(0, dt || 0), MAX_FRAME_MS);
    const keep = Math.exp(-STEP_MS / DAMP_MS);
    while (this.acc >= STEP_MS - EPS_MS) {
      this.acc -= STEP_MS;
      if (this.substep(keep) < REST_PX) this.still++;
      else this.still = 0;
      if (this.still >= REST_STEPS) {
        // Nearly still: land it the rest of the way, so it stops exactly
        // where reduced motion would have put it (a fraction of a pixel).
        this.land();
        return false;
      }
    }
    this.show(Math.min(1, Math.max(0, this.acc / STEP_MS)), true);
    return true;
  }

  // start lays a new rope out: from its seed, moving on from there, or
  // hanging still, as a cable that was already plugged in.
  start(a, b, declared, seed) {
    const n = this.n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pin(a, b, declared);
    if (!declared && Array.isArray(seed) && seed.length === n && seed.every(point)) {
      for (let i = 0; i < n; i++) {
        this.x[i] = this.px[i] = seed[i].x;
        this.y[i] = this.py[i] = seed[i].y;
      }
      this.fix();
      this.show(0, true);
      return;
    }
    // A parabola of the cable's sag: close to where it hangs, so landing
    // it is quick.
    const s = declared ? 0 : hang(a, b);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.x[i] = this.px[i] = a.x + (b.x - a.x) * t;
      this.y[i] = this.py[i] = a.y + (b.y - a.y) * t + 4 * s * t * (1 - t);
    }
    if (declared) this.straight();
    else this.land();
  }

  // pin takes new ends: the rope's length follows them, and it moves again.
  pin(a, b, declared) {
    this.a = { x: a.x, y: a.y };
    this.b = { x: b.x, y: b.y };
    this.declared = declared;
    this.seg = ropeLength(a, b, declared) / (this.n - 1);
    this.resting = false;
    this.still = 0;
  }

  // fix puts the two ends where the page says they are.
  fix() {
    const m = this.n - 1;
    this.x[0] = this.a.x; this.y[0] = this.a.y;
    this.x[m] = this.b.x; this.y[m] = this.b.y;
  }

  /** substep is one fixed step: gravity, damping, the passes. It answers the most any point moved. */
  substep(keep) {
    const { x, y, px, py, n } = this;
    const h = STEP_MS / 1000;
    const g = GRAVITY * h * h;
    px[0] = x[0]; py[0] = y[0];
    px[n - 1] = x[n - 1]; py[n - 1] = y[n - 1];
    for (let i = 1; i < n - 1; i++) {
      const vx = (x[i] - px[i]) * keep;
      const vy = (y[i] - py[i]) * keep;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx;
      y[i] += vy + g;
    }
    this.fix();
    for (let p = 0; p < PASSES; p++) {
      if (p % 2 === 0) for (let j = 0; j < n - 1; j++) this.link(j);
      else for (let j = n - 2; j >= 0; j--) this.link(j);
    }
    let most = 0;
    for (let i = 1; i < n - 1; i++) {
      const m = Math.abs(x[i] - px[i]) + Math.abs(y[i] - py[i]);
      if (m > most) most = m;
    }
    return most;
  }

  // link pulls points j and j+1 back to the rope's segment length. A pinned
  // end doesn't move; its neighbour takes the whole correction.
  link(j) {
    const { x, y, n } = this;
    const k = j + 1;
    const dx = x[k] - x[j], dy = y[k] - y[j];
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) return;
    const wj = j === 0 ? 0 : 1, wk = k === n - 1 ? 0 : 1;
    const w = wj + wk;
    if (!w) return;
    const f = (d - this.seg) / d / w;
    x[j] += dx * f * wj; y[j] += dy * f * wj;
    x[k] -= dx * f * wk; y[k] -= dy * f * wk;
  }

  // land steps the rope, damped hard, until it's still: where it would
  // come to rest, at once.
  land() {
    const keep = Math.exp(-STEP_MS / LAND_DAMP_MS);
    this.still = 0;
    for (let i = 0; i < LAND_MAX; i++) {
      if (this.substep(keep) < LAND_PX) this.still++;
      else this.still = 0;
      if (this.still >= REST_STEPS) break;
    }
    this.rest();
  }

  // rest stops the rope where it is.
  rest() {
    this.px.set(this.x);
    this.py.set(this.y);
    this.acc = 0;
    this.still = 0;
    this.resting = true;
    this.show(1, false);
  }

  // straight is a declared cable: a taut line from its tag to its socket.
  straight() {
    const { n } = this;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.x[i] = this.a.x + (this.b.x - this.a.x) * t;
      this.y[i] = this.a.y + (this.b.y - this.a.y) * t;
    }
    this.rest();
    return false;
  }

  // show derives the view: `alpha` of the way from the last step to this
  // one, with the ends exactly where the page put them.
  show(alpha, moving) {
    const { x, y, px, py, n } = this;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      pts[i] = Object.freeze({ x: px[i] + (x[i] - px[i]) * alpha, y: py[i] + (y[i] - py[i]) * alpha });
    }
    pts[0] = Object.freeze({ x: this.a.x, y: this.a.y });
    pts[n - 1] = Object.freeze({ x: this.b.x, y: this.b.y });
    this.view = Object.freeze({ points: Object.freeze(pts), moving });
  }
}
