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
