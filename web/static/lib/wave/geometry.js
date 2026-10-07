// web/static/lib/wave/geometry.js
// Pure math for the waveform page. No DOM, no fetch, so it runs under
// `node --test`. Every other wave module imports from here rather than
// re-deriving frame/pixel/tile arithmetic.

export const TILE_BUCKETS = 1024;

// view = { start: first frame at x=0, fpp: frames per CSS pixel, width: CSS px }
export function frameToX(frame, view) { return (frame - view.start) / view.fpp; }
export function xToFrame(x, view) { return Math.round(view.start + x * view.fpp); }

// The finest tile level with at most two buckets per device pixel.
export function levelFor(fpp, dpr) {
  const need = (fpp * dpr) / 2;
  let k = 0;
  while (2 ** k < need) k++;
  return k;
}

export function tileSpan(level) { return TILE_BUCKETS * 2 ** level; }

export function tilesFor(view, level, totalFrames) {
  const span = tileSpan(level);
  const endFrame = Math.min(totalFrames, view.start + view.width * view.fpp) - 1;
  const maxTile = Math.floor(Math.max(0, totalFrames - 1) / span);
  const first = Math.max(0, Math.floor(Math.max(0, view.start) / span) - 1);
  const last = Math.min(maxTile, Math.floor(Math.max(0, endFrame) / span) + 1);
  return { first, last };
}

export function fileLevel(totalFrames) {
  return Math.max(0, Math.ceil(Math.log2(totalFrames / TILE_BUCKETS)));
}

const BEATS_PER_BAR = 4;
const MIN_BEAT_PX = 8;
const MIN_BAR_PX = 4;

export function framesPerBeat({ bpm, sampleRate }) { return (sampleRate * 60) / bpm; }

