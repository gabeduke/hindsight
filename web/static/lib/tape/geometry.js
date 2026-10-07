// web/static/lib/tape/geometry.js
// The tape page's pure parts: what span of the tape the lanes show, where a
// frame is on them, the bar lines, and how the readout reads. Node-tested.

/**
 * viewRange is the span of tape frames the lanes show: the loop while there
 * is one, else everything recorded (at least 30 s), so a tape built from a
 * loop reads as that loop.
 */
export function viewRange(tape) {
  const sr = tape.sample_rate || 48000;
  const l = tape.loop || {};
  if (l.out > l.in) return { from: l.in, to: l.out };
  let end = 0;
  for (const t of tape.tracks || []) for (const c of t.clips || []) end = Math.max(end, c.at + c.frames);
  return { from: 0, to: Math.max(end, 30 * sr) };
}

/**
 * editView is what the lanes and the ruler show: with a loop on the grid,
 * the loop and a bar either side, so the loop can be dragged a bar wider;
 * otherwise viewRange's.
 */
export function editView(tape) {
  const g = tape.grid;
  const l = tape.loop || {};
  if (!g || !(g.frames > 0) || !(l.out > l.in)) return viewRange(tape);
  const bar = g.frames / g.bars;
  return { from: Math.max(0, Math.round(l.in - bar)), to: Math.round(l.out + bar) };
}

// fitView puts a span of `span` frames starting at `from` on the tape:
// whole frames, no wider than the tape, never off either end.
function fitView(from, span, length) {
  const s = Math.round(Math.min(span, length));
  const f = Math.round(Math.min(Math.max(0, from), length - s));
  return { from: f, to: f + s };
}

/**
 * zoomView is a view zoomed by factor (below 1 is closer) about the anchor
 * frame, which stays where it was across the view: what a pinch does. No
 * closer than minSpan frames, no wider than the tape.
 */
export function zoomView(view, anchor, factor, length, minSpan) {
  const span = view.to - view.from;
  const next = Math.max(minSpan, span * factor);
  const k = (anchor - view.from) / span;
  return fitView(anchor - k * next, next, length);
}

/** panView is a view moved df frames along the tape, stopping at its ends. */
export function panView(view, df, length) {
  return fitView(view.from + df, view.to - view.from, length);
}

/**
 * followView pages a view to a playhead that has left it, putting the
 * playhead a tenth of the way in; a view it's still in comes back as is.
 */
export function followView(view, pos, length) {
  if (pos >= view.from && pos <= view.to) return view;
  const span = view.to - view.from;
  return fitView(pos - span / 10, span, length);
}

/**
 * barSpan turns a drag across the ruler, between two tape frames in either
 * order, into whole bars: from the bar line at or before the earlier to the
 * one at or after the later, at least one bar.
 */
export function barSpan(grid, a, b) {
  const bar = grid.frames / grid.bars;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const n0 = Math.max(0, Math.floor(lo / bar + 1e-9));
  const n1 = Math.max(n0 + 1, Math.ceil(hi / bar - 1e-9));
  return { from: Math.round(n0 * bar), to: Math.round(n1 * bar) };
}

/** nearestBar is the bar line nearest a tape frame. */
export function nearestBar(grid, f) {
  const bar = grid.frames / grid.bars;
  return Math.round(Math.max(0, Math.round(f / bar)) * bar);
}

/** xOf is where a tape frame sits across `width` pixels of a view. */
export function xOf(frame, view, width) {
  return ((frame - view.from) / (view.to - view.from)) * width;
}

/** frameAt is the tape frame at pixel x. */
export function frameAt(x, view, width) {
  return Math.round(view.from + (x / width) * (view.to - view.from));
}

/** barLines lists the bar lines inside a view: [{frame, n}] with n from 1. */
export function barLines(grid, view) {
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0)) return [];
  const bar = grid.frames / grid.bars;
  const out = [];
  for (let n = Math.ceil(view.from / bar - 1e-9); ; n++) {
    const frame = Math.round(n * bar) || 0; // never -0
    if (frame > view.to) break;
    out.push({ frame, n: n + 1 });
    if (out.length > 512) break;
  }
  return out;
}

/** bpm is the tempo a grid implies. */
export function bpm(grid, sampleRate) {
  return (grid.bars * 4 * 60 * sampleRate) / grid.frames;
}

/** barBeat reads a tape frame as "bar.beat", from 1, on a grid. */
export function barBeat(frame, grid) {
  if (!grid) return '';
  const beat = grid.frames / grid.bars / 4;
  const b = Math.floor(frame / beat + 1e-9);
  return `${Math.floor(b / 4) + 1}.${(b % 4) + 1}`;
}

