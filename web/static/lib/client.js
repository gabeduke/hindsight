// web/static/lib/client.js
// Which device this is, for Undo. The Pi keeps each take's changes with the
// device that made them, so ↶ on the phone steps back through the phone's
// changes and never undoes what the tablet did since. The id is random, kept
// per browser, and means nothing else.

export const CLIENT_HEADER = 'X-Hindsight-Client';
const KEY = 'hindsight.client';

let cached = '';

/** clientId is this browser's id: 16 random hex characters. */
export function clientId() {
  if (cached) return cached;
  try { cached = localStorage.getItem(KEY) || ''; } catch { /* private mode */ }
  if (!/^[0-9a-f]{16}$/.test(cached)) {
    const b = new Uint8Array(8);
    globalThis.crypto.getRandomValues(b);
    cached = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(KEY, cached); } catch { /* this tab only, then */ }
  }
  return cached;
}

/** withClient adds the device header to a fetch's headers. */
export function withClient(headers = {}) {
  return { ...headers, [CLIENT_HEADER]: clientId() };
}
