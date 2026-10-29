// web/static/lib/room/notes.js
// A take's notes (docs/architecture/rooms.md, "The notes drawer"). A note is
// a take flag with words: the model and the per-flag endpoints exist
// (lib/flags.js), and a label travels in the WAV's cue chunk, so a note made
// here shows up in a DAW. Pure, but for the requests: the one that sends a
// span to the Studio, and barNotes, the take in the bar as the notes
// drawer's source.

import { replacedLine, remember, forget } from '../buffer/replaced.js';
import { forTheTape } from '../bar/carry.js';
import { flagRequest, asFlags } from '../flags.js';
import { withClient } from '../client.js';

/** SPAN_BARS is how far a note reaches at most, with a tempo; SPAN_SECONDS without one. */
export const SPAN_BARS = 8;
export const SPAN_SECONDS = 16;

/** fmtAt is a frame as a note writes it: "0:42", "12:05". */
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

/**
 * freeFrame is the frame nearest `at` that no note is on: `at` itself, or
 * the first free one after it, or before it at the take's end. A take has
 * at most one flag on a frame for the page's NOTE HERE to answer, so a new
 * note must never land on one that's there. Null when none is free.
 */
export function freeFrame(notes, at, total = Infinity) {
  const taken = new Set(notes.map((n) => n.frame));
  const last = Number.isFinite(total) ? total - 1 : Infinity;
  let f = Math.max(0, Math.min(last, Math.round(at)));
  for (let g = f; g <= last; g++) if (!taken.has(g)) return g;
  for (let g = f - 1; g >= 0; g--) if (!taken.has(g)) return g;
  return null;
}

/**
 * fieldEnter is what Enter in the notes drawer's words does. Writing the
 * words of a note NOTE HERE made (`current`) edits that note. With none, the
 * words make a new note at the playhead -- a new one, a frame on if a note
 * is already there: Enter never writes over another note's words.
 */
export function fieldEnter({ current = null, words = '', cursor = 0, notes = [], total = Infinity }) {
  const w = words.trim();
  if (current) return { kind: 'edit', id: current.id, words: w };
  if (!w) return { kind: 'none' };
  const frame = freeFrame(notes, cursor, total);
  return frame == null ? { kind: 'none' } : { kind: 'new', frame, words: w };
}

/**
 * clipboardBody is POST /api/clipboard's body for a span of a take: a grab,
 * which the Studio's buffer opens on (P2). A server without the buffer
 * ignores `grab` and copies the span, as before.
 */
export function clipboardBody(file, span) {
  // crate: false -- the rooms show no crate: a buffer this replaces is held
  // for GRAB's Undo only (lib/buffer/replaced.js).
  return { take: file, from: span.from, to: span.to, grab: true, crate: false };
}

/**
 * sendToStudio puts a span of a take in the Studio's buffer (the clipboard,
 * which the buffer shows) and answers where to go next: the Studio. It
 * throws with the Pi's words when the copy is refused -- the tape off, a
 * span too long -- so nothing navigates away from a note that didn't go.
 */
export async function sendToStudio(file, span, { fetchImpl = globalThis.fetch, storage = pageStorage(), forTape = forTheTape } = {}) {
  const res = await fetchImpl('/api/clipboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clipboardBody(file, span)),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  // A GRAB over a buffer nobody dropped or kept says so, with Undo -- on the
  // page this opens, where the buffer is: it is left there to say.
  if (b.replaced && b.clipboard) remember(storage, { by: b.clipboard.created, line: replacedLine(b.replaced, b.replaced_seconds) });
  // Going for the tape: the bar's take doesn't go along (lib/bar/carry.js).
  forTape();
  return '/tape.html';
}

/**
 * forgetNote lets a take's GRAB note go: a page that is not the Studio opened,
 * so nothing will say it (lib/buffer/replaced.js).
 */
export function forgetNote({ storage = pageStorage() } = {}) { forget(storage); }

const pageStorage = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

/**
 * barNotes is the take `name` as the notes drawer's source (drawer.js): the
 * Pi's record of it (GET /api/take), its notes by the take's flags, and the
 * bar (`bar`, the engine's: frameNow, seekTake) for where it is heard and
 * where a time or ▶ sends it. `go` is where GRAB goes next (the router's);
 * `onChanged(take)` hears every change it makes, for the room's list.
 * Answers the source, or throws with the Pi's words.
 */
export async function barNotes(name, { bar, go, onChanged = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const url = `/api/take?file=${encodeURIComponent(name)}`;
  const res = await fetchImpl(url, { cache: 'no-store', headers: withClient() });
  const got = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(got.error || `HTTP ${res.status}`);
  let take = { ...got, flags: asFlags(got.flags) };
  const fns = new Set();
  const changed = () => { for (const fn of fns) fn(); onChanged(take); };
  const sr = take.sample_rate || 48000;
  const flags = async (op, args) => {
    const b = await flagRequest(name, op, args, fetchImpl);
    take = { ...take, flags: asFlags(b.flags) };
    changed();
  };
  return {
    name,
    sampleRate: sr,
    total: Math.max(1, Math.round((take.duration_seconds || 0) * sr)),
    take: () => take,
    notes: () => notesOf(take.flags, sr),
    bpm: () => take.bpm || 0,
    // Null while the bar holds something else: nothing of this take is heard.
    frame() {
      const f = bar.frameNow?.();
      return f && f.take === name ? f.frame : null;
    },
    /** reload fetches the take again, for a drawer opened on it once more: a ★ or a name may have changed elsewhere. */
    async reload() {
      const r = await fetchImpl(url, { cache: 'no-store', headers: withClient() });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      take = { ...b, flags: asFlags(b.flags) };
      for (const fn of fns) fn();
    },
    add: (frame, label) => flags('add', { frame, label }),
    edit: (id, label) => flags('edit', { id, label }),
    remove: (id) => flags('remove', { id }),
    async patch(fields) {
      const r = await fetchImpl(url, { method: 'PATCH', headers: withClient({ 'Content-Type': 'application/json' }), body: JSON.stringify(fields) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      take = { ...take, ...fields };
      changed();
    },
    async seek(frame, opts) {
      if (!(await bar.seekTake(name, frame, opts))) throw new Error('it can’t play yet');
    },
    async grab(span) { go(await sendToStudio(name, span, { fetchImpl })); },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
