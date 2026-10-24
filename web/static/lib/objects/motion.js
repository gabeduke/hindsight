// web/static/lib/objects/motion.js
// How the objects move. Pure maths and one shared clock, so an object says
// what it wants and not how often to ask.
//
// Everything here is frame-rate independent: the same wall-clock time gives
// the same motion at 120 Hz, at 30 Hz, and across the ragged frames a phone
// gives you while it is also talking to a Pi over Wi-Fi. That matters more
// here than it looks -- the machine these run on is somebody's phone pointed
// at a Raspberry Pi, and "it was smooth on my laptop" is how motion bugs get
// shipped to three people's kits.

/**
 * report hands an error to the browser as if it had been thrown and not
 * caught -- the console, a page's error handlers, a test's pageerror --
 * without unwinding the frame that caught it.
 */
export function report(e) {
  if (typeof reportError === 'function') reportError(e);
  else console.error(e);
}

/** The longest step `spin` accumulates angle over, in ms. A tab in the
 *  background comes back with one enormous dt, and only the reels care:
 *  settling toward a target is the right answer at any dt, but winding on
 *  for the four seconds nobody watched is not. */
const MAX_SPIN_MS = 64;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * lag moves `value` toward `target` with a time constant `tau` (ms): the
 * exponential approach, which is what most "ease toward" code is reaching for
 * when it writes `v += (t - v) * 0.1` and accidentally ties itself to the
 * frame rate.
 *
 * tau is the time to cover 63% of the remaining distance, and is honest at
 * any dt because the decay is computed from it rather than assumed.
 */
export function lag(value, target, tau, dt) {
  if (!(tau > 0) || !(dt >= 0)) return target;
  const k = 1 - Math.exp(-dt / tau);
  return value + (target - value) * k;
}

// A real VU meter is a damped second-order movement, and the standard fixes
// both numbers: 300 ms to reach 99% of a step, overshooting by 1-1.5%.
//
// The damping ratio comes from the overshoot, which has a closed form:
// exp(-pi*z/sqrt(1-z^2)) = 0.01 gives z = 0.826. The natural frequency is
// then whatever puts the 99% crossing at 300 ms, solved once (offline, by
// bisection) rather than at runtime: 13.9923 rad/s. Checked in the tests.
//
// This is the difference between a needle and a slider. The 140 ms CSS
// transition the meters have today arrives and stops dead, which the eye
// reads as a bar that happens to be rotating.
export const VU_ZETA = 0.826;
export const VU_WN = 13.9923; // rad/s

// ---------- the motion tokens ----------
// One set of times, eases and springs for the whole app, so it moves in one
// voice. styles.css carries the same numbers as CSS custom properties
// (--t-*, --ease-*, --spring-*), pasted from scripts/motion-tokens.mjs, and
// lib/objects/motion-tokens.test.js fails when the two disagree.
//
// They are what the materials do (objects.css): a plastic key clicks down at
// once and springs back; a lamp lights at once and fades; a lid or a drawer
// has weight and a soft stop; a cassette in the air carries its momentum
// into its slot.

/**
 * T is how long things take, in ms.
 *
 *   press    a key going down, a lamp lighting: at once. Not even 30 ms -- a
 *            transition's first frame is still its start, so anything above
 *            0 shows the key up for a frame after the finger is on it.
 *   release  a key coming back up: the snap spring's 99%.
 *   touch    the answer to a finger: a state flips, a lamp fades.
 *   move     menus in, toasts, small slides and turns.
 *   exit     anything leaving: about ¾ of its way in, eased in.
 *   sheet    drawers and sheets, when no finger is on them.
 *   room     the switch from one room to the other.
 *   flight   between places: the cassette from the shelf to the deck.
 */
export const T = Object.freeze({ press: 0, release: 120, touch: 120, move: 200, exit: 120, sheet: 280, room: 300, flight: 420 });

/**
 * EASES are the curves for the moves no finger drives, as cubic-bézier
 * control points: `out` for what arrives, `in` for what leaves, `flight`
 * for a long way, `seat` for landing with a little overshoot, `standard`
 * for a thing that moves from one place on screen to another.
 */
