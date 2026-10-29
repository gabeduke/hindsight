// web/static/lib/buffer/api.js
// The drawer's requests: a cue clip's (internal/api/cue.go), and the tape's
// that it needs (drop's Undo, the peaks). Each answers the Pi's JSON, or
// throws an Error whose message is ready to show.

async function call(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(path, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(`the Pi didn’t answer (${e.message})`);
  }
  const b = (await res.json().catch(() => null)) || {};
  if (!res.ok) {
    const err = new Error(b.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return b;
}

const q = (tapeId) => (tapeId ? `?id=${encodeURIComponent(tapeId)}` : '');

/**
 * grab is the Studio's GRAB onto the cue lane: {bars} or {seconds}, or
 * {ring_from, ring_to}, from sources; {clip, sources} takes that clip's span
 * again from those; {take, from, to} a take's span. With no tape id, the
 * loaded tape's lane. The tape's state, with edit.cue_clip and, when it took
 * an untouched GRAB's place, edit.cue_replaced.
 */
export const grab = (tapeId, req, o) => call(`/api/tapes/cue/grab${q(tapeId)}`, { ...o, method: 'POST', body: req });

/** trim moves a cue clip's window: {in, out} in frames from its grab's start. The tape's state. */
export const trim = (tapeId, clip, inF, outF, o) => call(`/api/tapes/cue/clip${q(tapeId)}`, { ...o, method: 'PATCH', body: { clip, in: inF, out: outF } });

/** shape sets a cue clip's gain_db, fades and their curves, normalize or reverse. The tape's state. */
export const shape = (tapeId, clip, fields, o) => call(`/api/tapes/cue/clip${q(tapeId)}`, { ...o, method: 'PATCH', body: { ...fields, clip } });

/** keep is a cue clip's KEEP, as a take: {name, label, seconds}. */
export const keep = (tapeId, clip, o) => call(`/api/tapes/cue/keep${q(tapeId)}`, { ...o, method: 'POST', body: { clip } });

/** drop lays a cue clip on the tape, {track, at}, a lane a track: one undo. */
export const drop = (tapeId, clip, track, at, o) => call(`/api/tapes/cue/drop${q(tapeId)}`, { ...o, method: 'POST', body: { clip, track, at } });

/** edit is one of the tape's edits (cue-set, cue-remove): the tape's state. */
export const edit = (tapeId, op, body, o) => call(`/api/tapes/edit${q(tapeId)}`, { ...o, method: 'POST', body: { op, ...body } });

/** audioURL is a cue clip's audition, its lanes summed; key names what it plays now. */
export const audioURL = (tapeId, clip, key) =>
  `/api/tapes/cue/audio?id=${encodeURIComponent(tapeId)}&clip=${encodeURIComponent(clip)}&k=${encodeURIComponent(key)}`;

/**
 * restoreReplaced is a range's Cut or Copy's Undo: the clipboard it made at
 * `by` (its `created`) replaced, back on the clipboard. The Pi keeps one.
 */
export const restoreReplaced = (by, o) =>
  call(`/api/clipboard/restore?replaced=1&by=${encodeURIComponent(by)}`, { ...o, method: 'POST' });

/** undo steps the tape back one: a drop's Undo. */
export const undo = (tapeId, o) => call(`/api/tapes/undo?id=${encodeURIComponent(tapeId)}`, { ...o, method: 'POST' });

/** peaks are a range of a pool file's peaks, `buckets` of them. */
export const peaks = (file, from, to, buckets, o) =>
  call(`/api/tapes/peaks?file=${encodeURIComponent(file)}&from=${from}&to=${to}&buckets=${buckets}`, o);
