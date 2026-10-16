// web/static/lib/rooms/takename.js
// A take in a toast, named as its spine names it (docs/superpowers/specs/
// 2026-10-15-flow-design.md, "Every word on screen today"): "01:31:01 · 0:30",
// or its given name, and how long it is -- not the file, jam_….wav, which the
// Listening Room never shows. The file name stays where a request needs it;
// this is only what a person reads.

import { spineTitle } from '../shelf.js';
import { fmtLen } from '../room/deck.js';

/**
 * takeTitle is a take as a toast says it. `seconds` is optional: a take
 * taken back is named without its length when the request did not carry it.
 */
export function takeTitle(name, seconds, label = '') {
  const title = spineTitle({ name, label });
  return Number.isFinite(seconds) && seconds > 0 ? `${title} · ${fmtLen(seconds)}` : title;
}
