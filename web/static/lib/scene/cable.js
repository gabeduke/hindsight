// web/static/lib/scene/cable.js
// The cable's model: a rope that hangs between two sockets (the scene
// contract's brief R4, docs/superpowers/specs/2026-10-15-r4-cables-design.md).
//
// State the page sets: what the cable is -- `from`, `to`, `kind`, `pending`,
// `declared`, copied from /api/rig -- and where its two ends are, `a` and
// `b`, in desk pixels: the sockets' holes, or the finger for a plug in the
// hand. `seed` is the points a new cable starts from (the rope that was in
// the hand when it was dropped); without one it starts hanging still. `via`
// is where the page has led the cable across the desk, to keep it off the
// sockets and their names (lib/rig/route.js): waypoints the rope is pinned
// to, so it hangs between them, not across the gear. The view is the rope: `points`, ROPE_POINTS of {x, y} from a to b, and
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
/**
 * A led rope is nearly taut between its pins, and a few passes leave a taut
 * rope stretching under gravity, sagging out of the gap it was led through:
 * so it gets more, and (LINK_PX) longer, stiffer links.
 */
export const LED_PASSES = 40;
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

/** How long a link of a led rope is, about, in px: a long link is a stiff one, so a taut span stays in its gap. */
export const LINK_PX = 36;
/** The fewest links in a span between pins, so even a short one bends as a rope. */
const MIN_LINKS = 3;
/**
 * A led span's slack: it sags this fraction of its length, at most SPAN_SAG_MAX
 * px. Between waypoints the cable is nearly taut: it was led through a gap,
 * and a loose one would hang out of it.
 */
const SPAN_SAG = 0.012;
const SPAN_SAG_MAX = 3;

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

/** spanLength is how long a led span of chord d is: a taut cable's sag over d, as ropeLength has it. */
function spanLength(d) {
  const s = Math.min(SPAN_SAG_MAX, SPAN_SAG * d);
  return Math.sqrt(d * d + (16 / 3) * s * s);
}

/**
 * layout is how a cable is cut into links: `n` points, with a pin at each
 * waypoint (`pins`, the index of each) and `seg[j]` the length of link j.
 * Without waypoints it is the plain rope of `n0` points, as it always was;
 * with them, each span between two pins is a rope of its own, in links of
 * about LINK_PX.
 */
export function layout(a, b, via, declared, n0 = ROPE_POINTS) {
  if (!via.length) return { n: n0, pins: [], seg: new Array(n0 - 1).fill(ropeLength(a, b, declared) / (n0 - 1)) };
  const stops = [a, ...via, b];
  const chords = [];
  for (let i = 0; i + 1 < stops.length; i++) chords.push(Math.hypot(stops[i + 1].x - stops[i].x, stops[i + 1].y - stops[i].y));
  // Links to each span by its length, never fewer than MIN_LINKS: a long link is a stiff one.
  const links = chords.map((c) => Math.max(MIN_LINKS, Math.round(c / LINK_PX)));
  const seg = [];
  const pins = [];
  let idx = 0;
  links.forEach((k, i) => {
    for (let j = 0; j < k; j++) seg.push(spanLength(chords[i]) / k);
    idx += k;
    if (i < links.length - 1) pins.push(idx);
  });
  return { n: seg.length + 1, pins, seg };
}

const same = (p, q) => !!p && !!q && p.x === q.x && p.y === q.y;
const point = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
/** at is the point a fraction t of the way along a run of points, by index. */
function at(pts, t) {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor(f)));
  const u = f - i;
  return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
}
const sameVia = (u, v) => u.length === v.length && u.every((p, i) => same(p, v[i]));