export function gridLines(view, grid) {
  if (!grid.bpm) return [];
  const fpb = framesPerBeat(grid);
  const beatPx = fpb / view.fpp;
  const barPx = beatPx * BEATS_PER_BAR;
  if (barPx < MIN_BAR_PX) return [];
  const showBeats = beatPx >= MIN_BEAT_PX;
  const step = showBeats ? fpb : fpb * BEATS_PER_BAR;
  const endFrame = view.start + view.width * view.fpp;
  const out = [];
  let n = Math.ceil((view.start - grid.downbeat) / step);
  for (;;) {
    const frame = grid.downbeat + n * step;
    if (frame >= endFrame) break;
    const beatIndex = showBeats ? n : n * BEATS_PER_BAR;
    out.push({ frame: Math.round(frame), bar: ((beatIndex % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0 });
    n++;
  }
  return out;
}

export function barBeat(frame, grid) {
  if (!grid.bpm) return '';
  const fpb = framesPerBeat(grid);
  const beats = Math.floor((frame - grid.downbeat) / fpb);
  const bar = Math.floor(beats / BEATS_PER_BAR);
  const beat = ((beats % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  const barLabel = bar >= 0 ? bar + 1 : bar;
  return `${barLabel}.${beat + 1}`;
}

export function fmtTime(frame, sampleRate) {
  const ms = Math.floor((frame / sampleRate) * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export function fmtRegionLength(region, grid) {
  if (!region) return '';
  const frames = region.end - region.start;
  const seconds = `${(frames / grid.sampleRate).toFixed(1)} s`;
  if (!grid.bpm) return seconds;
  const bars = frames / (framesPerBeat(grid) * BEATS_PER_BAR);
  return `${seconds} · ${bars.toFixed(1)} bars`;
}

export function clampRegion(region, totalFrames, minLen) {
  let start = Math.max(0, Math.round(region.start));
  let end = Math.min(totalFrames, Math.round(region.end));
  if (end - start < minLen) {
    end = start + minLen;
    if (end > totalFrames) {
      end = totalFrames;
      start = Math.max(0, end - minLen);
    }
  }
  return { start, end };
}

export const EDGE_MARGIN_PX = 28;
export const EDGE_MAX_STEP_PX = 14;

// While a selection drags toward a screen edge, the view pans so the region
// can grow past what is visible. The step ramps from 0 at the margin's inner
// edge to maxStep at the canvas edge (and beyond), so a finger resting near
// the edge scrolls gently and one pressed against it scrolls fast.
export function edgeScrollStep(x, width, margin = EDGE_MARGIN_PX, maxStep = EDGE_MAX_STEP_PX) {
  if (x < margin) return -maxStep * Math.min(1, (margin - x) / margin);
  if (x > width - margin) return maxStep * Math.min(1, (x - (width - margin)) / margin);
  return 0;
}

// --- snap, In/Out, flag stepping (the editing model's step 3) ------------

/** The snap settings the Snap chip cycles through, in order. */
export const SNAPS = ['off', 'bar', 'beat', 'eighth'];
export const SNAP_LABELS = { off: 'off', bar: 'bar', beat: 'beat', eighth: '⅛' };

/** snapStep is the grid step for a snap setting, in frames; 0 when off. */
export function snapStep(grid, snap) {
  if (!grid.bpm || !snap || snap === 'off') return 0;
  const fpb = framesPerBeat(grid);
  if (snap === 'bar') return fpb * BEATS_PER_BAR;
  if (snap === 'eighth') return fpb / 2;
  return fpb;
}

/** snapFrame moves a frame to the nearest grid line, counted from the downbeat. */
export function snapFrame(frame, grid, snap) {
  const step = snapStep(grid, snap);
  if (!step) return Math.round(frame);
  return Math.round(grid.downbeat + Math.round((frame - grid.downbeat) / step) * step);
}

/** nudgeStep is how far one nudge moves an edge: one snap step, or 10 ms. */
export function nudgeStep(grid, snap) {
  return Math.round(snapStep(grid, snap) || grid.sampleRate * 0.01);
}

/**
 * nudgeFrame is where one nudge in direction sign (+1 or -1) takes a frame.
 * With snap on it is the next grid line that way, so an edge that sits off
 * the grid lands on it rather than staying off by the same amount; with snap
 * off it is 10 ms.
 */
export function nudgeFrame(frame, sign, grid, snap) {
  const step = snapStep(grid, snap);
  if (!step) return frame + sign * nudgeStep(grid, snap);
  const k = (frame - grid.downbeat) / step;
  // A frame a rounding error from a line counts as on it.
  const near = Math.round(k);
  const on = Math.abs(k - near) * step < 0.5;
  const n = sign > 0 ? (on ? near + 1 : Math.ceil(k)) : (on ? near - 1 : Math.floor(k));
  return Math.round(grid.downbeat + n * step);
}

/**
 * placeDownbeat is where bar 1 may go: a whole frame inside the take. The
 * downbeat is an absolute frame, not an offset within a bar, so it can sit
 * anywhere from the first frame to the last.
 */
export function placeDownbeat(frame, total) {
  return Math.round(Math.min(Math.max(0, total - 1), Math.max(0, frame)));
}

/**
 * nudgeDownbeat is where one nudge in direction sign (+1 or -1) takes bar 1:
 * one snap step (a bar, a beat or an eighth, as In and Out nudges), else
 * 10 ms with Snap off, kept inside the take. It moves by the step rather than
 * to a line: the grid is counted from bar 1, so there is no line to land on.
 */
export function nudgeDownbeat(frame, sign, grid, snap, total) {
  return placeDownbeat(frame + sign * nudgeStep(grid, snap), total);
}

/**
 * adoptDownbeat is the downbeat to show after the Pi's copy of the take
 * arrives: the Pi's, unless a nudge of ours is still waiting to be saved, which
 * is newer than anything the Pi has.
 */
export function adoptDownbeat(served, local, pending) {
  return pending ? local : (served || 0);
}

/**
 * setPoint applies In (edge 'start') or Out (edge 'end') at frame `at`, the
 * OP-1's loop points. With a selection, it moves that end -- unless that would
 * turn the selection inside out, in which case the old selection goes and
 * `at` is held as a pending point. With no selection, a pending point of the
 * other kind completes one; otherwise `at` becomes the pending point. Either
 * order works: In then Out, or Out then In.
 *
 * Returns { selection, pending } where pending is null or { edge, frame }.
 */
export function setPoint(edge, at, { selection, pending }, total, minLen) {
  at = Math.max(0, Math.min(total, Math.round(at)));
  const other = edge === 'start' ? 'end' : 'start';
  const fits = (s, e) => e - s >= minLen;
  if (selection) {
    const s = edge === 'start' ? at : selection.start;
    const e = edge === 'end' ? at : selection.end;
    if (fits(s, e)) return { selection: { start: s, end: e }, pending: null };
    return { selection: null, pending: { edge, frame: at } };
  }
  if (pending && pending.edge === other) {
    const s = edge === 'start' ? at : pending.frame;
    const e = edge === 'end' ? at : pending.frame;
    if (fits(s, e)) return { selection: { start: s, end: e }, pending: null };
  }
  return { selection: null, pending: { edge, frame: at } };
}

/** prevFlag and nextFlag are the flags either side of a frame, or null. */
export function prevFlag(flags, at) {
  let best = null;
  for (const f of flags || []) if (f.frame < at - 1 && (!best || f.frame > best.frame)) best = f;
  return best;
}
export function nextFlag(flags, at) {
  let best = null;
  for (const f of flags || []) if (f.frame > at + 1 && (!best || f.frame < best.frame)) best = f;
  return best;
}

/**
 * landFlag is where ◂⚑ or ⚑▸ lands on a take it went on to: its last flag
 * (which 'last'), else its first; null without flags (the start).
 */
export function landFlag(flags, which) {
  let best = null;
  for (const f of flags || []) {
    if (!best || (which === 'last' ? f.frame > best.frame : f.frame < best.frame)) best = f;
  }
  return best;
}

/** fmtClock is m:ss, for lengths in the header and on buttons. */
export function fmtClock(frames, sampleRate) {
  const s = Math.floor(frames / sampleRate);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** fmtTenths is a point in a take, m:ss.t, as the bar's window reads it. */
export function fmtTenths(frame, sampleRate) {
  const ds = Math.floor((frame / sampleRate) * 10);
  const m = Math.floor(ds / 600);
  const s = Math.floor((ds % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${ds % 10}`;
}

/** fmtPoint is a point in a take, m:ss.cc, for the In and Out readouts. */
export function fmtPoint(frame, sampleRate) {
  const cs = Math.floor((frame / sampleRate) * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/**
 * rulerTicks lays out the ruler: bar numbers with a BPM (every bar, or every
 * 2nd, 4th... when bars are narrow), seconds without one (at 1, 5, 10, 30 or
 * 60 s spacing). Each tick is { frame, label, major }.
 */
export function rulerTicks(view, grid, minLabelPx = 34) {
  const end = view.start + view.width * view.fpp;
  const out = [];
  if (grid.bpm) {
    const bar = framesPerBeat(grid) * BEATS_PER_BAR;
    let every = 1;
    while ((bar * every) / view.fpp < minLabelPx) every *= 2;
    const step = bar * every;
    let n = Math.ceil((view.start - grid.downbeat) / step);
    for (;; n++) {
      const frame = grid.downbeat + n * step;
      if (frame >= end) break;
      const barNo = n * every;
      out.push({ frame: Math.round(frame), label: String(barNo >= 0 ? barNo + 1 : barNo), major: true });
    }
    return out;
  }
  const sr = grid.sampleRate;
  const steps = [1, 5, 10, 30, 60, 300];
  let sec = steps.find((s) => (s * sr) / view.fpp >= minLabelPx) || 600;
  const step = sec * sr;
  for (let n = Math.ceil(view.start / step); n * step < end; n++) {
    const t = n * sec;
    out.push({ frame: n * step, label: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, major: true });
  }
  return out;
}

/**
 * initialSnap is the snap a take page opens with: the one chosen before, if
 * any; else bars for a take with a tempo -- so In and Out land on bar lines
 * and a loop sent to tape is whole bars -- and off for one without.
 */
export function initialSnap(stored, hasBpm) {
  if (SNAPS.includes(stored)) return stored;
  return hasBpm ? 'bar' : 'off';
}

/**
 * snapOnTempo is the snap after the take's tempo arrives later than the page
 * (the measurement lands a few seconds after a save): a take that had no
 * tempo, and whose snap was the default rather than a choice, now starts on
 * bars, as it would have opened.
 */
export function snapOnTempo(snap, chosen, hadBpm, hasBpm) {
  if (chosen || hadBpm || !hasBpm) return snap;
  return initialSnap(null, true);
}

/**
 * tempoPending is whether a take's tempo may still change by itself: the
 * clock's (or none yet) is replaced when the measurement of its audio lands.
 * One that was measured, or typed, is settled.
 */
export function tempoPending(from) {
  return !from || from === 'clock';
}

/** tempoLabel is the take's tempo as its header reads it, and where it came from. */
export function tempoLabel(bpm, from) {
  if (!bpm) return '+ bpm';
  const note = { audio: ' · measured', clock: ' · clock' }[from] || '';
  return `${bpm} bpm${note}`;
}
