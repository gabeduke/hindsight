// web/static/lib/scene/ribbon.js
// The ribbon's model: what of the ring is lit, and where recording starts.
//
// State the page sets from each poll of /api/envelope and from the hand on
// the ribbon:
//   ring, edge     the axis: the ring's length and its youngest age with a
//                  pixel of its own, in seconds (ring_seconds, edge_seconds)
//   buffered       how much of the ring has been recorded, in seconds
//   total, sr      the ring's frame count and sample rate, which let a held
//                  span name frames; without them a span can't be drawn
//   sel            a span held on the ribbon, {from, to} in absolute ring
//                  frames (to null is "now"), or null
//   selected       the chosen capture length in seconds (0 the whole ring),
//                  or null
//   levels         the envelope, 0 to 1 per bucket: drawn, not derived
//
// The view, as fractions of the ribbon's width so it holds at any size:
// `lit`, [from, to] or null, and `recordedFrom`. A span held on the ribbon
// wins over the chosen length. Nothing here moves on its own -- a held span
// slides left because each poll moves `total` on -- so a step never asks for
// another frame.

import { leftPct, ageOf } from '../objects/ribbonmath.js';

/** ribbonView derives the view from the state; pure, so the tests can pin it. */
export function ribbonView({ ring: T, edge: A, buffered = 0, total, sr, sel = null, selected = null } = {}) {
  if (!(T > 0) || !(A > 0)) return null;
  const at = (age) => leftPct(age, A, T) / 100;
  let lit = null;
  if (sel && total && sr) {
    const fromAge = Math.min(ageOf(sel.from, total, sr), buffered);
    const toAge = sel.to == null ? 0 : Math.min(ageOf(sel.to, total, sr), buffered);
    lit = [at(fromAge), sel.to == null ? 1 : at(toAge)];
  } else if (selected != null) {
    lit = [at(selected === 0 ? T : selected), 1];
  }
  return { lit, recordedFrom: at(buffered) };
}

const same = (a, b) => a === b || (!!a && !!b && a.recordedFrom === b.recordedFrom
  && (a.lit === b.lit || (!!a.lit && !!b.lit && a.lit[0] === b.lit[0] && a.lit[1] === b.lit[1])));

export class RibbonModel {
  constructor() { this.view = null; }

  step(state) {
    const v = ribbonView(state);
    if (!same(v, this.view)) this.view = v && Object.freeze({ ...v, lit: v.lit && Object.freeze(v.lit) });
    return false;
  }
}
