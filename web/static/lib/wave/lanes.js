// MIDI lanes under the waveform: one per (device, channel) track of the
// take's .mid, painted from the wave view's own viewport so a note sits
// exactly under its audio at every zoom. The geometry here is pure and
// tested; the Lanes class at the bottom owns the DOM and the canvases.
import { frameToX, gridLines } from './geometry.js';

export const LANE_H = { notes: 56, drums: 36, collapsed: 18 };
export const DRUM_COLOR = '#fbbf24';
export const MELODIC_COLORS = ['#34d399', '#3b9dd4', '#f87171', '#a78bfa'];
const MIN_ROW_PX = 4;
const MIN_NOTE_PX = 2;
const DRUM_TICK_PX = 2;

export function alphaFor(v) { return 0.3 + 0.7 * (v / 127); }

/** Drums are always amber; melodic tracks take the palette in order. */
export function laneColors(tracks) {
  let m = 0;
  return tracks.map((t) => (t.kind === 'drums' ? DRUM_COLOR : MELODIC_COLORS[m++ % MELODIC_COLORS.length]));
}

/**
 * Where the rows are for one lane. Melodic: one row per semitone across the
 * track's pitch range, hi at the top, C rows tinted. Drums: one row per
 * distinct pitch, lowest at the bottom. Collapsed: a bare strip.
 */
export function laneLayout(track, collapsed) {
  if (collapsed) return { h: LANE_H.collapsed, rows: [], rowH: LANE_H.collapsed, lo: 0, hi: 0, pitchRow: null };
  const ps = track.notes.map((n) => n.p);
  if (track.kind === 'drums') {
    const distinct = [...new Set(ps)].sort((a, b) => a - b);
    const n = Math.max(1, distinct.length);
    const rowH = LANE_H.drums / n;
    const pitchRow = new Map();
    // lowest pitch -> bottom row (index n-1)
    distinct.forEach((p, i) => pitchRow.set(p, n - 1 - i));
    const rows = Array.from({ length: n }, (_, i) => ({ top: i * rowH, h: rowH, tint: i % 2 === 1 }));
    return { h: LANE_H.drums, rows, rowH, lo: distinct[0] ?? 0, hi: distinct[n - 1] ?? 0, pitchRow };
  }
  const lo = ps.length ? Math.min(...ps) : 60;
  const hi = ps.length ? Math.max(...ps) : 60;
  const span = hi - lo + 1;
  const rowH = Math.max(MIN_ROW_PX, LANE_H.notes / span);
  const rows = [];
  for (let p = hi; p >= lo; p--) rows.push({ top: (hi - p) * rowH, h: rowH, tint: p % 12 === 0 });
  return { h: LANE_H.notes, rows, rowH, lo, hi, pitchRow: null };
}

/** Rects for the notes inside the view, in CSS px of the lane body. */
export function noteRects(track, layout, view) {
  const first = view.start;
  const last = view.start + view.width * view.fpp;
  const out = [];
  const collapsed = layout.rows.length === 0 && layout.pitchRow === null && layout.h === LANE_H.collapsed;
  for (const n of track.notes) {
    if (n.e < first || n.s > last) continue;
    const x = frameToX(n.s, view);
    const alpha = alphaFor(n.v);
    if (collapsed) {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: 0.15 * layout.h, h: 0.7 * layout.h, alpha });
    } else if (track.kind === 'drums') {
      const row = layout.pitchRow.get(n.p) ?? layout.rows.length - 1;
      const floor = (row + 1) * layout.rowH;
      const h = layout.rowH * (0.25 + 0.7 * (n.v / 127));
      out.push({ x, w: DRUM_TICK_PX, y: floor - h, h, alpha });
    } else {
      out.push({ x, w: Math.max(MIN_NOTE_PX, frameToX(n.e, view) - x), y: (layout.hi - n.p) * layout.rowH, h: layout.rowH, alpha });
    }
  }
  return out;
}
