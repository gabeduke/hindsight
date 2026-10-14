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

/**
 * ballistic steps a needle toward `target` over `dt` ms, returning the new
 * {value, velocity}. Pass the previous pair back in; `velocity` is in units
 * per second.
 *
 * This is the exact step response, not an integrator: within one frame the
 * target is constant, and a damped second-order system driven by a constant
 * has a closed form. So it is unconditionally stable, needs no substepping,
 * and gives bit-identical motion at any frame rate instead of merely close
 * motion. A stiff explicit integrator goes unstable somewhere around a 20 ms
 * step, which is a frame rate phones hit all the time.
 */
export function ballistic(value, velocity, target, dt, { zeta = VU_ZETA, wn = VU_WN } = {}) {
  // A step long enough that the exponential underflows -- or a tab that was
  // in the background for a minute -- has simply arrived. Taken early: the
  // trig below would be NaN at a non-finite dt.
  if (!(dt > 0)) return { value, velocity };
  const decay = zeta * wn * (dt / 1000);
  if (!Number.isFinite(decay) || decay > 40) return { value: target, velocity: 0 };

  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const h = dt / 1000;
  const d = value - target;
  const a = d;
  const b = (velocity + zeta * wn * d) / wd;
  const e = Math.exp(-decay);
  const c = Math.cos(wd * h), s = Math.sin(wd * h);
  return {
    value: target + e * (a * c + b * s),
    velocity: e * (velocity * c - (zeta * wn * b + a * wd) * s),
  };
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
   * and no object can quietly forget.
   */
  constructor({ raf, cancel, now, reduced } = {}) {
    this.raf = raf || ((fn) => requestAnimationFrame(fn));
    this.cancel = cancel || ((h) => cancelAnimationFrame(h));
    this.now = now || (() => performance.now());
    this.reduced = reduced !== undefined
      ? reduced
      : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.steps = new Set();
    this.handle = 0;
    this.last = 0;
  }

  /**
   * add registers a step function, called with (dtMs) and returning whether
   * it still wants frames. Returns a function that removes it again.
   */
  add(step) {
    this.steps.add(step);
    this.start();
    return () => {
      this.steps.delete(step);
      if (!this.steps.size) this.stop();
    };
  }

  start() {
    if (this.handle || !this.steps.size) return;
    this.last = this.now();
    const tick = () => {
      this.handle = 0;
      const t = this.now();
      const dt = this.reduced ? Infinity : Math.max(0, t - this.last);
      this.last = t;
      let wants = false;
      for (const step of [...this.steps]) {
        // One object throwing must not take the other fourteen down with it.
        try { if (step(dt) !== false) wants = true; } catch { /* keep the loop */ }
      }
      if (wants) this.handle = this.raf(tick);
    };
    this.handle = this.raf(tick);
  }

  stop() {
    if (this.handle) this.cancel(this.handle);
    this.handle = 0;
  }

  /** running is whether a frame is currently scheduled. For tests and the bench. */
  get running() { return this.handle !== 0; }
}

/** The ticker the pages share. The bench makes its own, to run at ⅒ speed. */
export const ticker = new Ticker();
