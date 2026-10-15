// web/static/lib/buffer/model.js
// The Studio's buffer, as numbers (docs/superpowers/specs/2026-10-15-studio-buffer-design.md):
// where DROP puts it, how IN and OUT step, and what its keys say. Pure, so
// it's tested without a page; panel.js draws and wires it.
//
// The buffer is the clipboard with a `grab` on it (internal/tape grab.go):
// its frames count from the grab's start, its window is [in, out), and every
// lane's file holds `before` frames more ahead of it and `after` behind.

/** barStart is where bar n (from 0) begins: n × the exact bar, rounded, as the Pi places it. */
export function barStart(n, bar) {
  return Math.round(n * bar) || 0; // never -0
}

/** barAt is the bar a frame is in; a bar line belongs to the bar it starts. */
export function barAt(pos, bar) {
  let n = Math.floor(pos / bar);
  while (barStart(n + 1, bar) <= pos) n++;
  while (barStart(n, bar) > pos) n--;
  return n;
}

/** nextBar is the first bar line at or after pos. */
export function nextBar(pos, bar) {
  const n = barAt(pos, bar);
  return barStart(n, bar) < pos ? barStart(n + 1, bar) : barStart(n, bar);
}

const barOf = (grid) => (grid && grid.frames > 0 && grid.bars > 0 ? grid.frames / grid.bars : 0);

/**
 * nextFreeSpan is where ↵ drops a buffer `frames` long on tracks first to
 * first + count - 1: the first span free on all of them, from the next bar
 * line at or after the playhead (pos), on a bar line, as far as the loop's
 * Out -- then round from its In, as the loop plays -- or with the loop off
 * the tape's end, then round from its start. With no tempo, at the playhead
 * or where a clip ends. An empty tape with no tempo takes it at 0, as its
 * first loop. It answers {at} or null when nothing fits.
 */
export function nextFreeSpan(tape, { first, count = 1, frames, pos = 0 }) {
  if (!tape || !(frames > 0) || !(first >= 1) || first + count - 1 > tape.tracks.length) return null;
  const lanes = tape.tracks.slice(first - 1, first - 1 + count);
  const busy = (a, b) => lanes.some((tr) => tr.clips.some((c) => c.at < b && c.at + c.frames > a));
  const loop = tape.loop || {};
  const looping = !!(loop.on && loop.out > loop.in);
  const lo = looping ? loop.in : 0;
  const hi = looping ? loop.out : tape.length;
  if (frames > hi - lo) return null;
  const bar = barOf(tape.grid);
  if (!bar && tape.tracks.every((tr) => !tr.clips.length)) return { at: 0 };
  const start = pos >= lo && pos < hi ? pos : lo;
  // The candidates, in the order the tape plays them from the playhead.
  const ahead = [], round = [];
  if (bar) {
    for (let n = barAt(nextBar(lo, bar), bar); ; n++) {
      const at = barStart(n, bar);
      if (at + frames > hi) break;
      (at >= start ? ahead : round).push(at);
    }
  } else {
    const ends = [...new Set(lanes.flatMap((tr) => tr.clips.map((c) => c.at + c.frames)))].sort((a, b) => a - b);
    for (const at of [start, ...ends, lo]) {
      if (at < lo || at + frames > hi) continue;
      (at >= start ? ahead : round).push(at);
    }
    ahead.sort((a, b) => a - b);
    round.sort((a, b) => a - b);
  }
  for (const at of [...ahead, ...round]) if (!busy(at, at + frames)) return { at };
  return null;
}

