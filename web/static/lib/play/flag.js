// web/static/lib/play/flag.js
// Play mode's per-device flag, on its own so anything can read it without
// also importing Play mode. mount.js has a side effect -- it starts Play mode
// on load -- and the Settings sheet should not have to run that to draw a
// checkbox.

export const PLAY_FLAG = 'hindsight.play';

/** on says whether this device has Play mode turned on. */
export function on() {
  try { return localStorage.getItem(PLAY_FLAG) === '1'; } catch { return false; }
}

/**
 * setOn turns it on or off for this device and says whether it stuck: storage
 * that refuses (private mode) answers false, so the sheet does not claim a
 * switch it could not keep.
 */
export function setOn(v) {
  try {
    if (v) localStorage.setItem(PLAY_FLAG, '1');
    else localStorage.removeItem(PLAY_FLAG);
    return on() === !!v;
  } catch { return false; }
}

// The latency overlay's (lib/play/latency.js): a developer's view of what
// GET /api/latency measures, over every page of this device.
export const LATENCY_FLAG = 'hindsight.latency';

/** latencyOn says whether this device shows the latency overlay. */
export function latencyOn() {
  try { return localStorage.getItem(LATENCY_FLAG) === '1'; } catch { return false; }
}

/** setLatencyOn shows or hides it on this device, and says whether it stuck. */
export function setLatencyOn(v) {
  try {
    if (v) localStorage.setItem(LATENCY_FLAG, '1');
    else localStorage.removeItem(LATENCY_FLAG);
    return latencyOn() === !!v;
  } catch { return false; }
}
