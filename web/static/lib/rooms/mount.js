// web/static/lib/rooms/mount.js
// The tape page's way into the Studio: studio.js gives it the feed above the
// lanes and the input diagnostic at its foot.
//
// A module of its own, loaded by tape.html beside lib/tape/page.js rather
// than a change inside it, as Play mode's is: the Studio can be read in one
// piece, and a bug in it can't take the tape page down.

/**
 * start mounts the Studio. `load` fetches the Studio's module; tests pass
 * their own.
 */
export function start({ load = () => import('./studio.js'), doc = globalThis.document } = {}) {
  return load().then((m) => m.mountStudio(doc));
}

// On the tape page, on load. Everything above stays importable and testable.
if (typeof document !== 'undefined' && document.body?.classList.contains('tape-page')) {
  start().catch((e) => console.error('The Studio could not start:', e));
}
