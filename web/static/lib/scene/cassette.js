// web/static/lib/scene/cassette.js
// The cassette's model.
//
// State the page sets: `played`, how far through the take the tape is (0 to
// 1, from its <audio>, or by hand on the bench), and `playing`. The view is
// what the face draws from: `played`, held to the tape; `spinning`, whether
// the hubs turn; and `hubL` and `hubR`, how far each has turned, in degrees
// clockwise.
//
// A cassette's tape runs past the head at one speed, so a spool turns
// faster the less tape is on it: the left hub, giving its tape away,
// starts slow under a full pack and quickens; the right one slows as its
// pack grows. The packs and the lit bars follow `played` exactly, so there
// is nothing there to ease. When the shelf hands a cassette to the deck
// (R2), its lift belongs here too.
//
// Reduced motion arrives as the ticker's dt = Infinity: the hubs then stay
// where they are.

import { packRadii } from '../objects/cassette-geom.js';

/**
 * How fast a bare hub turns while the tape plays, in degrees a second: a
 * C-cassette's 4.76 cm/s round its 11 mm hub. Under a full pack, twice the
 * radius (cassette-geom.js's packs run from rMin to twice that), half the
 * speed.
 */
export const HUB_TURN = 240;

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

export class CassetteModel {
  constructor() {
    this.view = Object.freeze({ played: 0, spinning: false, hubL: 0, hubR: 0 });
  }

  step(state, dt) {
    const played = clamp01(state.played);
    const spinning = !!state.playing;
    const turning = spinning && dt !== Infinity;
    let { hubL, hubR } = this.view;
    if (turning && dt > 0) {
      const [l, r] = packRadii(played, 1, 2);
      hubL = (hubL + (HUB_TURN * dt) / 1000 / l) % 360;
      hubR = (hubR + (HUB_TURN * dt) / 1000 / r) % 360;
    }
    const v = this.view;
    if (played !== v.played || spinning !== v.spinning || hubL !== v.hubL || hubR !== v.hubR) {
      this.view = Object.freeze({ played, spinning, hubL, hubR });
    }
    // The page's clock moves the tape; the hubs are this model's own, and
    // want a frame while they turn.
    return turning;
  }
}
