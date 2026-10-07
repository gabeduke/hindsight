// web/static/lib/tape/sections.js
// Sections on the tape (internal/tape/sections.go): named spans above the
// ruler. Pure: which section, or which edge of one, is under a point; what a
// new one is called; and whether one is the loop now. page.js draws them and
// sends the edits.

import { xOf } from './geometry.js';

// The names a section offers first; any other can be typed.
export const SECTION_NAMES = ['Intro', 'Verse', 'Chorus', 'Drop', 'Bridge', 'Outro'];

// The colours a section can wear (internal/tape SectionColors), as the theme
// tokens they're drawn in, with fallbacks.
// The first is a section's colour until it's given another ("").
export const SECTION_COLORS = [
  { id: 'blue', token: '--t1', fallback: '#3a96dd' },
  { id: 'amber', token: '--warn', fallback: '#d99a0a' },
  { id: 'red', token: '--rec', fallback: '#dc322f' },
  { id: 'green', token: '--go', fallback: '#6faa32' },
  { id: 'violet', token: '--violet', fallback: '#8a6fd1' },
  { id: 'cyan', token: '--t2', fallback: '#2fb3a7' },
];

export const EDGE_HIT_PX = 10; // a section's edge, to drag

/** colorOf is a section's colour entry ("" is the first). */
export function colorOf(sc) {
  return SECTION_COLORS.find((c) => c.id === sc.color) || SECTION_COLORS[0];
}

/**
 * sectionHit is what's at pixel x on the strip: {section, zone} with zone
 * 'in' or 'out' within EDGE_HIT_PX of an edge (on a section wide enough to
 * keep a body between them) or 'body'; null on an empty stretch.
 */
export function sectionHit(sections, x, view, width) {
  for (const sc of sections || []) {
    const x0 = xOf(sc.at, view, width), x1 = xOf(sc.end, view, width);
    if (x < x0 - EDGE_HIT_PX / 2 || x > x1 + EDGE_HIT_PX / 2) continue;
    if (x1 - x0 >= 3 * EDGE_HIT_PX) {
      if (Math.abs(x - x0) <= EDGE_HIT_PX) return { section: sc, zone: 'in' };
      if (Math.abs(x - x1) <= EDGE_HIT_PX) return { section: sc, zone: 'out' };
    }
    if (x >= x0 && x <= x1) return { section: sc, zone: 'body' };
  }
  return null;
}

/** newName is a name for a new section: the first offered one not yet used. */
export function newName(sections) {
  const used = new Set((sections || []).map((s) => s.name));
  return SECTION_NAMES.find((n) => !used.has(n)) || `Section ${(sections || []).length + 1}`;
}

/** isLooped says whether a section is the loop's span now. */
export function isLooped(sc, loop) {
  return !!loop && loop.in === sc.at && loop.out === sc.end;
}

/**
 * barsText reads a section's span as bars, from 1 ("bars 5–8", "bar 3"), or
 * seconds with no tempo.
 */
export function barsText(sc, grid, sampleRate) {
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0)) return `${((sc.end - sc.at) / sampleRate).toFixed(1)} s`;
  const bar = grid.frames / grid.bars;
  const a = Math.round(sc.at / bar) + 1, b = Math.round(sc.end / bar);
  return a >= b ? `bar ${a}` : `bars ${a}–${b}`;
}

// A bar line as the Pi places it (internal/tape Grid.BarStart): whole
// frames, rounded, however many frames a bar is.
const barLen = (grid) => (grid && grid.frames > 0 && grid.bars > 0 ? grid.frames / grid.bars : 0);
const barStart = (grid, n) => Math.round(n * barLen(grid));

/**
 * makeSpan is what a hold and drag on the strip from frame a to b makes: the
 * whole bars it crosses with a tempo, else the frames; null for nothing.
 */
export function makeSpan(a, b, grid) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const bar = barLen(grid);
  if (!bar) return hi - lo >= 1 ? { from: Math.round(lo), to: Math.round(hi) } : null;
  const from = barStart(grid, Math.floor(lo / bar));
  let to = barStart(grid, Math.ceil(hi / bar));
  if (to <= from) to = barStart(grid, Math.floor(lo / bar) + 1);
  return { from, to };
}

/**
 * edgeTo is where a section's 'in' or 'out' edge lands, dragged to frame f:
 * on the nearest bar line with a tempo (whole frames, as the Pi keeps them),
 * at least a bar (or a frame) from the other edge, and no further than the
 * sections beside it or the last bar line on the tape. Answers {at, end}.
 */
export function edgeTo(sc, edge, f, sections, grid, length) {
  const bar = barLen(grid);
  const snap = (x) => (bar ? barStart(grid, Math.round(x / bar)) : Math.round(x));
  const others = (sections || []).filter((x) => x.id !== sc.id);
  const before = Math.max(0, ...others.filter((x) => x.end <= sc.at).map((x) => x.end));
  const last = bar ? barStart(grid, Math.floor(length / bar)) : length;
  const after = Math.min(last, ...others.filter((x) => x.at >= sc.end).map((x) => x.at));
  if (edge === 'in') {
    const most = bar ? barStart(grid, Math.round(sc.end / bar) - 1) : sc.end - 1;
    return { at: Math.max(before, Math.min(snap(f), most)), end: sc.end };
  }
  const least = bar ? barStart(grid, Math.round(sc.at / bar) + 1) : sc.at + 1;
  return { at: sc.at, end: Math.min(after, Math.max(snap(f), least)) };
}
