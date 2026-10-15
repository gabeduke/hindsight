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

/**
 * armClick is what ● on track n does, and what its label says it does. With
 * the rooms on it adds the track to what is armed, or takes it off, and the
 * label says what Catch and Rec then do -- they record onto every armed
 * track -- so what it says and what it makes are the same set.
 */
export function armClick(armed, n, rooms) {
  const on = armed.includes(n);
  if (rooms) {
    const next = toggled(armed, n);
    const then = next.length ? `Catch and Rec then use ${onWords(next)}` : 'Nothing is then armed';
    return on
      ? { next, label: `Track ${n} is armed: take it off. ${then}` }
      : { next, label: `Arm track ${n}${armed.length ? ' as well' : ''}: ${then}` };
  }
  // The rooms off: ● arms just that track, as it always did -- but a lit one,
  // which another device may have armed beside others, comes off on its own,
  // so it never says "disarm" and arms instead.
  if (!on) return { next: [n], label: `Record onto track ${n}` };
  if (armed.length === 1) return { next: [], label: `Track ${n} is the record track: disarm it` };
  return { next: armed.filter((x) => x !== n), label: `Track ${n} is armed: disarm it` };
}

/**
 * armedNote is what a ● that added a track to others already armed says,
 * once: that Catch and Rec now record onto all of them (DROP onto the first),
 * and the one way back to just this track -- on a phone, taking the others
 * off is a row of small ●s under folded lanes. null for anything else: the
 * first arm, or a track coming off.
 */
export function armedNote(armed, n, next) {
  if (!armed.length || armed.includes(n) || !next.includes(n)) return null;
  return {
    text: `${cap(onWords(next))} are armed: Catch and Rec record onto all of them, DROP onto the first`,
    action: `Only track ${n}`,
    only: [n],
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
