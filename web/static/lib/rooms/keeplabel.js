// web/static/lib/rooms/keeplabel.js
// KEEP says what it keeps (docs/superpowers/specs/2026-10-15-flow-design.md,
// "The Studio: one selection, two verbs"): KEEP 2m on the feed's key, KEEP 4
// BARS on the buffer's, KEEP 30s on the instrument's pad, and the length of
// a span held on the ribbon. Pure: the words, and nothing that draws them.

import { barsText } from '../buffer/model.js';

/**
 * lengthWords is a length as a key says it: 30s, 2m, 1m30s, 3.6s. Nothing
 * for no length.
 */
export function lengthWords(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rest = s % 60;
  return rest ? `${m}m${rest}s` : `${m}m`;
}

/** keepLabel is the key's whole text: KEEP 2m, or the bare word with nothing to name. */
export const keepLabel = (length) => (length ? `KEEP ${length}` : 'KEEP');

/**
 * feedKeepLength is what the feed's KEEP keeps: the chosen tier, or, at 0,
 * the whole ring (ringSeconds long).
 */
export function feedKeepLength(seconds, ringSeconds) {
  return lengthWords(seconds === 0 ? ringSeconds : seconds);
}

/**
 * bufferKeepLength is what the buffer's KEEP keeps: its window, as 4 BARS
 * when the tape has a tempo (barFrames the bar's length), else in seconds.
 */
export function bufferKeepLength({ frames, barFrames = 0, sampleRate = 48000 }) {
  if (!(frames > 0)) return '';
  if (barFrames > 0) return barsText(frames, barFrames).toUpperCase();
  return lengthWords(frames / sampleRate);
}

/** selectionKeepLength is what KEEP keeps of a span held on the ribbon. */
export const selectionKeepLength = (seconds) => lengthWords(seconds);

/**
 * keptByK is what the K key, and the instrument's KEEP pad, will keep: the
 * open buffer (it claims K while it is open), else the feed.
 */
export function keptByK({ feed = '', buffer = '' } = {}) {
  return buffer || feed || '';
}
