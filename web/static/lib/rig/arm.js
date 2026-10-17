// web/static/lib/rig/arm.js
// Multi-arm on the tape page (docs/superpowers/specs/2026-10-15-rig-design.md,
// *Multi-arm*): several tracks armed at once, each recording from its own
// input over one span, as one undo. The Pi keeps rec_tracks; rec_track,
// the first of them, is still there for pages from before.
//
// A tap on a track's ● arms just that track, as 1–4, ↑ and ↓ do, and a hold
// (or ⇧-click) arms it as well -- or takes it off (rig/armpress.js). Pure: no
// page, no Pi.

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
 * multi-arm records the first as it always did. `pairs` is sent only when
 * more than one track is armed, where it is needed: one armed track is the
 * body the old pages always sent ({track, source, replace}), so with the
 * preview flags off a Pi sees nothing new.
 */
export function recordBody(armed, inputOf, extra = {}) {
  const pairs = pairsFor(armed, inputOf);
  return { track: armed[0], source: pairs.length ? pairs[0].source : '', ...(pairs.length > 1 ? { pairs } : {}), ...extra };
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
 * tapArm is what a tap on track n's ● arms: just n, as
 * 1–4 do. A tap moves the arm; it does not take it off, so a tap on the only
 * armed track leaves it armed (a hold is the way to none).
 */
export function tapArm(armed, n) {
  return [n];
}

/** holdArm is what a hold (or ⇧-click) arms: n added to what is armed, or taken off if it is. */
export function holdArm(armed, n) {
  return toggled(armed, n);
}

/**
 * armClick is what ● on track n does, and what its label says it does: a tap
 * arms just n and a hold arms it as well (or takes it off), and the label
 * names both and what Catch and Rec then use -- they record onto every armed
 * track -- so what it says and what it makes are the same set. `next` is the
 * tap's.
 */
export function armClick(armed, n) {
  const on = armed.includes(n);
  const next = tapArm(armed, n);
  if (on && armed.length === 1) return { next, label: `Track ${n} is armed. Hold (Shift-click, Shift+Enter) to take it off, leaving none armed` };
  if (on) {
    const rest = armed.filter((x) => x !== n);
    return { next, label: `Track ${n} is armed: tap to arm only ${onWords(next)}, hold (Shift-click, Shift+Enter) to take it off (leaving ${onWords(rest)})` };
  }
  if (!armed.length) return { next, label: `Arm track ${n}: Catch and Rec then use ${onWords(next)}` };
  return { next, label: `Arm only track ${n}: Catch and Rec then use ${onWords(next)}. Hold (Shift-click, Shift+Enter) to arm it as well (${onWords(holdArm(armed, n))})` };
}

/**
 * armedNote is what a hold that added a track to others already armed says,
 * once: that Catch and Rec now record onto all of them (DROP onto the first),
 * and the way back to one -- a tap on any ●, which is what "Only track N"
 * used to be a button for. null for anything else: the first arm, or a track
 * coming off.
 */
export function armedNote(armed, n, next) {
  if (!armed.length || armed.includes(n) || !next.includes(n)) return null;
  return {
    text: `${cap(onWords(next))} are armed: Catch and Rec record onto all of them, DROP onto the first. Tap a ● to arm just that track.`,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
