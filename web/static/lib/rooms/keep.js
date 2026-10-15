// web/static/lib/rooms/keep.js
// KEEP, the Studio's word for Capture's CAPTURE: the last N seconds of the
// ring, saved as a take on the Listening Room's shelf. The same request
// Capture makes (POST /api/trigger); only the words are the Studio's.

/**
 * keepTake keeps the last `seconds` of the ring (0 is all of it) and answers
 * with the Pi's {name, seconds, ...}, or throws an Error whose message is
 * ready to show.
 */
export async function keepTake(seconds, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(`/api/trigger?seconds=${seconds}`, { method: 'POST' });
  } catch (e) {
    throw new Error(`Could not keep it: ${e.message}`);
  }
  const body = (await res.json().catch(() => null)) || {};
  if (!res.ok) {
    const msg = body.error || `HTTP ${res.status}`;
    throw new Error(res.status === 507 ? `Disk full — ${msg}` : `Could not keep it: ${msg}`);
  }
  return body;
}

/**
 * takeBack moves a take just kept to the trash (Recently deleted, on the
 * takes page), where Restore can bring it back.
 */
export async function takeBack(name, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`/api/delete?file=${encodeURIComponent(name)}`, { method: 'DELETE' });
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) || {};
    throw new Error(b.error || `HTTP ${res.status}`);
  }
}
