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
// The kinds still to come (record, shelf, device, cable) arrive with the
// steps that draw them: R2 onward. A kind only one flagged page uses is
// registered by that page's scene instead (Scene's `models`), so the pages
// without the flag never fetch it: the Listening Room's `deck` and
// `flight` (lib/room/hifi.js's HIFI_MODELS).

import { VuModel } from './vu.js';
import { ReelsModel } from './reels.js';
import { CassetteModel } from './cassette.js';
import { RibbonModel } from './ribbon.js';

export const MODELS = Object.freeze({
  vu: () => new VuModel(),
  reels: () => new ReelsModel(),
  cassette: () => new CassetteModel(),
  ribbon: () => new RibbonModel(),
});
