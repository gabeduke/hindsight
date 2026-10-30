// web/static/lib/play/flag.js
// The latency overlay's per-device flag (lib/play/latency.js): a
// developer's view of what GET /api/latency measures, over every page of
// this device. On its own so the Settings sheet and lib/nav.js can read it
// without loading the overlay.

export const LATENCY_FLAG = 'hindsight.latency';

/** latencyOn says whether this device shows the latency overlay. */
export function latencyOn() {
  try { return localStorage.getItem(LATENCY_FLAG) === '1'; } catch { return false; }
}

/**
 * setLatencyOn shows or hides it on this device and says whether it stuck:
 * storage that refuses (private mode) answers false, so the sheet does not
 * claim a switch it could not keep.
 */
export function setLatencyOn(v) {
  try {
    if (v) localStorage.setItem(LATENCY_FLAG, '1');
    else localStorage.removeItem(LATENCY_FLAG);
    return latencyOn() === !!v;
  } catch { return false; }
}
