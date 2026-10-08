// web/static/lib/tape/range.js
// A range: bars across one or more tracks, drawn on the lanes -- the tape's
// other selection, beside clips (docs/superpowers/specs/
// 2026-10-08-interaction-model-design.md, step 5). Held on an empty part of
// a lane and dragged, or held and dragged on the ruler for every track. The
// action bar's Cut, Copy, Paste, Insert and Delete time act on it. Pure:
// page.js keeps it, draws it and sends its edits.
//
// A range is {from, to, t0, t1}: tape frames from up to to, and tracks t0 to
// t1 (from 1), t0 <= t1.

import { barBeat } from './geometry.js';
import { barOf, spanWords } from './timeedit.js';

/**
 * rangeOf is the range a drag makes, from frame f0 on track t0 to frame f1
 * on track t1, in either order. With a tempo it's whole steps of the snap,
 * `per` to the bar (1 bars, 4 beats, 8 eighths), at least one, from the
 * step at or before the earlier to the one at or after the later; with the
 * snap off (per 0) or no tempo, the frames as they are. Never past the
 * tape's length.
 */
export function rangeOf(grid, per, f0, f1, t0, t1, length) {
  let from = Math.min(f0, f1), to = Math.max(f0, f1);
  if (grid && grid.frames > 0 && grid.bars > 0 && per > 0) {
    const step = grid.frames / grid.bars / per;
    const n0 = Math.max(0, Math.floor(from / step + 1e-9));
    const n1 = Math.max(n0 + 1, Math.ceil(to / step - 1e-9));
    from = Math.round(n0 * step);
    to = Math.round(n1 * step);
  }
  from = Math.max(0, from);
  to = Math.min(length, to);
  return { from, to, t0: Math.min(t0, t1), t1: Math.max(t0, t1) };
}

/** tracksOf lists a range's tracks, in order. */
export function tracksOf(r) {
  return Array.from({ length: r.t1 - r.t0 + 1 }, (_, i) => r.t0 + i);
}

/** covers says whether a range is on track n. */
export const covers = (r, n) => !!r && n >= r.t0 && n <= r.t1;

/** isLoop says whether a range's bars are the loop's. */
export const isLoop = (r, loop) => !!r && !!loop && r.from === loop.in && r.to === loop.out;

/**
 * rangeText names a range for the action bar: "Tracks 2–3 · bars 5–8",
 * "All tracks · bar 1", "Track 2 · 3.2 s".
 */
export function rangeText(r, tracks, grid, sampleRate) {
  const who = r.t0 === 1 && r.t1 === tracks ? 'All tracks' : r.t0 === r.t1 ? `Track ${r.t0}` : `Tracks ${r.t0}–${r.t1}`;
  return `${who} · ${spanText(r.from, r.to, grid, sampleRate)}`;
}

/**
 * spanText is a span as bars ("bars 5–8", "bar 3"); one that isn't whole
 * bars, as its length from where it starts ("2 beats from 3.2"); with no
 * tempo, seconds.
 */
export function spanText(from, to, grid, sampleRate) {
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0)) return `${((to - from) / sampleRate).toFixed(1)} s`;
  const bar = grid.frames / grid.bars;
  const whole = (f) => Math.abs(f / bar - Math.round(f / bar)) * bar <= 1;
  if (!whole(from) || !whole(to)) {
    const beats = Math.round(((to - from) / (bar / 4)) * 10) / 10;
    const len = beats < 4 ? `${beats} beat${beats === 1 ? '' : 's'}` : spanWords(to - from, grid, sampleRate);
    return `${len} from ${barBeat(from, grid)}`;
  }
  const a = barOf(from, grid), b = barOf(Math.max(from, to - 1), grid);
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

/**
 * resize moves one edge of a range ('from' or 'to') to frame f: onto the
 * nearest step of the snap (`per` to the bar, 0 for none), never past the
 * other edge (a step short of it, or a frame with no snap), nor off the tape.
 */
export function resize(r, edge, f, grid, per, length) {
  const snapped = grid && grid.frames > 0 && grid.bars > 0 && per > 0;
  const step = snapped ? grid.frames / grid.bars / per : 1;
  let x = snapped ? Math.round(Math.round(f / step) * step) : Math.round(f);
  x = Math.max(0, Math.min(length, x));
  if (edge === 'from') return { ...r, from: Math.min(x, Math.round(r.to - step)) };
  return { ...r, to: Math.max(x, Math.round(r.from + step)) };
}

/**
 * pasteFits says whether a clipboard of `width` tracks pasted from track t
 * fits on a tape of `tracks`.
 */
export const pasteFits = (t, width, tracks) => width > 0 && t >= 1 && t + width - 1 <= tracks;
