// web/static/lib/tape/tape-menu.js
// The tape's name is its menu (docs/architecture/shell.md, The frame): the tapes
// and New tape; Rename…, Duplicate; the mix, the bounces, the stems and the
// last bounce; Record from this phone…; and Delete this tape…, last, in red,
// asked first in the confirm sheet. ⋯ beside the name held half of this
// once, and the name's menu the other half. What it says, worked out here
// so a test can read it; lib/tape/page.js draws it.

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** partsOf is how many parts (clips) a tape's tracks hold. */
export function partsOf(tape) {
  return (tape?.tracks || []).reduce((n, tr) => n + (tr.clips || []).length, 0);
}

/**
 * barsOf is how many bars the tape's parts run to, from its start: the end
 * of its last part, in whole bars of its grid. null with no grid (a tape
 * with no tempo yet has no bars to count).
 */
export function barsOf(tape) {
  const g = tape?.grid;
  if (!g || !(g.frames > 0) || !(g.bars > 0)) return null;
  let end = 0;
  for (const tr of tape.tracks || []) for (const c of tr.clips || []) end = Math.max(end, c.at + c.frames);
  if (!end) return 0;
  // A part that ends a hair past a bar line (a sample's rounding) is not a
  // bar longer.
  return Math.ceil(end / (g.frames / g.bars) - 1e-6);
}

/**
 * tapeRowSub is the line under a tape's name in the menu, from /api/tapes'
 * summary: its tempo and how many parts it has ("96 BPM · 4 parts").
 */
export function tapeRowSub(t) {
  const parts = t?.clips > 0 ? plural(t.clips, 'part') : 'no parts yet';
  return t?.bpm ? `${Math.round(t.bpm * 10) / 10} BPM · ${parts}` : parts;
}

/**
 * deleteWords is what the confirm sheet says before the loaded tape goes:
 * its name, and what goes with it, so the sheet is never a bare "Delete?".
 * { title, line }: 'Delete “Song sketch”?', '3 parts, 8 bars. This can't
 * be undone.'
 */
export function deleteWords(tape) {
  const name = (tape?.name || '').trim() || 'this tape';
  const parts = partsOf(tape);
  const bars = barsOf(tape);
  const what = !parts ? 'Nothing is on it yet.'
    : `${plural(parts, 'part')}${bars ? `, ${plural(bars, 'bar')}` : ''}.`;
  return { title: `Delete “${name}”?`, line: `${what} This can’t be undone.` };
}

/**
 * afterDelete is the tape to load before the loaded one (`id`) is deleted,
 * the Pi refusing to delete the tape it has loaded: the most recently
 * changed other one (/api/tapes lists them newest first), or null for a new
 * empty tape.
 */
export function afterDelete(tapes, id) {
  const others = (Array.isArray(tapes) ? tapes : []).filter((t) => t && t.id && t.id !== id);
  if (!others.length) return null;
  const at = (t) => { const w = Date.parse(t.modified || t.created || ''); return Number.isNaN(w) ? -Infinity : w; };
  return others.reduce((best, t) => (at(t) > at(best) ? t : best), others[0]).id;
}
