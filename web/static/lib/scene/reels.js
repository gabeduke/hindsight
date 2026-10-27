// web/static/lib/scene/reels.js
// The tape machine's reels, as a model: the page's polls in, the reels'
// turn and packs out, by lib/objects/reels.js's ReelMotion.
//
// State the page sets, once per poll: `pos` (frames heard), `playing`,
// `length` and `sampleRate` of the tape, and `at`, the scene's time of the
// poll (scene.now()). A new state is a new poll. `at` is what makes it new
// when nothing else is: a still tape polled again with the same position is
// still news -- it says the Pi is answering.
//
// The view is ReelMotion's frame: `pos`, the pack radii `left` and `right`,
// each reel's angle, `spin` (how fast the faster one turns, in degrees a
// second), and `moving` ('play', 'wind', 'rewind' or 'stop'). It
// is null until the first poll, so a renderer leaves the reels as drawn.
//
// Reduced motion arrives as the ticker's dt = Infinity: the reels then jump
// rather than wind, and don't turn -- ReelMotion's `reduced`.

import { ReelMotion } from '../objects/reels.js';

const same = (a, b) => a && b && a.pos === b.pos && a.left === b.left && a.right === b.right
  && a.angleL === b.angleL && a.angleR === b.angleR && a.spin === b.spin && a.moving === b.moving;

export class ReelsModel {
  constructor() {
    this.motion = null;
    this.polled = null; // the state last handed to the motion as a poll
    this.view = null;
  }

  step(state, dt, now) {
    const { pos, playing, length, sampleRate, at } = state;
    if (!(sampleRate > 0) || at === undefined) return false; // no poll yet
    const reduced = dt === Infinity;
    if (!this.motion || this.motion.sr !== sampleRate) {
      this.motion = new ReelMotion({ sampleRate, length, reduced });
      this.polled = null;
    }
    this.motion.reduced = reduced;
    this.motion.setLength(length);
    // By identity: set() makes a new state only when something changed, so
    // two polls in one millisecond (Safari's clock) are still two polls.
    if (state !== this.polled) {
      this.polled = state;
      this.motion.poll(pos, !!playing, at);
    }
    const m = this.motion.frame(now);
    if (!same(m, this.view)) this.view = Object.freeze(m);
    return m.moving !== 'stop';
  }
}
