// web/static/lib/buffer/api.js
// The buffer's requests (internal/api, "the clipboard"). Each answers the
// Pi's JSON, or throws an Error whose message is ready to show.

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

/** board is what's on the clipboard: {clipboard, error?}. */
export const board = (o) => call('/api/clipboard', o);

/**
 * grab is the Studio's GRAB: {bars} or {seconds}, or {ring_from, ring_to},
 * from sources; {again: true, sources} takes the buffer's own span again.
 */
export const grab = (req, o) => call('/api/clipboard', { ...o, method: 'POST', body: req });

/** trim moves the window: {in, out} in frames from the grab's start. */
export const trim = (inF, outF, o) => call('/api/clipboard', { ...o, method: 'PATCH', body: { in: inF, out: outF } });

/** shape sets the lanes' gain_db, fades, normalize or reverse. */
export const shape = (fields, o) => call('/api/clipboard', { ...o, method: 'PATCH', body: fields });

/** keep is KEEP AS TAKE: {name, label, seconds}. */
export const keep = (o) => call('/api/clipboard/keep', { ...o, method: 'POST' });

/** toss empties the clipboard, keeping it aside for restore. */
export const toss = (o) => call('/api/clipboard?toss=1', { ...o, method: 'DELETE' });

/** restore is a toss's Undo. */
export const restore = (o) => call('/api/clipboard/restore?crate=0', { ...o, method: 'POST' });

/**
 * restoreReplaced is GRAB's Undo: the buffer the grab made at `by` (its
 * clipboard's `created`) replaced, back on the clipboard. The Pi keeps one.
 */
export const restoreReplaced = (by, o) =>
  call(`/api/clipboard/restore?replaced=1&by=${encodeURIComponent(by)}`, { ...o, method: 'POST' });

/** drop lays the clipboard on the tape: {track, at}, one undo. */
export const drop = (tapeId, track, at, o) => call(`/api/tapes/drop?id=${encodeURIComponent(tapeId)}`, { ...o, method: 'POST', body: { track, at } });

/** undo steps the tape back one: a drop's Undo. */
export const undo = (tapeId, o) => call(`/api/tapes/undo?id=${encodeURIComponent(tapeId)}`, { ...o, method: 'POST' });

/** peaks are a range of a pool file's peaks, `buckets` of them. */
export const peaks = (file, from, to, buckets, o) =>
  call(`/api/tapes/peaks?file=${encodeURIComponent(file)}&from=${from}&to=${to}&buckets=${buckets}`, o);
