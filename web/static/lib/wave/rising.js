// web/static/lib/wave/rising.js
// Rising notes: a keyboard and a row of drum pads at the foot of a canvas,
// and every note that sounds grows *out of* its key and rises away. The
// view shows the past, a bar or two deep -- what was just played -- which is
// what reviewing your own take is for. Geometry up top is pure and tested
// under `node --test`; the RisingNotes class at the bottom owns the canvas.
import { alphaFor, laneColors } from './lanes.js';

export const PX_PER_BEAT = 44;
export const KEY_H = 88;
export const KEY_H_SHORT = 72;   // a short phone screen
export const CHIP_H = 40;
export const KEYS = 48;          // four octaves
export const FALLBACK_BPM = 120; // a take with no tempo scrolls at 2 beats/s
export const MIN_DRUM_PX = 6;
export const GLOW_BEATS = 1;     // a key's colour decays over one beat after note-off
export const PAD_FLASH_BEATS = 0.3;
const MAX_BPM = 400;

export const GM_NAMES = {
  36: ['kick', 'BD'], 38: ['snare', 'SD'], 42: ['closed hat', 'HH'], 46: ['open hat', 'OH'],
  41: ['floor tom', 'T4'], 43: ['floor tom', 'T4'], 45: ['low tom', 'T3'], 47: ['mid tom', 'T2'],
  48: ['mid tom', 'T2'], 50: ['high tom', 'T1'], 49: ['crash', 'CR'], 51: ['ride', 'RD'],
};

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
export function isBlack(p) { return !WHITE.has(((p % 12) + 12) % 12); }

/**
 * Four octaves, C-aligned, around the melodic pitch range. Empty: C2..B5.
 * A range that does not fit from the C at or below lo-2 is centred instead.
 */
export function keyWindow(tracks) {
  let lo = Infinity, hi = -Infinity;
  for (const t of tracks) {
    if (t.kind === 'drums') continue;
    for (const n of t.notes) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
  }
  if (lo === Infinity) return { lo: 36, hi: 83 };
  let klo = Math.floor((lo - 2) / 12) * 12;
  if (hi > klo + KEYS - 1) klo = Math.round(((lo + hi) / 2 - KEYS / 2) / 12) * 12;
  // Stays C-aligned even at the ends: a window may run past pitch 127,
  // and those keys are simply never lit.
  klo = Math.max(0, Math.min(84, klo));
  return { lo: klo, hi: klo + KEYS - 1 };
}

/**
 * Key rectangles across `width` CSS px, x from 0. Whites are equal columns;
 * blacks sit over the join at 62% width. xFor clamps to the edge keys so an
 * out-of-window pitch still lands somewhere visible.
 */
export function keyLayout(lo, width, keys = KEYS) {
  const hi = lo + keys - 1;
  let nWhite = 0;
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) nWhite++;
  const ww = width / Math.max(1, nWhite);
  const bw = ww * 0.62;
  const whites = [], blacks = [], byPitch = new Map();
  let i = 0;
  for (let p = lo; p <= hi; p++) {
    if (!isBlack(p)) {
      const k = { p, x: i * ww, w: ww, black: false };
      whites.push(k); byPitch.set(p, k); i++;
    } else {
      const k = { p, x: Math.max(0, i * ww - bw / 2), w: bw, black: true };
      blacks.push(k); byPitch.set(p, k);
    }
  }
  const xFor = (p) => byPitch.get(Math.max(lo, Math.min(hi, p)));
  return { lo, hi, whites, blacks, ww, xFor };
}

/**
 * One pad per distinct drum pitch, the `cap` most-played kept, ascending
 * left to right. colFor maps any pitch to the nearest kept pad's column.
 */
export function padLayout(tracks, cap = 8) {
  const counts = new Map();
  for (const t of tracks) {
    if (t.kind !== 'drums') continue;
    for (const n of t.notes) counts.set(n.p, (counts.get(n.p) || 0) + 1);
  }
  const kept = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, cap)
    .map(([p]) => p)
    .sort((a, b) => a - b);
  const pads = kept.map((p, col) => {
    const gm = GM_NAMES[p];
    return { p, label: gm ? gm[0] : `#${p}`, short: gm ? gm[1] : String(p), col };
  });
  const colFor = (p) => {
    if (!kept.length) return -1;
    let best = 0;
    for (let i = 1; i < kept.length; i++) if (Math.abs(kept[i] - p) < Math.abs(kept[best] - p)) best = i;
    return best;
  };
  return { pads, colFor };
}

/** Each pad's width: a fifth of the canvas shared out, never under 12 or over 32. */
export function padWidth(width, npads) {
  if (!npads) return 0;
  return Math.max(12, Math.min(32, Math.floor((0.2 * width) / npads)));
}

/** The tempo in force at `frame`: the last entry at or before it, the first before any. */
export function bpmAt(tempo, frame, fallback = FALLBACK_BPM) {
  if (!tempo || !tempo.length) return fallback;
  let bpm = tempo[0].bpm;
  for (const t of tempo) { if (t.frame <= frame) bpm = t.bpm; else break; }
  if (!(bpm > 0) || bpm > MAX_BPM) return fallback;
  return bpm;
}
