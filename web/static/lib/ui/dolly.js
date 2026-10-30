// web/static/lib/ui/dolly.js
// The dolly (docs/architecture/shell.md, "Moving between rooms"; the-studio-
// space.md, "The studio is a place"): opening a take moves in to it, and
// ‹ Takes moves back out, while the header and the bar hold still. Open is
// a page of its own, so this is a cross-document View Transition: each page
// says which way it goes as a transition type, `dolly-in` or `dolly-out`,
// and css/rooms-motion.css draws it. A take to another take, or a page to
// the rig or the guide, crossfades as before.
//
// It runs in each page's <head>, render-blocking, so the new page has said
// its type by the time it first paints (pagereveal); the page going says it
// too (pageswap), so its header and bar are captured by name.

/** The page that is Open. */
export const OPEN = '/wave.html';

/** The rooms' pages (lib/shell/router.js): the shell, which loads this too. */
export const ROOMS = ['/', '/index.html', '/tape.html', '/takes.html'];

/**
 * dollyType is the way a move from page `from` to page `to` goes: in from a
 * room to Open, out from Open to a room, or neither (null). The rig and the
 * guide don't say a type, so a move to or from them crossfades.
 */
export function dollyType(from, to) {
  if (ROOMS.includes(from) && to === OPEN) return 'dolly-in';
  if (from === OPEN && ROOMS.includes(to)) return 'dolly-out';
  return null;
}

const pathOf = (url) => { try { return new URL(url, globalThis.location?.href).pathname; } catch { return null; } };

/** wireDolly says each move's type on `win`'s two sides of it. */
export function wireDolly(win = globalThis) {
  win.addEventListener('pageswap', (e) => {
    const type = dollyType(win.location.pathname, pathOf(e.activation?.entry?.url));
    if (type) e.viewTransition?.types?.add(type);
  });
  win.addEventListener('pagereveal', (e) => {
    const type = dollyType(pathOf(win.navigation?.activation?.from?.url), win.location.pathname);
    if (type) e.viewTransition?.types?.add(type);
  });
}

if (typeof window !== 'undefined' && window.document) wireDolly(window);
