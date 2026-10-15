// web/static/lib/rig/arm.js
// Multi-arm on the tape page (docs/superpowers/specs/2026-10-15-rig-design.md,
// *Multi-arm*): several tracks armed at once, each recording from its own
// input over one span, as one undo. The Pi keeps rec_tracks; rec_track,
// the first of them, is still there for pages from before.
//
// With the two rooms on, ● on a track's header adds it to what's armed or
// takes it off; 1–4, ↑ and ↓ still arm just that one. With them off, ● arms
// just the one, as it always did. Pure: no page, no Pi.

/** armedOf reads a tape's armed tracks: rec_tracks, or rec_track from a Pi before them. */
export function armedOf(t) {
  if (!t) return [];
  if (Array.isArray(t.rec_tracks)) return [...t.rec_tracks].sort((a, b) => a - b);
  if (t.rec_track === -1) return [];
  return [t.rec_track || 1];
}

/** toggled is armed with n added, or taken off if it was there. */
export function toggled(armed, n) {
  const s = new Set(armed);
  if (s.has(n)) s.delete(n);
  else s.add(n);
  return [...s].sort((a, b) => a - b);
}

/** pairsFor is what a recording sends: each armed track and the input it records from. */
export function pairsFor(armed, inputOf) {
  return armed.map((n) => ({ track: n, source: inputOf(n) }));
}

/**
 * recordBody is a catch's, a punch's or a tap's body: every armed track as a
 * pair, and the first track and source as before, so a Pi from before
 * multi-arm records the first as it always did.
 */
export function recordBody(armed, inputOf, extra = {}) {
  const pairs = pairsFor(armed, inputOf);
  return { track: armed[0], source: pairs.length ? pairs[0].source : '', pairs, ...extra };
}

/** tracksWords is "2", "2, 3" -- the tracks, as CATCH says them. */
export function tracksWords(ns) {
  return (ns || []).join(', ');
}

/** onWords is "track 2", or "tracks 2, 3". */
export function onWords(ns) {
  return ns.length === 1 ? `track ${ns[0]}` : `tracks ${tracksWords(ns)}`;
}

/** spanWords is what a catch took: "last 4 bars", "the last pass", "pass −2". */
export function spanWords(what) {
  if (what && what.bars) return `last ${what.bars} bar${what.bars === 1 ? '' : 's'}`;
  if (what && what.out != null) return 'that pass';
  if (what && what.pass > 1) return `pass −${what.pass}`;
  return 'the last pass';
}

/** catchSays is what CATCH did, in a few words: "last 4 bars → 2, 3". */
export function catchSays(what, tracks) {
  return `${spanWords(what)} → ${tracksWords(tracks)}`;
}
