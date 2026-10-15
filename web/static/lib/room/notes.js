// web/static/lib/room/notes.js
// The sketchbook's notes (docs/superpowers/specs/2026-10-15-listening-room-design.md,
// "The chair: the sketchbook"). A note is a take flag with words: the model
// and the per-flag endpoints exist (lib/flags.js), and a label travels in
// the WAV's cue chunk, so a note made here shows up in a DAW. Pure.

/** SPAN_BARS is how far a note reaches at most, with a tempo; SPAN_SECONDS without one. */
export const SPAN_BARS = 8;
export const SPAN_SECONDS = 16;

/** fmtAt is a frame as the sketchbook writes it: "0:42", "12:05". */
export function fmtAt(frame, sampleRate = 48000) {
  const s = Math.max(0, Math.floor(frame / sampleRate));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * notesOf is the take's flags as notes: in time order, numbered from 1, each
 * with its words ('' for a bare flag) and where it is.
 */
export function notesOf(flags, sampleRate = 48000) {
  return [...(flags || [])]
    .sort((a, b) => a.frame - b.frame || String(a.id).localeCompare(String(b.id)))
    .map((f, i) => ({ n: i + 1, id: f.id, frame: f.frame, label: f.label || '', at: fmtAt(f.frame, sampleRate) }));
}

/**
 * noteSpan is what *to the studio* puts in the buffer for one note: from its
 * mark to the next note after it, or eight bars at the take's tempo (16 s
 * with none), whichever is sooner, and never past the take's end. The buffer
 * trims it. Null when nothing is left after the mark.
 */
export function noteSpan(notes, id, { sampleRate = 48000, bpm = null, total = Infinity } = {}) {
  const note = notes.find((x) => x.id === id);
  if (!note) return null;
  const from = Math.max(0, Math.round(note.frame));
  const reach = bpm > 0 ? (SPAN_BARS * 4 * 60 / bpm) * sampleRate : SPAN_SECONDS * sampleRate;
  let to = from + Math.round(reach);
  const next = notes.filter((x) => x.frame > note.frame).sort((a, b) => a.frame - b.frame)[0];
  if (next) to = Math.min(to, Math.round(next.frame));
  to = Math.min(to, total);
  return to > from ? { from, to } : null;
}

/** clipboardBody is POST /api/clipboard's body for a span of a take. */
export function clipboardBody(file, span) {
  return { take: file, from: span.from, to: span.to };
}

/**
 * sendToStudio puts a span of a take in the Studio's buffer (the clipboard,
 * which the buffer shows) and answers where to go next: the Studio. It
 * throws with the Pi's words when the copy is refused -- the tape off, a
 * span too long -- so nothing navigates away from a note that didn't go.
 */
export async function sendToStudio(file, span, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl('/api/clipboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clipboardBody(file, span)),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  }
  return '/tape.html';
}
