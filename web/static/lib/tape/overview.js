// The tape's overview: the whole tape in one strip above the lanes, as a
// scrubber. Drag the window to move what the lanes show; tap to move the
// playhead there (to the nearest bar on a tape with bars); double-tap to go
// back to the loop. These are the sums; page.js wires the pointer.
import { nearestBar, xOf } from './geometry.js';
import { withAlpha } from '../theme.js';

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

/** trackColor is track n's colour: --t1 to --t4, round again past four. */
export function trackColor(n, col) {
  const i = ((n - 1) % 4) + 1;
  return col(`--t${i}`, ['#268bd2', '#2aa198', '#b58900', '#d33682'][i - 1]);
}

/**
 * paintTapeOverview draws the whole tape across a W x H strip: what's on
 * each track, the loop in amber, the window `win` ({x, w}, dashed until the
 * view has been moved) when there is one, and the playhead at `heard`.
 * `col(name, fallback)` reads a colour token. The tape page draws it with
 * its lanes' window; Takes and Capture draw it in their bars without one.
 */
export function paintTapeOverview(ctx, W, H, t, heard, { col, win = null, dashed = false } = {}) {
  ctx.clearRect(0, 0, W, H);
  // The whole tape, six minutes: what's recorded, and the loop.
  const all = { from: 0, to: t.length };
  t.tracks.forEach((tr, i) => {
    ctx.fillStyle = withAlpha(trackColor(tr.n, col), 0.75);
    for (const c of tr.clips) {
      const x0 = xOf(c.at, all, W), x1 = xOf(c.at + c.frames, all, W);
      ctx.fillRect(x0, 2 + i * ((H - 4) / t.tracks.length), Math.max(1, x1 - x0), (H - 4) / t.tracks.length - 1);
    }
  });
  if (t.loop.out > t.loop.in) {
    const x0 = xOf(t.loop.in, all, W), x1 = xOf(t.loop.out, all, W);
    ctx.strokeStyle = withAlpha(col('--warn', '#b58900'), t.loop.on ? 1 : 0.4);
    ctx.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
  }
  if (win) {
    // The window: what the lanes show, there to be dragged.
    ctx.fillStyle = withAlpha(col('--well-ink', '#f2e6c8'), 0.1);
    ctx.fillRect(win.x, 0, win.w, H);
    ctx.strokeStyle = col('--well-dim', '#a39d90');
    if (dashed) ctx.setLineDash([3, 2]);
    ctx.strokeRect(win.x + 0.5, 0.5, Math.max(2, win.w) - 1, H - 1);
    ctx.setLineDash([]);
  }
  if (heard != null) {
    ctx.fillStyle = col('--accent', '#cb4b16');
    ctx.fillRect(Math.round(xOf(heard, all, W)), 0, 2, H);
  }
}
