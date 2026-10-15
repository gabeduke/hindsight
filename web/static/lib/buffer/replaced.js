// web/static/lib/buffer/replaced.js
// GRAB's Undo (docs/superpowers/specs/2026-10-15-flow-design.md, decision 9).
// The crate is off the rooms' screens, so the safety net for a GRAB that lands
// on a buffer nobody dropped or kept is a line that says so, with an Undo, and
// the Pi's one replaced grab behind it (internal/tape replaced.go).
//
// Pure words and one note, with no page: the buffer raises the toast
// (buffer.js); a take's GRAB, which opens the Studio at once, leaves the note
// in sessionStorage for the Studio's buffer to read.

import { barsText } from './model.js';
import { lengthWords } from '../rooms/keeplabel.js';

export const KEY = 'hindsight.replaced';

/**
 * replacedWords names the buffer a GRAB replaced -- the Pi's `replaced` -- by
 * its length (in bars when it has a tempo) and where it came from: *the
 * buffer’s 4 BARS from the feed*, *from Tuesday jam* for a take's span.
 * `seconds` is its length, as the Pi answers it.
 */
export function replacedWords(board, seconds) {
  const g = board.grab || {};
  const len = g.bar_frames > 0 ? barsText(board.frames, g.bar_frames).toUpperCase() : lengthWords(seconds);
  const from = g.take ? (g.sources && g.sources[0]) || g.take : 'the feed';
  return `the buffer’s ${len} from ${from}`;
}

/** replacedLine is the toast's sentence about it. */
export function replacedLine(board, seconds) {
  return `Replaced ${replacedWords(board, seconds)}, never dropped or kept`;
}

/**
 * remember leaves the sentence for the buffer made at `by` (its `created`):
 * a take's GRAB goes to the Studio, whose buffer says it. Nothing throws.
 */
export function remember(storage, { by, line }) {
  try { storage?.setItem(KEY, JSON.stringify({ by, line })); } catch { /* no storage: the toast is lost, the Undo is not needed */ }
}

/**
 * recall answers the sentence left for the buffer `created`, once. A note for
 * another buffer is let go unsaid: it was about a grab since replaced.
 */
export function recall(storage, created) {
  let said = '';
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return '';
    const note = JSON.parse(raw);
    if (note && note.by === created && typeof note.line === 'string') said = note.line;
    storage.removeItem(KEY);
  } catch { /* nothing to say */ }
  return said;
}
