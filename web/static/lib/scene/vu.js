// web/static/lib/scene/vu.js
// The VU meter's model: a level in, a needle out.
//
// State the page sets: `level` (RMS, dBFS), `ref` (the level that reads
// 0 VU; −18 dBFS unless the page says otherwise) and `peak` (the lamp, lit
// or not: the page holds it for 700 ms after a clip, so it is a target like
// the level). The view is the needle: `angle` in degrees from upright, its
// `velocity`, and the `target` it is heading for.
//
// The needle is driven by motion.js's `ballistic`, the real VU movement --
// 300 ms to 99 % of a step with about 1 % of overshoot -- which is exact at
// any frame rate, so 20 Hz and 120 Hz put it in the same place. It carries
// its momentum through a change of level, which is what a moving coil does,
// and why it reads as a needle rather than a bar that happens to rotate.

import { ballistic, settled } from '../objects/motion.js';

/** The needle's swing either side of upright, in degrees. */
export const VU_SWING = 48;
export const REF_DBFS = -18;
const TOP_VU = 3;

/**
 * vuAngle is the needle's angle for a level in dBFS, 0 VU at ref. The VU
 * law is linear in voltage, so the low end crowds to the left. Anything off
 * the scale, or not a number, pins to its end stop.
 */
export function vuAngle(dbfs, ref = REF_DBFS) {
  if (!Number.isFinite(dbfs)) return -VU_SWING;
  const v = Math.pow(10, (dbfs - ref) / 20);
  const lo = Math.pow(10, -20 / 20), hi = Math.pow(10, TOP_VU / 20);
  const f = (v - lo) / (hi - lo);
  return Math.max(-VU_SWING, Math.min(VU_SWING, -VU_SWING + 2 * VU_SWING * f));
}

export class VuModel {
  constructor() {
    // At rest on the left stop, as a meter with no signal is.
    this.view = Object.freeze({ angle: -VU_SWING, velocity: 0, target: -VU_SWING });
  }

  /** step moves the needle `dt` ms toward the state's level; false once it has arrived. */
  step(state, dt) {
    const target = vuAngle(state.level, state.ref ?? REF_DBFS);
    const { angle, velocity } = this.view;
    if (settled(angle, velocity, target)) {
      // Parked exactly on target rather than a thousandth away, so the
      // transform stops changing and the browser stops repainting.
      if (angle !== target || velocity !== 0 || this.view.target !== target) {
        this.view = Object.freeze({ angle: target, velocity: 0, target });
      }
      return false;
    }
    const next = ballistic(angle, velocity, target, dt);
    this.view = Object.freeze({ angle: next.value, velocity: next.velocity, target });
    return true;
  }
}
