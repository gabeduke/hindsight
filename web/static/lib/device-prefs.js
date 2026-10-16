// web/static/lib/device-prefs.js
// Settings that belong to this device rather than to the Pi.
//
// The Settings sheet's other groups come from /api/settings: the Pi's own
// registry, shared by everyone who opens it, applied on restart. A preview
// someone turns on for their own phone is none of those things -- it should
// not reach the other two kits, and it should not need a restart of the
// machine recording the jam. So these live in localStorage and are drawn in
// their own group.
//
// A toggle here owns nothing: it points at the module that does. Adding one
// is adding a line.

import { on as playOn, setOn as playSetOn } from './play/flag.js';
import { on as roomsOn, setOn as roomsSetOn } from './rooms/flag.js';

/**
 * Each toggle: a stable id, `feature` when it is a preview (it is drawn up
 * front in the sheet's own Preview features section; one without it goes in
 * a small This device group below), what the sheet calls it, a line saying what it
 * does, whether a reload is needed for it to take effect, and the pair of
 * functions that read and write it.
 */
export const DEVICE_PREFS = [
  {
    id: 'play',
    feature: true,
    label: 'Play mode',
    note: 'The instrument strip above the tape’s bar: held pads, the reel as the loop’s ring, and a MIDI controller to play them.',
    reload: true, // lib/play/mount.js reads the flag once, when the page loads
    get: playOn,
    set: playSetOn,
  },
  {
    id: 'rooms',
    feature: true,
    label: 'Two rooms',
    note: 'A Studio and a Listening Room in place of Capture, Takes and Tape. The Studio is the tape with the feed and Keep above it, and Settings at its foot.',
    reload: true, // lib/nav.js and lib/rooms/studio.js read the flag once, when the page loads
    get: roomsOn,
    set: roomsSetOn,
  },
];

/** read returns {id: boolean} for every toggle, for drawing the sheet. */
export function read(prefs = DEVICE_PREFS) {
  const out = {};
  for (const p of prefs) {
    try { out[p.id] = !!p.get(); } catch { out[p.id] = false; }
  }
  return out;
}

/**
 * write sets one toggle and says whether the page has to reload for it to
 * take effect. A toggle that throws (private mode) reports false rather than
 * taking the sheet down.
 */
export function write(id, value, prefs = DEVICE_PREFS) {
  const p = prefs.find((x) => x.id === id);
  if (!p) return { ok: false, reload: false };
  try {
    p.set(value);
    return { ok: true, reload: !!p.reload };
  } catch {
    return { ok: false, reload: false };
  }
}