/** fmtSecs reads frames as m:ss.t. */
export function fmtSecs(frames, sampleRate) {
  const s = Math.max(0, frames / sampleRate);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * clipBuckets is the span of a pool file's whole-file peaks a clip plays:
 * [b0, b1) of pd.buckets, from the clip's src and frames.
 */
export function clipBuckets(clip, pd) {
  const fileFrames = Math.round(pd.duration * pd.sample_rate);
  if (!(fileFrames > 0)) return [0, 0];
  const b0 = Math.floor((clip.src / fileFrames) * pd.buckets);
  const b1 = Math.max(b0 + 1, Math.ceil(((clip.src + clip.frames) / fileFrames) * pd.buckets));
  return [Math.min(b0, pd.buckets), Math.min(b1, pd.buckets)];
}

/** SNAPS are what a slid clip can snap to, and how many to a bar. */
export const SNAPS = [
  { id: 'bar', label: 'Bar', per: 1 },
  { id: 'beat', label: 'Beat', per: 4 },
  { id: '8th', label: '⅛', per: 8 },
  { id: 'off', label: 'Off', per: 0 },
];

/**
 * snapFrame is the grid line nearest a tape frame -- a bar, beat or eighth
 * line, placed as the Pi places them (n × the exact length, rounded) -- or
 * the frame itself with the snap off or no grid. Never before 0.
 */
export function snapFrame(grid, f, snap) {
  const s = SNAPS.find((x) => x.id === snap);
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0) || !s || !s.per) return Math.max(0, Math.round(f));
  const step = grid.frames / grid.bars / s.per;
  return Math.round(Math.max(0, Math.round(f / step)) * step);
}

/**
 * slideTo is where a clip starting at `at` lands when dragged df frames. On
 * a line of the snap's grid, it lands on the line nearest; off the grid --
 * a free catch, say -- it moves by whole steps, keeping its offset. Never
 * before 0.
 */
export function slideTo(grid, at, df, snap) {
  const s = SNAPS.find((x) => x.id === snap);
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0) || !s || !s.per) return Math.max(0, Math.round(at + df));
  const step = grid.frames / grid.bars / s.per;
  const n = Math.round(at / step);
  if (Math.abs(Math.round(n * step) - at) <= 1) return snapFrame(grid, at + df, snap);
  const k = Math.round(df / step);
  let to = at + Math.round(k * step);
  while (to < 0) to += Math.round(step);
  return to;
}

/** nudgeFrames is how far from its `at` a clip sounds, as the Pi rounds it. */
export function nudgeFrames(clip, sampleRate) {
  return Math.round(((clip.nudge_ms || 0) / 1000) * sampleRate);
}

/**
 * splitAt is how many clips on a track a split at pos would cut: those that
 * sound across it, on any layer (a nudged clip is cut where it's heard).
 */
export function splitAt(track, pos, sampleRate = 48000) {
  return (track.clips || []).filter((c) => {
    const at = pos - nudgeFrames(c, sampleRate);
    return c.at < at && at < c.at + c.frames;
  }).length;
}

/**
 * joinPartner is the clip a join would merge this one with: its neighbour
 * on its layer -- the next, or else the one before -- when one carries
 * straight on from the other in the same recording, at the same level and
 * nudge: what a split made. null if none.
 */
export function joinPartner(track, clip) {
  const clips = track.clips || [];
  const same = (a, b) => b.file === a.file && b.src === a.src + a.frames
    && (b.gain_db || 0) === (a.gain_db || 0) && (b.nudge_ms || 0) === (a.nudge_ms || 0);
  const next = clips.find((o) => o.layer === clip.layer && o.at === clip.at + clip.frames);
  if (next) return same(clip, next) ? next : null;
  const prev = clips.find((o) => o.layer === clip.layer && o.at + o.frames === clip.at);
  return prev && same(prev, clip) ? prev : null;
}

/** fitsDoubled says whether the loop, doubled, still ends on the tape. */
export function fitsDoubled(tape) {
  const l = tape.loop || {};
  return l.out > l.in && l.out + (l.out - l.in) <= tape.length;
}

/**
 * levelAt is what a track has under the playhead, in dBFS, for the meter
 * bridge: the loudest clip sounding at tape frame `frame` (where its nudge
 * puts it), read from its pool file's peaks and taken through the clip's
 * and the track's gain. A muted track, a track silenced by another's solo,
 * no clip there, or peaks not loaded yet all read as -Infinity: the stop.
 * peaksOf(file) gives a file's PeakData, or anything else while it loads.
 */
