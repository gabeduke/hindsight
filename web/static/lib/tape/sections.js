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
export const SECTION_COLORS = [
  { id: 'amber', token: '--warn', fallback: '#d99a0a' },
  { id: 'red', token: '--rec', fallback: '#dc322f' },
  { id: 'green', token: '--sel', fallback: '#4ebeb4' },
  { id: 'blue', token: '--t1', fallback: '#3a96dd' },
  { id: 'violet', token: '--t4', fallback: '#e0559a' },
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