export const EASES = Object.freeze({
  out: Object.freeze([0.2, 0.8, 0.2, 1]),
  in: Object.freeze([0.4, 0, 1, 1]),
  flight: Object.freeze([0.3, 0, 0.2, 1]),
  seat: Object.freeze([0.34, 1.56, 0.64, 1]),
  standard: Object.freeze([0.2, 0, 0, 1]),
});

/**
 * SPRINGS, as a damping ratio and a natural frequency (rad/s): the same two
 * numbers as the needle's. Stepped with spring() for anything a finger
 * drives or that may be turned round halfway; played as a CSS linear()
 * (springEasing) for a move that runs to its end.
 *
 *   snap    critically damped and quick, no overshoot: a key back up, a chip, a toggle
 *   lid     a soft stop, ½% over: drawers, sheets, menus, a fold
 *   carry   a thing in the air, 3% over as it seats: clips and spines between places
 *   needle  the VU movement (above)
 */
export const SPRINGS = Object.freeze({
  snap: Object.freeze({ zeta: 1, wn: 55 }),
  lid: Object.freeze({ zeta: 0.86, wn: 22 }),
  carry: Object.freeze({ zeta: 0.74, wn: 17 }),
  needle: Object.freeze({ zeta: VU_ZETA, wn: VU_WN }),
});

/** Within this much of critical damping, the critical closed form is the one taken: either side, the other two divide by nearly nothing. */
const CRITICAL = 1e-6;

/**
 * spring steps a damped spring toward `target` over `dt` ms, returning the
 * new {value, velocity}. Pass the previous pair back in; `velocity` is in
 * units per second, so a drag's speed hands straight over to it.
 *
 * This is the exact step response, not an integrator: within one frame the
 * target is constant, and a damped second-order system driven by a constant
 * has a closed form. So it is unconditionally stable, needs no substepping,
 * and gives bit-identical motion at any frame rate instead of merely close
 * motion. A stiff explicit integrator goes unstable somewhere around a 20 ms
 * step, which is a frame rate phones hit all the time.
 *
 * Each damping has its own form. Under 1 it rings (sin and cos); at 1 it is
 * e^{-ωt}(d + (v + ωd)t), which the ringing form can't reach -- it divides
 * by √(1−ζ²); over 1 it is two decays, and never crosses its target.
 */
export function spring(value, velocity, target, dt, { zeta, wn }) {
  // A step long enough that the exponential underflows -- or a tab that was
  // in the background for a minute -- has simply arrived. Taken early: the
  // trig below would be NaN at a non-finite dt.
  if (!(dt > 0)) return { value, velocity };
  const h = dt / 1000;
  const d = value - target;
  if (Math.abs(zeta - 1) < CRITICAL) {
    const decay = wn * h;
    if (!Number.isFinite(decay) || decay > 40) return { value: target, velocity: 0 };
    const e = Math.exp(-decay);
    const b = velocity + wn * d;
    return { value: target + e * (d + b * h), velocity: e * (velocity - wn * b * h) };
  }
  if (zeta > 1) {
    const r = wn * Math.sqrt(zeta * zeta - 1);
    const slow = -zeta * wn + r, fast = -zeta * wn - r; // both below 0
    if (!Number.isFinite(-slow * h) || -slow * h > 40) return { value: target, velocity: 0 };
    const cs = (velocity - fast * d) / (slow - fast), cf = d - cs;
    const es = Math.exp(slow * h), ef = Math.exp(fast * h);
    return { value: target + cs * es + cf * ef, velocity: slow * cs * es + fast * cf * ef };
  }
  const decay = zeta * wn * h;
  if (!Number.isFinite(decay) || decay > 40) return { value: target, velocity: 0 };

  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const a = d;
  const b = (velocity + zeta * wn * d) / wd;
  const e = Math.exp(-decay);
  const c = Math.cos(wd * h), s = Math.sin(wd * h);
  return {
    value: target + e * (a * c + b * s),
    velocity: e * (velocity * c - (zeta * wn * b + a * wd) * s),
  };
}

/**
 * ballistic steps a needle toward `target` over `dt` ms: spring() with the
 * VU movement's numbers, unless it is handed others.
 */
export function ballistic(value, velocity, target, dt, { zeta = VU_ZETA, wn = VU_WN } = {}) {
  return spring(value, velocity, target, dt, { zeta, wn });
}

