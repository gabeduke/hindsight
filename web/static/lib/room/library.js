// web/static/lib/room/library.js
// How this device shows the Listening Room (docs/plan/the-studio-space.md,
// "The library"): the shelf wall, or the List. A tablet's library is the
// wall and a phone's the List, until the person picks the other on
// Shelf | List; then that is remembered here, in this browser only, as a
// per-device switch (lib/device-prefs.js). Pure but for its store.

const KEY = 'hindsight.library';
/** CHANGED is the event the window hears when the switch is changed from Settings. */
export const CHANGED = 'hindsight-library';
/** NARROW is where the library is the List unless the person said otherwise: a phone. */
export const NARROW = '(max-width: 699.98px)';

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/**
 * libraryView is 'shelf' or 'list': what this device was last switched to,
 * else the List on a phone and the wall wider.
 */
export function libraryView({ storage = store(), narrow = () => !!globalThis.matchMedia?.(NARROW)?.matches } = {}) {
  let v = null;
  try { v = storage?.getItem(KEY) ?? null; } catch { /* private mode: the device's default */ }
  if (v === 'shelf' || v === 'list') return v;
  return narrow() ? 'list' : 'shelf';
}

/** setLibraryView remembers `v` ('shelf' or 'list'); false when the browser keeps nothing. */
export function setLibraryView(v, { storage = store() } = {}) {
  if (v !== 'shelf' && v !== 'list') return false;
  try {
    storage.setItem(KEY, v);
    return storage.getItem(KEY) === v;
  } catch { return false; }
}

/** listOn and setListOn are the switch as Settings draws it (lib/device-prefs.js). */
export const listOn = () => libraryView() === 'list';
export function setListOn(on) {
  const ok = setLibraryView(on ? 'list' : 'shelf');
  try { globalThis.dispatchEvent?.(new Event(CHANGED)); } catch { /* no window: nothing showing to tell */ }
  return ok;
}