export class CableModel {
  constructor({ n = ROPE_POINTS } = {}) {
    this.n0 = n; // points in a rope that isn't led; a led one has as many as its spans need
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
    // A declared cable is taut, a straight line from its tag: it isn't led.
    const via = !declared && Array.isArray(state.via) ? state.via.filter(point) : [];
    if (!this.x) {
      this.start(a, b, declared, state.seed, via);
    } else if (!same(a, this.a) || !same(b, this.b) || declared !== this.declared || !sameVia(via, this.via)) {
      this.pin(a, b, declared, via);
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
  start(a, b, declared, seed, via) {
    const lay = layout(a, b, via, declared, this.n0);
    this.n = lay.n;
    const n = this.n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pin(a, b, declared, via);
    // A seed is the points of the rope that was in the hand. A led rope has
    // more points than that, so takes the seed's shape onto its own; a plain
    // one needs a seed of its own length.
    if (!declared && Array.isArray(seed) && (seed.length === n || (via.length && seed.length >= 2)) && seed.every(point)) {
      for (let i = 0; i < n; i++) {
        const q = at(seed, i / (n - 1));
        this.x[i] = this.px[i] = q.x;
        this.y[i] = this.py[i] = q.y;
      }
      this.fix();
      this.show(0, true);
      return;
    }
    // Between its ends, and its waypoints if it is led, a parabola of each
    // span's sag: close to where it hangs, so landing it is quick.
    const stops = [a, ...via, b];
    const pins = [0, ...this.pins, n - 1];
    for (let k = 0; k + 1 < stops.length; k++) {
      const p0 = stops[k], p1 = stops[k + 1];
      const s = declared ? 0 : via.length ? Math.min(SPAN_SAG_MAX, SPAN_SAG * Math.hypot(p1.x - p0.x, p1.y - p0.y)) : hang(a, b);
      for (let i = pins[k]; i <= pins[k + 1]; i++) {
        const t = (i - pins[k]) / (pins[k + 1] - pins[k]);
        this.x[i] = this.px[i] = p0.x + (p1.x - p0.x) * t;
        this.y[i] = this.py[i] = p0.y + (p1.y - p0.y) * t + 4 * s * t * (1 - t);
      }
    }
    if (declared) this.straight();
    else this.land();
  }

  // pin takes new ends, or new waypoints: the rope's links follow them, and
  // it moves again. A rope that is cut into a different number of points
  // keeps its shape, taken to the new points.
  pin(a, b, declared, via) {
    const lay = layout(a, b, via, declared, this.n0);
    if (lay.n !== this.n && this.x) {
      const pts = [];
      for (let i = 0; i < this.n; i++) pts.push({ x: this.x[i], y: this.y[i] });
      this.n = lay.n;
      this.x = new Float64Array(lay.n);
      this.y = new Float64Array(lay.n);
      for (let i = 0; i < lay.n; i++) {
        const q = at(pts, i / (lay.n - 1));
        this.x[i] = q.x;
        this.y[i] = q.y;
      }
      this.px = Float64Array.from(this.x);
      this.py = Float64Array.from(this.y);
    }
    this.a = { x: a.x, y: a.y };
    this.b = { x: b.x, y: b.y };
    this.declared = declared;
    this.via = via.map((p) => ({ x: p.x, y: p.y }));
    this.pins = lay.pins;
    this.seg = lay.seg;
    this.pinned = new Uint8Array(this.n);
    this.pinned[0] = this.pinned[this.n - 1] = 1;
    for (const i of lay.pins) this.pinned[i] = 1;
    this.resting = false;
    this.still = 0;
  }

  // fix puts the two ends, and the waypoints, where the page says they are.
  fix() {
    const m = this.n - 1;
    this.x[0] = this.a.x; this.y[0] = this.a.y;
    this.x[m] = this.b.x; this.y[m] = this.b.y;
    this.pins.forEach((i, k) => { this.x[i] = this.via[k].x; this.y[i] = this.via[k].y; });
  }

  /** substep is one fixed step: gravity, damping, the passes. It answers the most any point moved. */
  substep(keep) {
    const { x, y, px, py, n } = this;
    const h = STEP_MS / 1000;
    const g = GRAVITY * h * h;
    const { pinned } = this;
    px[0] = x[0]; py[0] = y[0];
    px[n - 1] = x[n - 1]; py[n - 1] = y[n - 1];
    for (let i = 1; i < n - 1; i++) {
      if (pinned[i]) { px[i] = x[i]; py[i] = y[i]; continue; }
      const vx = (x[i] - px[i]) * keep;
      const vy = (y[i] - py[i]) * keep;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx;
      y[i] += vy + g;
    }
    this.fix();
    const passes = this.pins.length ? LED_PASSES : PASSES;
    for (let p = 0; p < passes; p++) {
      if (p % 2 === 0) for (let j = 0; j < n - 1; j++) this.link(j);
      else for (let j = n - 2; j >= 0; j--) this.link(j);
    }
    let most = 0;
    for (let i = 1; i < n - 1; i++) {
      if (pinned[i]) continue;
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
    const wj = this.pinned[j] ? 0 : 1, wk = this.pinned[k] ? 0 : 1;
    const w = wj + wk;
    if (!w) return;
    const f = (d - this.seg[j]) / d / w;
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
