// web/static/lib/rooms/flag.js
// The two rooms' per-device flag (docs/superpowers/specs/2026-10-15-rooms-design.md):
// the Studio and the Listening Room in place of Capture, Takes and Tape.
//
// On its own, with no side effects, so anything can read it -- the nav, the
// Settings sheet, the Studio, and the steps built on this one -- without
// starting anything. Off by default: the other kits update from the same
// releases.

export const ROOMS_FLAG = 'hindsight.rooms';

/** on says whether this device has the two rooms turned on. */
export function on() {
  try { return localStorage.getItem(ROOMS_FLAG) === '1'; } catch { return false; }
}

/**
 * setOn turns it on or off for this device and says whether it stuck: storage
 * that refuses (private mode) answers false, so the sheet does not claim a
 * switch it could not keep.
 */
export function setOn(v) {
  try {
    if (v) localStorage.setItem(ROOMS_FLAG, '1');
    else localStorage.removeItem(ROOMS_FLAG);
    return on() === !!v;
  } catch { return false; }
}
