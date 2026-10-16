// web/static/lib/rig/picker.js
// Patching without dragging: every socket is a button. Choose one, and the
// sockets it can go into light up; choose one of those and the cable is
// plugged. Choosing anything else chooses that instead; choosing the same
// socket again, or Escape, lets go. A screen reader and a keyboard patch
// this way, and so does a tap on a phone (docs/superpowers/specs/2026-10-15-rig-design.md,
// *Patching by keyboard and screen reader*). Pure: the page sends what it
// answers.

import { writeFor, targetsFor } from './patch.js';

/**
 * choose is what pressing socket id does, from state {sel, targets}: it
 * answers the next state and, when it plugs a cable, the request to send.
 */
export function choose(g, all, state, id) {
  const s = state || { sel: null, targets: [] };
  if (s.sel && s.sel === id) return { state: { sel: null, targets: [] }, write: null };
  if (s.sel && s.targets.includes(id)) {
    return { state: { sel: id, targets: [] }, write: writeFor(g, s.sel, id), from: s.sel, to: id };
  }
  return { state: { sel: id, targets: targetsFor(g, id, all) }, write: null };
}

/** letGo is Escape: nothing chosen. */
export function letGo() {
  return { sel: null, targets: [] };
}
