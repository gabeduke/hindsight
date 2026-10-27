// web/static/lib/buffer/model.js
// The Studio's buffer, as numbers (docs/superpowers/specs/2026-10-15-studio-buffer-design.md):
// where DROP puts it, how IN and OUT step, and what its keys say. Pure, so
// it's tested without a page; panel.js draws and wires it.
//
// The buffer is the clipboard with a `grab` on it (internal/tape grab.go):
// its frames count from the grab's start, its window is [in, out), and every
// lane's file holds `before` frames more ahead of it and `after` behind.

import { takeTitle } from '../rooms/takename.js';

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
 * nextFreeSpan is where ↵ dropped a buffer until F7 (it is dropPlace now, which
 * lays over what is there). The Pi's own DROP, from a controller pad, still
 * finds the next free span (internal/tape freespan.go mirrors this), so this
 * stays as the rule it is tested against. It is where a buffer `frames` long
 * goes on tracks first to first + count - 1: the first span free on all of them, from the next bar
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
 * overwritten is what a buffer dropped at `at` would cover on tracks first to
 * first + count - 1: how many clips it touches and how many frames of them it
 * lies over. DROP and a drag both can: the Pi lays the buffer over what's
 * there, trimming it, as one undo step.
 *
 * It clears what the Pi clears (internal/tape clipboard.go, dropBoard): the
 * whole window of a span, a grab included -- but for a buffer copied from
 * several picked clips (`board.clips`, with `board.tracks` their lanes and each
 * clip's `at` from the first), only the span under each copied clip, so a
 * clip in a gap between two of them stays. Without `board`, the whole window.
 */
export function overwritten(tape, { first, count = 1, at, frames, board = null }) {
  let clips = 0, covered = 0;
  const picked = !!(board && board.clips && Array.isArray(board.tracks));
  tape.tracks.slice(first - 1, first - 1 + count).forEach((tr, lane) => {
    const spans = picked
      ? (board.tracks[lane] || []).map((c) => [at + c.at, at + c.at + c.frames])
      : [[at, at + frames]];
    for (const c of tr.clips) {
      let over = 0;
      for (const [a, b] of spans) over += Math.max(0, Math.min(c.at + c.frames, b) - Math.max(c.at, a));
      if (over > 0) { clips++; covered += over; }
    }
  });
  return { clips, frames: covered };
}

/** landsWords says where a drop lands, and when it lands over a clip, that it replaces what's under it. */
export function landsWords(grid, { first, count = 1, at, frames, board = null }, tape) {
  const where = spanWords(grid, at, frames, tape.sample_rate);
  return overwritten(tape, { first, count, at, frames, board }).clips ? `${where} · replaces what’s under it` : where;
}

const trackWords = (first, count) => (count > 1 ? `tracks ${first}–${first + count - 1}` : `track ${first}`);

/**
 * dropPlace is where DROP puts a buffer `frames` long: the next bar line at
 * or after the playhead (pos) inside the loop -- or, with the loop off, the
 * tape -- where the whole part fits before its Out; none left, the first bar
 * line from its In (wrapping, as the loop plays), else its In itself. It
 * never looks at what is there: DROP lays over it (docs/superpowers/specs/
 * 2026-10-15-flow-design.md, decision 10). A part longer than the loop starts
 * at its In, which the same rule finds (no part that long fits before its Out),
 * and runs past its Out (`long`). With no tempo it is the playhead, and
 * an empty tape with none takes it at 0, as its first loop.
 *
 * A part the tape can hold is never refused: if it would end past the tape
 * (a loop near its end), it starts at the latest bar line from which it fits
 * -- the tape's end less the part with no tempo -- and `fitted` says it was
 * moved back. {at, long, fitted}; a part longer than the tape has no place
 * (dropKey refuses it).
 */
export function dropPlace(tape, { frames, pos = 0 }) {
  const loop = tape.loop || {};
  const looping = !!(loop.on && loop.out > loop.in);
  const lo = looping ? loop.in : 0;
  const hi = looping ? loop.out : tape.length;
  const bar = barOf(tape.grid);
  // `long`: it ends past the loop's Out, which only a looping tape has.
  const fit = (start) => {
    let at = start, fitted = false;
    if (at + frames > tape.length) {
      const latest = tape.length - frames;
      at = Math.max(0, bar ? barStart(barAt(latest, bar), bar) : latest);
      fitted = true;
    }
    return { at, long: looping && at + frames > hi, fitted };
  };
  if (!bar && tape.tracks.every((tr) => !tr.clips.length)) return { at: 0, long: false, fitted: false };
  const start = Math.max(pos, lo); // from the loop's In; past its Out nothing fits ahead, so it wraps
  if (!bar) return fit(start + frames <= hi ? start : lo);
  const ahead = nextBar(start, bar);
  if (ahead + frames <= hi) return fit(ahead);
  const round = nextBar(lo, bar);
  return fit(round + frames <= hi ? round : lo);
}

/**
 * dropKey is what the DROP key says and whether it can: DROP ON TRACK 2,
 * where (bars 1–4) and, exactly when it will lay over a clip on the lanes it
 * lands on, "replaces". `armed` is the record track (0: none); `armedAll`
 * every armed track, when several are (multi-arm, lib/rig/arm.js): it drops
 * on the first.
 *
 * It is never refused for room -- a full loop is dropped over, a part that
 * would end past the tape starts back so it fits -- so it can't only with no
 * armed track ("arm a track"), more lanes than the tape has, or a part longer
 * than the tape itself. `board` (the clipboard, optional) lets "replaces"
 * follow the Pi's rule for a buffer copied from several clips (overwritten). A buffer of several lanes whose first
 * lane would hang off the last track starts where they all fit, and says so.
 */
export function dropKey({ tape, armed, armedAll = [], count = 1, frames, pos = 0, board = null }) {
  if (!tape) return { word: 'Drop', sub: 'the tape isn’t loaded', can: false };
  const n = tape.tracks.length;
  if (count > n) return { word: 'Too many lanes', sub: `${count} lanes don’t fit on a ${n}-track tape`, can: false };
  const tried = armedAll.length ? armedAll : armed ? [armed] : [];
  if (!tried.length) return { word: 'Drop', sub: 'arm a track', can: false };
  const first = Math.min(tried[0], n - count + 1);
  if (frames > tape.length) {
    const bar = barOf(tape.grid);
    const size = bar ? barsText(frames, bar) : `${(frames / (tape.sample_rate || 48000)).toFixed(1)} s`;
    return { word: 'Longer than the tape', sub: `${size} won’t fit the tape: trim it shorter with IN and OUT`, can: false };
  }
  const { at, long, fitted } = dropPlace(tape, { frames, pos });
  const replaces = overwritten(tape, { first, count, at, frames, board }).clips > 0;
  const parts = [];
  if (first !== tried[0]) parts.push(`${count} lanes don’t fit from track ${tried[0]}`);
  else if (armedAll.length > 1) parts.push('the first armed track');
  parts.push(spanWords(tape.grid, at, frames, tape.sample_rate));
  if (long) parts.push('runs past the loop');
  if (fitted) parts.push('moved back to fit the tape');
  if (replaces) parts.push('replaces');
  return { word: `Drop on ${trackWords(first, count)}`, sub: parts.join(' · '), can: true, at, track: first, replaces, long, fitted };
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
  if (g.clamped) notes.push('clamped to what the feed still had');
  if (g.stale) notes.push('grabbed before Hindsight restarted: it keeps its audio, but its sources can’t change');
  if (g.take) notes.push('from a take: its sound is the take’s own, so its sources can’t change');
  return notes.join(' · ');
}

/**
 * chipsFor is the buffer's source chips: the tape's sources, the ones in the
 * buffer (or picked for the next GRAB) pressed; or, for a grab of a take's
 * span, the take alone, pressed and fixed -- its sound is the take's own.
 * Each is {name, label, on, fixed}.
 */
export function chipsFor(grab, names, picked) {
  if (grab && grab.take) {
    return [{ name: `take:${grab.take}`, label: grabTitle(grab), on: true, fixed: true }];
  }
  const on = grab ? grab.sources : picked;
  return names.map((name) => ({ name, label: name, on: on.includes(name), fixed: !!(grab && grab.stale) }));
}

/**
 * grabTitle names the take a take's grab came from, as the take is named
 * everywhere (takeTitle): its own name, else its time, with the day when it
 * was not today, as nothing in the buffer says the day. `now` is for the tests.
 */
export function grabTitle(grab, { now } = {}) {
  return takeTitle({ name: grab.take, label: grab.take_label || '' }, { day: true, now });
}

/** boardKey changes whenever what the buffer plays does: to know when to fetch its audio again. */
export function boardKey(board) {
  if (!board) return '';
  const g = board.grab || {};
  const c = board.tracks.flat()[0] || {};
  return [board.created, board.frames, g.in, g.out, g.reversed, c.gain_db, c.fade_in, c.fade_out, c.fade_in_shape, c.fade_out_shape, board.tracks.length].join('|');
}
