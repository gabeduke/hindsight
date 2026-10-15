// web/static/lib/scene/deck.js
// The deck's model: its door, the reels within, and the tape between them
// (docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md).
//
// State the page sets: `door` ('open' or 'shut'), `travel` (how far the
// door drops, px: the window's height), `playing` (what's on the deck is
// sounding) and `loaded` (what's on it: the drawer's business, not this
// model's).
//
// The view: `door`, the door's offset from shut in px (−travel open, 0
// shut, and on the way shut it goes 2 px past and back: SEAT's thunk);
// `seat`, the scale of what's in the window, settling from a little big to
// 1 as the door shuts on it -- the flight hands it over at the window at
// SEAT_FROM;
// `angle`, the reels' turn in degrees, and `rate`, in turns a second; `sag`,
// how far the tape between them hangs, px.
//
// - The door shuts in SEAT's 160 ms on --ease-seat, its overshoot scaled so
//   it is exactly OVERSHOOT_PX whatever the door's height; it opens in
//   --t-touch.
// - The reels spin only once the door is shut -- SPIN UP starts as SEAT
//   ends, without a timer of its own -- and catch up with the sound through
//   motion.js's `spin`, reaching speed in about EASE_MS, as a capstan does.
//   On a stop they coast down the same way.
// - A stop kicks the tape's slack (motion.js's `slack`), which tension takes
//   up again with a small bounce.
//
// Reduced motion arrives as dt = Infinity: the door lands, the slack is
// taken up, and the reels take their rate without turning -- as the room's
// reels never turned with reduced motion. Then it parks.

import { spin, slack, settled } from '../objects/motion.js';
import { EASE_MS } from '../objects/reels.js';
import { easeSeat, easeOut, T_TOUCH, FRAMES, SEAT_FROM } from './choreo.js';

/** The room's reels turn once in 2.4 s, as P5's CSS spun them. */
export const RATE = 1 / 2.4;
export const SHUT_MS = FRAMES.find((f) => f.name === 'seat').for;
export const OPEN_MS = T_TOUCH;
export const OVERSHOOT_PX = 2;
/** spin's inertia that makes its time constant a third of EASE_MS: ~95 % of speed by EASE_MS. */
export const INERTIA = ((EASE_MS / 3) * 1.8) / 10;
/** How hard a stop at full speed kicks the slack, px per second. */
export const SLACK_KICK = 160;

// The seat curve's highest point, found once: the overshoot is scaled to it.
const SEAT_PEAK = (() => {
  let m = 1;
  for (let i = 0; i <= 1000; i++) m = Math.max(m, easeSeat(i / 1000));
  return m;
})();

/** doorAt is the door's offset at progress k (0 open, 1 shut), shutting or opening. */
export function doorAt(k, travel, shutting) {
  if (k >= 1) return 0;
  if (k <= 0) return -travel;
  if (!shutting) return -travel * easeOut(1 - k);
  const f = easeSeat(k);
  if (f < 1) return -travel * (1 - f);
  return OVERSHOOT_PX * ((f - 1) / (SEAT_PEAK - 1));
}

export class DeckModel {
  constructor() {
    this.k = null;       // the door: 0 open, 1 shut
    this.shutting = true;
    this.angle = 0;
    this.rate = 0;
    this.sag = 0;
    this.sagV = 0;
    this.wasPlaying = false;
    this.view = null;
  }

  step(state, dt) {
    const travel = Number(state.travel) > 0 ? Number(state.travel) : 0;
    const want = state.door === 'shut' ? 1 : 0;
    const reduced = dt === Infinity;
    const step = reduced || !(dt >= 0) ? 0 : dt;
    // First sight: as the page says, not animated in.
    if (this.k === null) { this.k = want; this.shutting = want === 1; }
    if (reduced) this.k = want;
    else if (this.k < want) { this.shutting = true; this.k = Math.min(1, this.k + step / SHUT_MS); }
    else if (this.k > want) { this.shutting = false; this.k = Math.max(0, this.k - step / OPEN_MS); }
    if (Math.abs(this.k - want) < 1e-9) this.k = want; // a sum of steps lands a hair off
    const shut = this.k >= 1;

    // The reels: up to speed once shut and sounding; coasting otherwise.
    const playing = !!state.playing;
    const target = playing && shut ? RATE : 0;
    if (this.wasPlaying && !playing && this.rate > RATE * 0.05) this.sagV += SLACK_KICK * (this.rate / RATE);
    this.wasPlaying = playing;
    if (reduced) {
      this.rate = target;
      this.sag = 0;
      this.sagV = 0;
    } else {
      const r = spin(this.angle, this.rate, target, INERTIA, step);
      this.angle = r.angle;
      this.rate = Math.abs(r.rate - target) < 1e-4 ? target : r.rate;
      const s = slack(this.sag, this.sagV, step);
      this.sag = s.sag;
      this.sagV = s.velocity;
      if (settled(this.sag, this.sagV, 0, 1e-3)) { this.sag = 0; this.sagV = 0; }
    }

    const door = doorAt(this.k, travel, this.shutting);
    const seat = this.shutting && this.k < 1 ? SEAT_FROM - (SEAT_FROM - 1) * easeOut(this.k) : 1;
    const v = this.view;
    if (!v || v.door !== door || v.seat !== seat || v.angle !== this.angle || v.rate !== this.rate || v.sag !== this.sag || v.travel !== travel) {
      this.view = Object.freeze({ door, seat, k: this.k, travel, angle: this.angle, rate: this.rate, sag: this.sag });
    }
    if (reduced) return false;
    return this.k !== want || this.rate !== target || this.rate !== 0 || this.sag !== 0 || this.sagV !== 0;
  }
}
