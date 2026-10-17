// web/static/lib/shell/router.js
// The shell's router (docs/superpowers/plans/2026-10-17-phase1-shell.md
// §2.6): which room a URL is, which clicks on links it takes over, and how
// a move between rooms happens without loading the page -- so the take, the
// tape on this device and the feed in the bar never stop or restart.
//
// The rooms are views (view.js). The URL stays a real path, so a reload, a
// deep link and the installed app's start all boot the room their path
// names. Anything that is not a room -- the take page, the rig, the guide, a
// file -- is left to the browser and loads as it does today.
//
// Pure: the location, the history, the document and the window are handed
// in, so the tests stand in for all of them (router.test.js). Nothing here
// is wired into a page yet.

import { studioRedirect } from '../nav.js';
import { askedTake } from '../room/tap.js';

/**
 * routeFor says what the shell does with `url` (a URL, or a string resolved
 * against `base`), given the cached answer to "is the tape on" (`tapeOn`:
 * true, false, or null for no answer yet):
 *
 *   { view, path, href }  a room. `view` is 'studio', 'room' or 'capture';
 *                         `path` is its canonical path and `href` that path
 *                         with the URL's query and hash, which is what the
 *                         address bar should say.
 *   { load }              a room's URL that is really a page: load `load`
 *                         in full. /takes.html?take=NAME is a take to name,
 *                         and a take is named on Open (room/tap.js askedTake).
 *   null                  not the shell's: another origin, or any other path.
 *
 * `/` and `/index.html` are the Studio with the tape on (at /tape.html) and
 * Capture with it off (at `/`), and /tape.html with the tape off is
 * Capture: that is nav.js's studioRedirect, applied without a second load.
 * With no answer yet, each path keeps its own room, as index.html's redirect
 * does today.
 */
export function routeFor(url, { base, tapeOn = null } = {}) {
  let u;
  try { u = new URL(String(url), base); } catch { return null; }
  if (base) {
    let origin;
    try { origin = new URL(base).origin; } catch { return null; }
    if (u.origin !== origin) return null;
  }
  const tail = u.search + u.hash;
  const p = u.pathname;
  if (p === '/takes.html') {
    const load = askedTake({ search: u.search });
    if (load) return { load };
    return { view: 'room', path: p, href: p + tail };
  }
  if (p === '/' || p === '/index.html' || p === '/tape.html') {
    const to = studioRedirect(p, tapeOn) || p;
    // FileServer answers /index.html with a redirect to /: one address for Capture.
    const path = to === '/index.html' ? '/' : to;
    return { view: path === '/tape.html' ? 'studio' : 'capture', path, href: path + tail };
  }
  return null;
}

/**
 * linkTarget is the URL a click on a link would go to, when the router may
 * take that click over; null when it is the browser's to handle as it would
 * anywhere:
 *   - already handled (defaultPrevented): help mode's tips, a view's own;
 *   - not the main button, or with a modifier key: a new tab or window, a
 *     download (⌘, Ctrl, Shift, Alt, the middle button);
 *   - a link with a `target` other than _self, or with `download`;
 *   - another origin, or an href that does not parse;
 *   - a jump to a #fragment within this very page.
 * Whether the URL is a room is routeFor's to say. `here` is location.href.
 */
export function linkTarget(e, here) {
  if (!e || e.defaultPrevented) return null;
  if (e.button != null && e.button !== 0) return null;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target?.closest?.('a[href]');
  if (!a) return null;
  const target = (a.getAttribute('target') || '').trim().toLowerCase();
  if (target && target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  let u, h;
  try { h = new URL(here); u = new URL(a.getAttribute('href'), a.baseURI || here); } catch { return null; }
  if (u.origin !== h.origin) return null;
  if (u.hash && u.pathname === h.pathname && u.search === h.search) return null;
  return u;
}
