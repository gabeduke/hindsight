// web/static/lib/play/held.js
// What another hand holds, made right against the Pi's own list.
//
// Pads lit by another hand come from the Pi's `at` messages (link.js). A
// page that stalled -- a phone asleep a moment, a busy tab -- can miss one,
// and a pad would stay lit, or stay dark, until the next press. So on each
// poll the strip checks what it shows against `live.tricks`, the pads the Pi
// holds now, and puts right what differs. An amount moving (an `at` with
// `move`) is never what lights a pad; only presses and releases are, and
// this.

/** RECENT_MS: a pad this hand let go of this lately is still on its way out on the Pi. */
export const RECENT_MS = 1500;

/**
 * reconcile is what to change: {on, off}, the pads another hand holds that
 * aren't lit, and the ones lit that nobody holds. It leaves alone a pad this
 * hand is playing or let go of a moment ago (`mine(pad)`), one with an `at`
 * still waiting to be heard (`waiting`), and anything the strip doesn't draw
 * (`drawn(pad)`).
 */
export function reconcile({ tricks, lit, waiting = [], mine = () => false, drawn = () => true }) {
  const out = { on: [], off: [] };
  if (!Array.isArray(tricks)) return out;
  const held = new Set(tricks);
  const shown = new Set(lit);
  const wait = new Set(waiting);
  for (const pad of shown) if (!held.has(pad) && !wait.has(pad)) out.off.push(pad);
  for (const pad of held) {
    if (shown.has(pad) || wait.has(pad) || mine(pad) || !drawn(pad)) continue;
    out.on.push(pad);
  }
  return out;
}
