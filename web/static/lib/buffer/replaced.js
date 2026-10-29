// web/static/lib/buffer/replaced.js
// GRAB's Undo (docs/decisions/0009-the-crate-leaves-the-screen.md).
// The crate is off the rooms' screens, so the safety net for a GRAB -- or a
// range's Cut or Copy, or an Undo of a toss -- that lands on a buffer nobody
// dropped or kept is a line that says so, with an Undo, and the Pi's one
// replaced grab behind it (internal/tape replaced.go).
//
// Pure words and one note, with no page: the buffer and the tape page raise
// the toast; a take's GRAB, which opens the Studio at once, leaves the note in
// sessionStorage for the Studio's buffer to read.

import { barsText, grabTitle } from './model.js';
import { lengthWords } from '../rooms/keeplabel.js';

export const KEY = 'hindsight.replaced';
/** NOTE_MS is how long a take's note is good for: it is read by the next page. */
export const NOTE_MS = 60_000;
const UNDO_MS = 10000; // an Undo stays longer than a toast's usual eight seconds

/**
 * replacedWords names the buffer that was replaced -- the Pi's `replaced` --
 * by its length (in bars when it has a tempo) and where it came from: *the
 * buffer’s 4 BARS from the feed*, *from Tuesday jam* for a take's span, *from
 * Song one, bars 1–4* for a range's copy. `seconds` is its length, as the Pi
 * answers it.
 */
export function replacedWords(board, seconds) {
  const g = board.grab || {};
  const len = g.bar_frames > 0 ? barsText(board.frames, g.bar_frames).toUpperCase() : lengthWords(seconds);
  const from = board.grab
    ? (g.take ? grabTitle(g) : 'the feed')
    : board.from || 'a copy';
  return `the buffer’s ${len} from ${from}`;
}

/** replacedLine is the toast's sentence about it. */
export function replacedLine(board, seconds) {
  return `Replaced ${replacedWords(board, seconds)}, never dropped or kept`;
}

/**
 * editBody is a tape edit's body as the page sends it. A Cut or Copy (lift,
 * copy) says `no_crate`: the buffer it replaces, if nobody used it, is held
 * for Undo and not put in the crate, which nothing shows.
 */
export function editBody(op, extra) {
  return op === 'lift' || op === 'copy' ? { ...extra, no_crate: true } : { ...extra };
}

let current = null;
/**
 * raiseUndo shows the line with an Undo, and takes the one before it away: only
 * the newest GRAB's Undo is on screen, so a tap on an older one can't be the
 * one that fails. `toast` is the page's (it hands back the element, with a
 * dismiss()); `run` is the Undo.
 */
export function raiseUndo(toast, line, kind, run) {
  current?.dismiss?.();
  current = toast(line, kind, { ms: UNDO_MS, action: { label: 'Undo', run } });
  return current;
}

/**
 * undoWords is what a failed Undo says. The Pi's refusals (409) are written to
 * be read as they are -- *Already dropped or kept — undo the drop instead* --
 * and anything else is prefixed.
 */
export function undoWords(e) {
  return e && e.status === 409 ? e.message : `Could not undo the grab: ${e && e.message}`;
}

/**
 * remember leaves the sentence for the buffer made at `by` (its `created`):
 * a take's GRAB goes to the Studio, whose buffer says it. Nothing throws.
 */
export function remember(storage, { by, line }, now = Date.now()) {
  try { storage?.setItem(KEY, JSON.stringify({ by, line, at: now })); } catch { /* no storage: the toast is lost, the Undo is not needed */ }
}

/**
 * recall answers the sentence left for the buffer `created`, once, if it is
 * under a minute old. A note for another buffer, or a stale one, is let go
 * unsaid: it was about a grab since replaced, or about a page never opened.
 */
export function recall(storage, created, now = Date.now()) {
  let said = '';
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return '';
    const note = JSON.parse(raw);
    if (note && note.by === created && typeof note.line === 'string' && now - note.at <= NOTE_MS) said = note.line;
    storage.removeItem(KEY);
  } catch { /* nothing to say */ }
  return said;
}

/** forget lets the note go: a page that is not the Studio opened instead. */
export function forget(storage) {
  try { storage?.removeItem(KEY); } catch { /* nothing to forget */ }
}
