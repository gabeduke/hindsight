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

/** setOn turns it on or off for this device. */
export function setOn(v) {
  try {
    if (v) localStorage.setItem(PLAY_FLAG, '1');
    else localStorage.removeItem(PLAY_FLAG);
  } catch { /* private mode: this session only, which is fine */ }
}
