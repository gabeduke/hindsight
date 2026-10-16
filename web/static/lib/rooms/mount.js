// web/static/lib/rooms/mount.js
// The tape page's way into the two rooms. With the per-device flag on
// (flag.js), the tape page is the Studio: studio.js gives it the feed above
// the lanes and the about line at its foot.
//
// A module of its own, loaded by tape.html beside lib/tape/page.js rather
// than a change inside it, as Play mode's is: the Studio can be read and
// removed in one piece, and a bug in it can't take the tape page down. With
// the flag off it reads one localStorage key and stops -- studio.js isn't
// even fetched, so nothing is drawn, listened for or asked of the Pi.

import { on } from './flag.js';

/**
 * start mounts the Studio, or returns null when the flag is off without
 * touching the page. `load` fetches the Studio's module; tests pass their
 * own.
 */
export function start({ flagOn = on, load = () => import('./studio.js'), doc = globalThis.document } = {}) {
  if (!flagOn()) return null;
  return load().then((m) => m.mountStudio(doc));
}

// On the tape page, on load. Everything above stays importable and testable.
if (typeof document !== 'undefined' && document.body?.classList.contains('tape-page')) {
  start()?.catch((e) => console.error('The Studio could not start:', e));
}
