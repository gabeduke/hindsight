// web/static/lib/scene/flight.js
// The flight's model: a thing between its shelf and the deck, as a playhead
// on the Choreography's timeline (choreo.js).
//
// State the page sets: `goal`, where it's headed -- 'out' (picked, and held
// pulled out while its card is open: HOLD, 300 ms), 'deck' (SEAT_AT, 920 ms:
// at the window, where the deck takes over and draws SEAT itself) or 'shelf'
// (back in its slot, 0) -- with `from`, its slot's rect, `to`,
// the deck's window's rect (viewport px, {x, y, w, h}; measured again by the
// page when the page scrolls or resizes), `turn` (a spine that turns to show
// its face), `vanish` (a thing that goes into the deck without a face of its
// own -- a reel box, whose reels are the deck's -- and so dissolves as it
// arrives), and `t0`, where the playhead starts: 0 for a pick, SEATED for a
// thing ejected from the deck.
//
// The goal is a target, as every model's state is: the playhead moves toward
// it in real time -- forward at 1×, back at BACK_RATE, so the whole way back
// takes EJECT_MS -- and a goal changed half way just turns it round. The view
// is frameAt()'s drawing at the playhead, with `t`, its `phase`, and
// `arrived` once it's at the goal; then the model parks.
//
// The model only shows the move. The page's clock (lib/room/carry.js) starts
// the sound at SEAT whatever the frames do; the playhead runs on the same
// real time, so the two agree.
//
// Reduced motion arrives as dt = Infinity: the playhead lands on its goal.

import { frameAt, HOLD, SEAT_AT, BACK_RATE } from './choreo.js';

export const TARGETS = Object.freeze({ out: HOLD, deck: SEAT_AT, shelf: 0 });

export class FlightModel {
  constructor() {
    this.t = null;      // the playhead, ms on the timeline
    this.view = null;
    this.drawn = null;  // {t, state} the view was made from
  }

  step(state, dt) {
    if (!state.from) return false; // nowhere to start from: nothing to draw
    const target = TARGETS[state.goal] ?? 0;
    if (this.t === null) this.t = Number.isFinite(state.t0) ? state.t0 : 0;
    if (dt === Infinity || !(dt >= 0)) {
      if (dt === Infinity) this.t = target;
    } else if (this.t < target) {
      this.t = Math.min(target, this.t + dt);
    } else if (this.t > target) {
      this.t = Math.max(target, this.t - dt * BACK_RATE);
    }
    if (!this.drawn || this.drawn.t !== this.t || this.drawn.state !== state) {
      this.drawn = { t: this.t, state };
      const v = frameAt(this.t, state);
      v.goal = state.goal;
      v.arrived = this.t === target;
      this.view = Object.freeze(v);
    }
    return this.t !== target;
  }
}
