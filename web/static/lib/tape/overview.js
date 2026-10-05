// The tape's overview: the whole tape in one strip above the lanes, as a
// scrubber. Drag the window to move what the lanes show; tap to move the
// playhead there (to the nearest bar on a tape with bars); double-tap to go
// back to the loop. These are the sums; page.js wires the pointer.
import { nearestBar } from './geometry.js';

export const OVERVIEW_MIN_WINDOW_PX = 24;
const GRAB_SLOP = 8;    // px either side of the window that still grab it
const DOUBLE_MS = 300;
const DOUBLE_PX = 24;

/** overviewWindow is where a view sits across a strip `width` px wide. */
export function overviewWindow(view, length, width) {
  let w = Math.max(OVERVIEW_MIN_WINDOW_PX, ((view.to - view.from) / length) * width);
  w = Math.min(w, width);
  const x = Math.max(0, Math.min(width - w, (view.from / length) * width));
  return { x, w };
}

/** onWindow says whether a press at x grabs the window. */
export function onWindow(x, win) {
  return x >= win.x - GRAB_SLOP && x <= win.x + win.w + GRAB_SLOP;
}

/**
 * dragTo is the view with the window dragged so the point grabbed `grab` px
 * into it is under x; the span stays, and the view stops at the tape's ends.
 */
export function dragTo(x, grab, view, length, width) {
  const span = view.to - view.from;
  const from = Math.round(((x - grab) / width) * length);
  const f = Math.max(0, Math.min(length - span, from));
  return { from: f, to: f + span };
}

/** tapAt is the playhead a tap at x asks for. */
export function tapAt(x, length, width, grid) {
  const f = Math.round((Math.max(0, Math.min(width, x)) / width) * length);
  return grid && grid.frames > 0 && grid.bars > 0 ? Math.min(length, nearestBar(grid, f)) : f;
}

/** isDoubleTap: the second of two taps close in time and place. */
export function isDoubleTap(prev, tap) {
  return !!prev && tap.t - prev.t <= DOUBLE_MS && Math.abs(tap.x - prev.x) <= DOUBLE_PX;
}
