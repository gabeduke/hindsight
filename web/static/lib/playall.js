// web/static/lib/playall.js
// Play all, on the takes page (step C2,
// docs/superpowers/specs/2026-10-07-play-all-design.md): the takes shown, in
// the list's order, one after another through the bar, each from its
// selection's In to its Out, or the whole take without one. Pure: what to
// play and what comes next; lib/shelf-page.js plays it.

/** spanOf is the part of take t that Play all plays, in seconds. */
export function spanOf(t) {
  const sr = t.sample_rate || 48000;
  const len = t.duration_seconds || 0;
  const tr = t.trim;
  if (tr && tr.end_frame > tr.start_frame) return { from: tr.start_frame / sr, to: Math.min(len || Infinity, tr.end_frame / sr) };
  return { from: 0, to: len };
}

/** firstOf is where Play all starts: the picked take if it's shown, else the first. */
export function firstOf(order, picked) {
  return order.includes(picked) ? picked : order[0] ?? null;
}

/** nextOf is the take after name in order, or null at the end or if it's gone. */
export function nextOf(order, name) {
  const i = order.indexOf(name);
  return i >= 0 ? order[i + 1] ?? null : null;
}

/**
 * atEnd says whether a take playing at `time` (seconds) has done its part:
 * its Out reached, within a frame or so, or the audio ended.
 */
export function atEnd(span, time, ended) {
  return ended || time >= span.to - 0.02;
}