export function levelAt(track, frame, peaksOf, sampleRate, anySolo = false) {
  if (track.mute || (anySolo && !track.solo)) return -Infinity;
  let best = 0;
  for (const c of track.clips || []) {
    const from = c.at + nudgeFrames(c, sampleRate);
    if (frame < from || frame >= from + c.frames) continue;
    const pd = peaksOf(c.file);
    if (!pd || !pd.data || !(pd.buckets > 0)) continue;
    const fileFrames = Math.round(pd.duration * pd.sample_rate);
    if (!(fileFrames > 0)) continue;
    const b = Math.min(pd.buckets - 1, Math.floor(((c.src + frame - from) / fileFrames) * pd.buckets));
    let amp = 0;
    for (const d of pd.data) amp = Math.max(amp, Math.abs(d[b * 2]), Math.abs(d[b * 2 + 1]));
    const lin = amp * Math.pow(10, (c.gain_db || 0) / 20);
    if (lin > best) best = lin;
  }
  if (!(best > 0)) return -Infinity;
  return 20 * Math.log10(best) + (track.gain_db || 0);
}

// How much audio a pool file keeps past a clip for the crossfades
// (internal/tape OverhangSeconds).
export const OVERHANG_SECONDS = 0.010;

/**
 * trimBounds is how far a clip's edge ('in', its start; 'out', its end) can
 * be dragged, as the Pi clamps a trim (internal/tape edit.go, State.trim):
 * the In edge back to where its file still has the 10 ms overhang before it
 * (or where it already starts, if earlier) and the clip before it on its
 * layer, and to within 10 ms of its end; the Out edge on to where its file
 * still has the overhang after it (or where it already ends, if later) and
 * the clip after it, and to 10 ms past its start. With fileFrames unknown (the
 * file's peaks not loaded yet) only the neighbours and the tape bound it.
 * Answers {lo, hi} in tape frames, or null when there's no room at all.
 */
export function trimBounds(clip, edge, track, { fileFrames, length, sampleRate }) {
  const over = Math.round(OVERHANG_SECONDS * sampleRate);
  const minLen = Math.max(1, over);
  const end = clip.at + clip.frames;
  let before = 0, after = length;
  for (const o of track?.clips || []) {
    if (o.id === clip.id || o.layer !== clip.layer) continue;
    const oEnd = o.at + o.frames;
    if (oEnd <= clip.at && oEnd > before) before = oEnd;
    if (o.at >= end && o.at < after) after = o.at;
  }
  const known = fileFrames > 0;
  let lo, hi;
  if (edge === 'in') {
    lo = known ? Math.max(before, clip.at - clip.src + Math.min(clip.src, over)) : before;
    hi = end - minLen;
  } else {
    lo = clip.at + minLen;
    hi = known ? Math.min(after, clip.at + Math.max(clip.src + clip.frames, fileFrames - over) - clip.src) : after;
  }
  return hi < lo ? null : { lo, hi };
}

/**
 * trimTo is where an edge that started at edge0 lands, dragged df frames:
 * on the snap's grid (or anywhere when free), then held inside bounds.
 * limited says the drag is pushing against a bound.
 */
export function trimTo(edge0, df, bounds, grid, snap, free) {
  const raw = edge0 + df;
  const want = free ? Math.max(0, Math.round(raw)) : snapFrame(grid, raw, snap);
  const at = Math.min(Math.max(want, bounds.lo), bounds.hi);
  return { at, limited: want !== at };
}

/** trimmed is a clip as it would be with its edge at `at`. */
export function trimmed(clip, edge, at) {
  if (edge === 'in') {
    const d = at - clip.at;
    return { ...clip, at, src: clip.src + d, frames: clip.frames - d };
  }
  return { ...clip, frames: at - clip.at };
}

// The most copies one drag of a clip's ⟳ corner lays (internal/tape MaxRepeat).
export const MAX_REPEAT = 64;

/** repeatRoom is how many copies of a clip fit end to end before the tape's end. */
export function repeatRoom(clip, length) {
  return Math.max(0, Math.min(MAX_REPEAT, Math.floor((length - clip.at - clip.frames) / clip.frames)));
}

/**
 * repeatCount is how many copies a drag of df frames on the ⟳ corner lays:
 * one more each time the drag passes half a copy, none dragged back, and no
 * more than max.
 */
export function repeatCount(df, frames, max) {
  if (!(frames > 0)) return 0;
  return Math.max(0, Math.min(max, Math.round(df / frames)));
}
