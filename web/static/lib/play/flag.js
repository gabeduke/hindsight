// web/static/lib/play/flag.js
// The latency overlay's per-device flag (lib/play/latency.js): a
// developer's view of what GET /api/latency measures, over every page of
// this device. On its own so the Settings sheet and lib/nav.js can read it
// without loading the overlay. And the keys of Play mode's, retired.

export const LATENCY_FLAG = 'hindsight.latency';

/** latencyOn says whether this device shows the latency overlay. */
export function latencyOn() {
  try { return localStorage.getItem(LATENCY_FLAG) === '1'; } catch { return false; }
}

// Play mode's switch and where its strip was left, retired on 2026-10-30
// (docs/architecture/tape.md, *When a pad lands*). Nothing reads them now,
// but a release from before then, picked from Releases, would: a phone that
// had Play mode on would get the strip and EDIT | PLAY back over its mini
// player. So a page with the header forgets them as it loads (lib/nav.js,
// initNav), at the address it was loaded from: storage is an address's.
export const RETIRED = ['hindsight.play', 'hindsight.play.strip', 'hindsight.play.from', 'hindsight.play.webmidi', 'hindsight.play.midi'];

/**
 * forgetRetired takes the retired keys out of the storage `store()` answers
 * (localStorage by default). Storage that refuses, or throws to be read at
 * all, keeps none to forget.
 */
export function forgetRetired(store = () => globalThis.localStorage) {
  try { for (const k of RETIRED) store()?.removeItem(k); } catch { /* private mode */ }
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