/** How near a spring's CSS curve comes before it ends on its target: 0.1% of the way. */
export const EASING_EPS = 0.001;
const EASING_HZ = 60;
const easings = new Map();

/**
 * springEasing is a spring as CSS can play it, from rest to its target:
 * { duration (ms), easing: 'linear(0, …, 1)' }. One point a 60 Hz frame,
 * to a tenth of a percent, until the spring is within 0.1% of its target
 * and as good as still; then 1. Its duration is the spring's own -- played
 * over another, it is a different spring. Worked out once a spring.
 *
 * A linear() runs to its end and forgets its speed when it is cut short:
 * it is for moves nothing turns round. Anything a finger drives, or that
 * may change its mind halfway, steps spring() on the ticker instead.
 */
export function springEasing(s) {
  const key = `${s.zeta}/${s.wn}`;
  const kept = easings.get(key);
  if (kept) return kept;
  const frame = 1000 / EASING_HZ;
  const points = [0];
  let value = 0, velocity = 0;
  for (let n = 1; n <= 10 * EASING_HZ; n++) {
    ({ value, velocity } = spring(value, velocity, 1, frame, s));
    if (Math.abs(1 - value) < EASING_EPS && Math.abs(velocity) / s.wn < EASING_EPS) break;
    points.push(value);
  }
  points.push(1);
  const round = (v) => String(Math.round(v * 1000) / 1000);
  const out = Object.freeze({
    duration: Math.round(((points.length - 1) * 1000) / EASING_HZ),
    easing: `linear(${points.map(round).join(', ')})`,
  });
  easings.set(key, out);
  return out;
}

/**
 * project is how far a flick carries, in px, from its speed at release
 * (px/s): where it would come to rest if it coasted, losing `rate` of its
 * speed each ms (UIScrollView's normal deceleration). A sheet or a drawer
 * settles at the detent nearest that, not nearest the finger.
 */
