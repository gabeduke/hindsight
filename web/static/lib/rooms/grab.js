// web/static/lib/rooms/grab.js
// GRAB starts at the loop's length (docs/architecture.md, Vocabulary,
// "The Studio: one selection, two verbs" and decision 12): the feed's 1 / 2 /
// 4 / 8 picker begins at the tape's loop in bars, so a grab fits the loop it
// is for, and a take's GRAB -- the last N bars before its playhead -- uses
// the same N. Pure, but for loadedLoopBars, which asks the Pi.

import { BAR_PICKS, grabSeconds } from '../buffer/model.js';

const PICK_KEY = 'buffer.bars';

/** readPick is the pick saved on this device (1 / 2 / 4 / 8), or null. */
export function readPick(storage = globalThis.localStorage) {
  try { const n = Number(storage.getItem(PICK_KEY)); return BAR_PICKS.includes(n) ? n : null; } catch { return null; }
}

/** writePick saves a pick made by hand: the start for a tape with no loop to follow. */
export function writePick(n, storage = globalThis.localStorage) {
  try { storage.setItem(PICK_KEY, String(n)); } catch { /* this session only */ }
}

const SOURCE_KEY = 'buffer.source';

/** readSource is the feed source saved on this device (main / ch1 / ch2 / aux), or null. */
export function readSource(storage = globalThis.localStorage) {
  try { return storage.getItem(SOURCE_KEY) || null; } catch { return null; }
}

/** writeSource saves a feed source picked by hand. */
export function writeSource(src, storage = globalThis.localStorage) {
  try { storage.setItem(SOURCE_KEY, String(src)); } catch { /* this session only */ }
}

/**
 * loopBars is the tape's loop in bars, from the tape as the Pi answers it
 * ({grid: {frames, bars}, loop: {in, out, on}}): the bracket's length when
 * it is on, else the tape's first loop. Null with no tempo, or no tape.
 */
export function loopBars(tape) {
  const grid = tape && tape.grid;
  if (!grid || !(grid.frames > 0) || !(grid.bars > 0)) return null;
  const loop = tape.loop;
  if (loop && loop.on && loop.out > loop.in) return (loop.out - loop.in) / (grid.frames / grid.bars);
  return grid.bars;
}

/**
 * pickFor is the picker's value for a loop this long: the largest of 1 / 2 /
 * 4 / 8 that fits inside it (a loop under a bar gets 1). Null for no loop.
 */
export function pickFor(bars) {
  if (!Number.isFinite(bars) || !(bars > 0)) return null;
  let pick = BAR_PICKS[0];
  // A hair of give: a 4-bar loop at a fractional bar length is a few frames
  // under 4.00 bars, and is still the 4.
  for (const p of BAR_PICKS) if (p <= bars + 0.01) pick = p;
  return pick;
}

/**
 * followLoop is the feed's picker, given the tape. It starts at the loop's
 * bars and follows the loop when its length changes; a value picked by hand
 * stays until then. `s` is {n, loopBars}; the answer is the new one. A tape
 * with no loop to follow changes nothing.
 */
export function followLoop(s, tape) {
  const bars = loopBars(tape);
  if (bars == null || bars === s.loopBars) return s;
  return { n: pickFor(bars), loopBars: bars };
}

/**
 * takeStartN is N for a take's GRAB, which has no picker of its own: the
 * loop's bars as the feed's would start, else the pick saved on this device,
 * else 4.
 */
export function takeStartN({ loopBars: bars = null, stored = null } = {}) {
  return pickFor(bars) ?? (BAR_PICKS.includes(stored) ? stored : 4);
}

/**
 * takeGrabSpan is the span of a take that GRAB puts in the buffer, in
 * frames: a selection, else the N bars before the playhead at the take's
 * tempo (2N seconds without one, as the feed's GRAB takes), never before 0
 * nor past the end. With nothing before the playhead it is the first N
 * bars. Null for a take with no length.
 */
export function takeGrabSpan({ region = null, playhead = 0, total, sampleRate = 48000, bpm = null, n = 4 }) {
  if (!(total > 0)) return null;
  if (region && region.end > region.start) return { from: Math.round(region.start), to: Math.round(region.end) };
  const seconds = bpm > 0 ? n * 4 * 60 / bpm : grabSeconds(n);
  const len = Math.round(seconds * sampleRate);
  const to = Math.max(0, Math.min(total, Math.round(playhead)));
  if (to <= 0) return { from: 0, to: Math.min(total, len) };
  return { from: Math.max(0, to - len), to };
}

/**
 * playheadFor is where the bar is in take `name`, in frames: its own time
 * when the bar holds that take (`np` is the page's bar: takeName, takeTime),
 * else 0, the take's start -- a take the bar is not playing has no playhead.
 */
export function playheadFor(np, name, sampleRate = 48000) {
  const t = np && np.takeName === name ? np.takeTime : null;
  return Number.isFinite(t) && t > 0 ? Math.round(t * sampleRate) : 0;
}

/** takeGrabLabel is the take's GRAB key: GRAB 4 BARS, GRAB 8s without a tempo, GRAB SELECTION. */
export function takeGrabLabel({ n = 4, bpm = null, selection = false }) {
  if (selection) return 'GRAB SELECTION';
  if (bpm > 0) return `GRAB ${n} BAR${n === 1 ? '' : 'S'}`;
  return `GRAB ${grabSeconds(n)}s`;
}

/**
 * loadedLoopBars asks the Pi for the loaded tape's loop in bars. Null when
 * there is no tape, no tempo or no answer: a page that only wants a number
 * to start from never fails for want of one.
 */
export async function loadedLoopBars(fetchImpl = globalThis.fetch) {
  try {
    const list = await fetchImpl('/api/tapes', { cache: 'no-store' });
    if (!list.ok) return null;
    const { loaded } = await list.json();
    if (!loaded) return null;
    const res = await fetchImpl(`/api/tapes/state?id=${encodeURIComponent(loaded)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return loopBars((await res.json()).tape);
  } catch {
    return null;
  }
}
