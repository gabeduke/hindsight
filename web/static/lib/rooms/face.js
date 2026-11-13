// web/static/lib/rooms/face.js
// The Studio's face (docs/plan/the-calm-studio.md, decision 9;
// docs/architecture/tape.md, *The two faces*): it shows the tape or the
// feed, one at a time, and the other as a thin row at the top. The face is
// the Studio's state, kept on this device as a per-device switch is (in
// this browser, never the Pi's: lib/device-prefs.js's way), and written on
// the Studio's root as data-face, which styles.css reads. No attribute is the
// tape, so the first paint, before any script, is the tape's.
//
// Pure but for its store: the root and the storage are handed in, so the
// tests stand in for both (face.test.js). lib/rooms/studio.js makes the one
// the Studio has, and tells the ribbon and the tape's strip through
// onChange; nothing reads the attribute back.

/** FACES are the faces the Studio has: the tape's first, the default. */
export const FACES = Object.freeze(['tape', 'feed']);

/** KEY is where this browser keeps the face. */
export const KEY = 'studio.face';

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** read is the face `storage` holds, or the tape's. */
function read(storage) {
  let v = null;
  try { v = storage?.getItem(KEY) ?? null; } catch { /* private mode: nothing kept, so the tape's */ }
  return FACES.includes(v) ? v : FACES[0];
}

/**
 * createFace is the Studio's face on this device. `root` is the Studio's
 * root (main#view-studio), on which it writes data-face at once and on each
 * turn; `storage` is where it remembers it (localStorage; a fixture's in
 * the tests). It answers:
 *   get()         'tape' or 'feed'
 *   set(face)     turns to `face`: writes it on the root, remembers it, and
 *                 tells every onChange. A face it hasn't got, or the one it
 *                 is on, changes nothing. Answers whether it turned
 *   onChange(fn)  fn(face) after each turn; answers its off
 */
export function createFace({ root = null, storage = store() } = {}) {
  let face = read(storage);
  const listeners = new Set();
  const draw = () => root?.setAttribute('data-face', face);
  draw();
  return {
    get: () => face,
    set(next) {
      if (!FACES.includes(next) || next === face) return false;
      face = next;
      draw();
      try { storage?.setItem(KEY, face); } catch { /* this browser keeps nothing: the face holds until the page goes */ }
      for (const fn of [...listeners]) fn(face);
      return true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