/** fmtClock reads frames as m:ss. */
export function fmtClock(frames, sr) {
  const s = Math.max(0, Math.round(frames / sr));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** spanWords names where a span of the tape is: "bars 9–12", "bar 3", or "at 0:12". */
export function spanWords(grid, at, frames, sr) {
  const bar = barOf(grid);
  if (!bar) return `at ${fmtClock(at, sr)}`;
  const a = barAt(at, bar) + 1;
  const b = barAt(at + Math.max(1, frames) - 1, bar) + 1;
  return a === b ? `bar ${a}` : `bars ${a}–${b}`;
}

/**
 * dropKey is what the DROP key says and whether it can: DROP ON TRACK 2 and
 * where (bars 9–12); or why not -- no track armed, no room on it, more lanes
 * than tracks below it. `armed` is the record track (0: none); `armedAll`
 * every armed track, when several are (multi-arm, lib/rig/arm.js): it still
 * drops on the first, and says so.
 */
export function dropKey({ tape, armed, armedAll = [], count = 1, frames, pos = 0 }) {
  if (!tape) return { word: 'Drop', sub: 'the tape isn’t loaded', can: false };
  if (!armed) return { word: 'Arm a track', sub: 'or drag it to a lane', can: false };
  const last = armed + count - 1;
  if (last > tape.tracks.length) return { word: `Drop on track ${armed}`, sub: `${count} lanes don’t fit from it: drag it higher`, can: false };
  const span = nextFreeSpan(tape, { first: armed, count, frames, pos });
  const what = count > 1 ? `tracks ${armed}–${last}` : `track ${armed}`;
  if (!span) return { word: `No room on ${what}`, sub: 'drag it to a lane', can: false };
  const first = armedAll.length > 1 ? 'the first armed track · ' : '';
  return { word: `Drop on ${what}`, sub: first + spanWords(tape.grid, span.at, frames, tape.sample_rate), can: true, at: span.at };
}

/** grabSeconds is what GRAB takes with no tempo: N bars at 120 BPM, 2N seconds. */
export const grabSeconds = (n) => 2 * n;

/** BAR_PICKS are the feed's 1 / 2 / 4 / 8 picker. */
export const BAR_PICKS = [1, 2, 4, 8];

/**
 * grabKey is what GRAB and its picker say: the last N bars with a tempo,
 * the last 2N seconds without.
 */
export function grabKey(n, hasGrid) {
  if (hasGrid) return { word: 'Grab', unit: 'bars', pick: (m) => String(m), label: `Grab the last ${n} bar${n === 1 ? '' : 's'}` };
  return { word: `Grab ${grabSeconds(n)} s`, unit: '', pick: (m) => `${grabSeconds(m)} s`, label: `Grab the last ${grabSeconds(n)} seconds: the tape has no tempo yet` };
}

/** OVERHANG is the crossfades' overhang, in seconds: the window keeps it from each file's end. */
export const OVERHANG = 0.010;

/** windowLimits is how far IN and OUT can go: the handles, less the overhang. */
export function windowLimits(grab, sr) {
  const over = Math.round(OVERHANG * sr);
  return {
    lo: Math.min(grab.in, -grab.before + over),
    hi: Math.max(grab.out, grab.frames + grab.after - over),
    min: Math.max(1, over),
  };
}

/** clampWindow keeps a window inside its handles, at least the overhang long, as the Pi does. */
export function clampWindow(grab, inF, outF, sr) {
  const { lo, hi, min } = windowLimits(grab, sr);
  const i = Math.min(Math.max(inF, lo), hi - min);
  const o = Math.min(Math.max(outF, i + min), hi);
  return { in: i, out: o };
}

/**
 * gridOf is the buffer's own grid: its bar lines `step` apart (the snap's
 * division of the tape's bar), from the grab's first bar line -- where the
 * tape played them -- or from its start.
 */
export function gridOf(grab, per) {
  const bar = grab.bar_frames || 0;
  if (!bar || !per) return null;
  return { anchor: grab.downbeat ?? 0, step: bar / per };
}

const lineAt = (g, n) => g.anchor + Math.round(n * g.step);

/** snapNear is the grid line nearest frame f, or f with no grid. */
export function snapNear(g, f) {
  if (!g) return Math.round(f);
  return lineAt(g, Math.round((f - g.anchor) / g.step));
}

/**
 * edgeStep moves an edge one step: to the next grid line that way (the
 * snap: a bar, a beat, an eighth), or a tenth of a second with the snap
 * off or no tempo, as the tape's keys step.
 */
export function edgeStep(g, f, dir, sr) {
  if (!g) return Math.round(f + dir * 0.1 * sr);
  let n = Math.round((f - g.anchor) / g.step);
  if (dir > 0) { while (lineAt(g, n) <= f) n++; } else { while (lineAt(g, n) >= f) n--; }
  return lineAt(g, n);
}

/**
 * bufferLines is what the window's ruler marks: each bar line across the
 * file, numbered from 1 inside the grab, with "before" and "after" over the
 * handles.
 */
export function bufferLines(grab) {
  const bar = grab.bar_frames || 0;
  if (!bar) return [];
  const anchor = grab.downbeat ?? 0;
  const out = [];
  const lo = -grab.before, hi = grab.frames + grab.after;
  let count = 0;
  for (let n = Math.ceil((lo - anchor) / bar - 1e-9); ; n++) {
    const f = anchor + Math.round(n * bar);
    if (f > hi) break;
    if (f < lo) continue;
    out.push({ frame: f, label: f >= 0 && f < grab.frames ? String(++count) : '' });
  }
  return out;
}

/** barsText reads a length in bars: "4 bars", "3.5 bars". */
export function barsText(frames, bar) {
  const n = frames / bar;
  const r = Math.round(n * 100) / 100;
  const t = Number.isInteger(r) ? String(r) : r.toFixed(Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? 1 : 2);
  return `${t} bar${r === 1 ? '' : 's'}`;
}

/** bufferMeta is the buffer's line: "4 bars · 8.00 s · 120 BPM". */
export function bufferMeta(board, sr) {
  const g = board.grab;
  const secs = `${(board.frames / sr).toFixed(2)} s`;
  const bar = g && g.bar_frames;
  if (!bar) return secs;
  const bpm = Math.round((4 * 60 * sr / bar) * 10) / 10;
  return `${barsText(board.frames, bar)} · ${secs} · ${bpm} BPM`;
}

/** bufferNote says what the panel should: a grab of wall-clock bars, or one the ring clamped. */
export function bufferNote(board) {
  const g = board && board.grab;
  if (!g) return '';
  const notes = [];
  if (g.wall) notes.push(`the last ${g.bars} bar${g.bars === 1 ? '' : 's'} of time at the tape’s tempo: ${g.why || 'the tape didn’t play them'}`);
  if (g.clamped) notes.push('clamped to what the ring still had');
  if (g.stale) notes.push('grabbed before Hindsight restarted: it keeps its audio, but its sources can’t change');
  return notes.join(' · ');
}

/** boardKey changes whenever what the buffer plays does: to know when to fetch its audio again. */
export function boardKey(board) {
  if (!board) return '';
  const g = board.grab || {};
  const c = board.tracks.flat()[0] || {};
  return [board.created, board.frames, g.in, g.out, g.reversed, c.gain_db, c.fade_in, c.fade_out, c.fade_in_shape, c.fade_out_shape, board.tracks.length].join('|');
}
