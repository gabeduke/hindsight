// web/static/lib/scene/models.js
// Every kind of scene object, and the model that steps it. A model is
//
//   { view, step(state, dt, now) → true while it still moves }
//
// pure apart from its own motion: it reads the frozen state, keeps what it
// needs between frames (a needle's velocity, a reel's angle), and derives a
// new frozen `view` only when something changed, so a renderer can tell by
// identity that it has nothing to draw. Reduced motion arrives as
// dt = Infinity, and a model given it lands on its target.
//
// The kinds still to come (deck, shelf, device) arrive with the
// steps that draw them. The cable is R4's: the rig's ropes.

import { VuModel } from './vu.js';
import { ReelsModel } from './reels.js';
import { CassetteModel } from './cassette.js';
import { RibbonModel } from './ribbon.js';
import { CableModel } from './cable.js';
import { PropModel } from './prop.js';

export const MODELS = Object.freeze({
  vu: () => new VuModel(),
  reels: () => new ReelsModel(),
  cassette: () => new CassetteModel(),
  ribbon: () => new RibbonModel(),
  cable: () => new CableModel(),
  // What stands still: the Listening Room's furniture (lib/room/space.js).
  prop: () => new PropModel(),
});