export function project(velocity, rate = 0.998) {
  if (!(rate > 0 && rate < 1) || !Number.isFinite(velocity)) return 0;
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** settled says the movement has arrived and can stop being stepped. */
export function settled(value, velocity, target, epsilon = 1e-3) {
  return Math.abs(target - value) < epsilon && Math.abs(velocity) < epsilon;
}

/**
 * spin steps a reel over `dt` ms toward `targetRate` (turns per second),
 * returning the new {angle, rate}. `angle` is degrees, wrapped.
 *
 * `inertia` is how reluctant this reel is, in the same units the pack radii
 * come in: a full supply reel is heavy and a nearly empty one is not, so a
 * caller passes the current radius and the reel spins up and coasts down the
 * way the real one does. The time constant is proportional to it because the
 * drag is roughly linear at these speeds -- this is a feel model, not a
 * tape-path simulation.
 */
export function spin(angle, rate, targetRate, inertia, dt, { drag = 1.8 } = {}) {
  const step = clamp(dt, 0, MAX_SPIN_MS);
  const tau = Math.max(1, (inertia / drag) * 10);
  const next = lag(rate, targetRate, tau, step);
  // The mean rate across the step, not the end rate: at 30 Hz the difference
  // is visible as a reel that lags its own spin-up.
  const turns = ((rate + next) / 2) * (step / 1000);
  return { angle: (angle + turns * 360) % 360, rate: next };
}

/** lessMotion is the device's prefers-reduced-motion, as a MediaQueryList, or null where there is none (node). */
function lessMotion() {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
}

/**
 * Ticker is the one requestAnimationFrame loop. Objects add themselves and
 * are stepped with the ms since the last frame; it parks itself when nothing
 * is moving and starts again when something is.
 *
 * One loop rather than one per object: fifteen objects each with their own
 * rAF is a cost that only ever shows up on someone else's hardware, and this
 * app now runs on three people's Pis.
 */
export class Ticker {
  /**
   * reduced: the device asks for less motion, so every step is handed an
   * infinite dt and each object lands on its target in one frame. Checked
   * here rather than in each object, so there is one place to get it right
   * and no object can quietly forget. Given, it is fixed (the tests, the
   * bench); otherwise it follows `media`, the device's
   * prefers-reduced-motion, as it changes: switched on in the settings
   * with the app open, the next frame already has it.
   *
   * onError: where a step that throws is reported (by default as an
   * uncaught error would be). Once per failure: a step that throws every
   * frame is heard once, not sixty times a second, and heard again only if
   * it recovers and breaks anew.
   */
  constructor({ raf, cancel, now, reduced, media = lessMotion(), onError = report } = {}) {
    this.raf = raf || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : 0));
    this.cancel = cancel || ((h) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : undefined));
    this.now = now || (() => performance.now());
    this.reduced = reduced !== undefined ? reduced : !!media?.matches;
    if (reduced === undefined && media) {
      // A step mid-flight when it turns on lands on the next frame, as
      // every step then is handed an infinite dt.
      const follow = (e) => { this.reduced = !!e.matches; };
      if (typeof media.addEventListener === 'function') media.addEventListener('change', follow);
      else media.addListener?.(follow); // Safari before 14
    }
    this.onError = onError;
    this.steps = new Set();
    this.failing = new WeakSet(); // steps whose last call threw, already reported
    this.handle = 0;
    this.last = 0;
    this.ticking = false; // inside a frame, stepping
    this.woken = false;   // something asked for the next frame from inside this one
  }

  /**
   * add registers a step function, called with (dtMs, nowMs) and returning
   * whether it still wants frames. Returns a function that removes it again.
   */
  add(step) {
    this.steps.add(step);
    this.start();
    return () => {
      this.steps.delete(step);
      if (!this.steps.size) this.stop();
    };
  }

  /**
   * start wakes a parked ticker. From inside a step it only asks for the
   * next frame: a step that sets another object's state wakes the ticker
   * mid-frame, and scheduling a frame then as well as at the end of this one
   * would run two loops, stepping everything twice a frame.
   */
  start() {
    if (this.ticking) { this.woken = true; return; }
    if (this.handle || !this.steps.size) return;
    this.last = this.now();
    this.handle = this.raf(this.tick ||= () => this.frame());
  }

  frame() {
    this.handle = 0;
    const t = this.now();
    const dt = this.reduced ? Infinity : Math.max(0, t - this.last);
    this.last = t;
    let wants = false;
    this.ticking = true;
    this.woken = false;
    try {
      for (const step of [...this.steps]) {
        // Taken off by a step earlier in this frame: it has gone.
        if (!this.steps.has(step)) continue;
        // One object throwing must not take the other fourteen down with
        // it, nor go unheard.
        try {
          if (step(dt, t) !== false) wants = true;
          this.failing.delete(step);
        } catch (e) {
          if (!this.failing.has(step)) {
            this.failing.add(step);
            try { this.onError(e); } catch { /* the reporter can't stop the frame */ }
          }
        }
      }
    } finally {
      this.ticking = false;
    }
    if ((wants || this.woken) && this.steps.size) this.handle = this.raf(this.tick);
    this.woken = false;
  }

  stop() {
    if (this.handle) this.cancel(this.handle);
    this.handle = 0;
    this.woken = false;
  }

  /** running is whether a frame is currently scheduled. For tests and the bench. */
  get running() { return this.handle !== 0; }
}

/** The ticker the pages share. The bench makes its own, to run at ⅒ speed. */
export const ticker = new Ticker();

/**
 * Loop is one object's frame loop on a ticker -- a player's playhead, a
 * clock's position -- for things that only move while something plays.
 * start() steps `fn(dt, now)` every frame until it returns false (or throws),
 * then takes it off the ticker, so a paused player costs nothing even while
 * the meters keep the ticker going. start() while running does nothing.
 */
export class Loop {
  constructor(fn, clock = ticker) {
    this.fn = fn;
    this.clock = clock;
    this.off = null;
    this.step = (dt, now) => {
      const mine = this.off; // the start() this frame is running under
      let more = false;
      try {
        more = this.fn(dt, now) !== false;
      } finally {
        // Stop only that start: fn may have stopped and started it again.
        if (!more && this.off === mine) this.stop();
      }
      return more;
    };
  }

  start() { if (!this.off) this.off = this.clock.add(this.step); }

  stop() {
    const off = this.off;
    this.off = null;
    off?.();
  }

  get running() { return this.off !== null; }
}
