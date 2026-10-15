// web/static/lib/room/record.js
// CUT A RECORD (docs/superpowers/specs/2026-10-15-listening-room-design.md,
// "Cut a record"). A record is a take with a mark (Meta.Record, set by
// PATCH /api/take), not a new store: everything a take can do, a record can.
//
// - From a take: the take itself, or its IN–OUT span as a cut (POST /api/cut),
//   then the mark. A cut is quick.
// - From a tape: a mixdown (POST /api/tapes/mixdown) -- the tape played once
//   and saved as a take, which takes as long as the tape -- followed through
//   live.mixdown, then the mark on the take it saved.
//
// A failure marks nothing, so nothing lands on the Records shelf, and the
// error says why. The fetches are passed in, so the flows are tested here
// without a Pi.

import { stripeFor, stripeOf } from '../objects/cassette-geom.js';
import { spineTitle } from '../shelf.js';

/** takeCover is a take's sleeve: the stripe it wears, its tag's or its name's. */
export const takeCover = (take, tags = []) => stripeFor(take, tags);

/** tapeCover is a tape's: its id hashed onto the stripes, as a take's name is. */
export const tapeCover = (id) => stripeOf(String(id || ''));

/** markBody is the PATCH that makes a take a record. The Pi dates it. */
export function markBody(cover, side = 'A') {
  return { record: { side, cover } };
}

/**
 * cutPlan is what CUT A RECORD does to a take: cut its IN–OUT span first,
 * when it has one short of the whole take, or mark the take as it is.
 */
export function cutPlan(t) {
  const sr = t.sample_rate || 48000;
  const total = Math.round((t.duration_seconds || 0) * sr);
  const tr = t.trim;
  if (tr && tr.end_frame > tr.start_frame && (tr.start_frame > 0 || tr.end_frame < total)) {
    return { cut: { start_frame: tr.start_frame, end_frame: tr.end_frame } };
  }
  return { cut: null };
}

/**
 * mixProgress reads a mixdown's progress for the turntable's bar: how far
 * through (0..1), and the words. heard is where the tape is (live.heard).
 */
export function mixProgress(md, heard = 0) {
  if (!md) return { state: 'none', frac: 0, words: '' };
  const span = Math.max(1, md.to - md.from);
  switch (md.state) {
    case 'playing': {
      const frac = Math.max(0, Math.min(1, (heard - md.from) / span));
      return { state: md.state, frac, words: `Cutting · ${Math.round(frac * 100)}%` };
    }
    case 'tail': return { state: md.state, frac: 1, words: 'Letting it ring out' };
    case 'saving': return { state: md.state, frac: 1, words: 'Saving it' };
    case 'done': return { state: md.state, frac: 1, words: 'Cut' };
    case 'failed': return { state: md.state, frac: 0, words: md.error || 'It didn’t cut' };
    default: return { state: md.state, frac: 0, words: '' };
  }
}

async function why(res) {
  return (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
}

async function send(fetchImpl, url, method, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(await why(res));
  return res.json().catch(() => ({}));
}

/**
 * cutTakeRecord cuts a record from a take: its IN–OUT span as a new take,
 * or the take itself, marked with its cover. Answers {name, cut} -- the
 * record's take, and whether a cut was made -- or throws why it couldn't.
 * A cut that the mark then fails on is left as an ordinary cut, folded
 * into its take: not a record.
 */
export async function cutTakeRecord(t, { tags = [], fetchImpl = globalThis.fetch } = {}) {
  const plan = cutPlan(t);
  let name = t.name;
  if (plan.cut) {
    const b = await send(fetchImpl, `/api/cut?file=${encodeURIComponent(t.name)}`, 'POST',
      { ...plan.cut, label: t.label || spineTitle(t) });
    name = b.name;
  }
  await send(fetchImpl, `/api/take?file=${encodeURIComponent(name)}`, 'PATCH', markBody(takeCover(t, tags)));
  return { name, cut: !!plan.cut };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * cutTapeRecord cuts a record from the loaded tape: the whole tape mixed
 * down, followed until its take is saved, and that take marked. onProgress
 * hears mixProgress at each look. It throws the mixdown's own words when it
 * fails or is cancelled, having marked nothing.
 */
export async function cutTapeRecord(tapeId, { fetchImpl = globalThis.fetch, sleep = pause, onProgress, everyMs = 500 } = {}) {
  const q = `id=${encodeURIComponent(tapeId)}`;
  const { mixdown: started } = await send(fetchImpl, `/api/tapes/mixdown?${q}`, 'POST', { all: true });
  if (!started) throw new Error('the Pi didn’t start a mixdown');
  onProgress?.(mixProgress(started, started.from));
  // As long as the tape, and then some: the engine gives up on its own
  // before this does, and says why.
  const sr = 48000;
  const deadline = Date.now() + ((started.to - started.from + (started.tail || 0)) / sr) * 1000 + 120000;
  for (;;) {
    await sleep(everyMs);
    if (Date.now() > deadline) throw new Error('the mixdown took too long; nothing was marked');
    let s;
    try {
      const res = await fetchImpl(`/api/tapes/state?${q}`, { cache: 'no-store' });
      if (!res.ok) continue;
      s = await res.json();
    } catch { continue; } // the next look asks again
    const md = s.live && s.live.mixdown;
    if (!md || md.id !== started.id) {
      if (!s.loaded) throw new Error('another tape was loaded; nothing was marked');
      continue;
    }
    const p = mixProgress(md, s.live.heard);
    onProgress?.(p);
    if (md.state === 'failed') throw new Error(md.error || 'the mixdown didn’t save');
    if (md.state === 'done' && md.take) {
      await send(fetchImpl, `/api/take?file=${encodeURIComponent(md.take)}`, 'PATCH', markBody(tapeCover(tapeId)));
      return { name: md.take };
    }
  }
}
