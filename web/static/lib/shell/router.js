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
import { report } from '../objects/motion.js';
import { classesOf } from './view.js';

/**
 * KEEP_CLASSES are the body classes that are the shell's, not a room's:
 * the phone's player (bar/player.js) and help mode (help/help.js). They stay
 * on through a switch; every other class on <body> belongs to the room that
 * is shown.
 */
export const KEEP_CLASSES = Object.freeze(['help-mode', 'player-open']);

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

/**
 * viewTransition is how the router draws a switch by default: inside
 * document.startViewTransition where the browser has it and the person has
 * not asked for less motion (styles.css names the `tabs` and `tab-lit`
 * transitions), and straight away otherwise. `update` is the swap; the
 * answer settles when it has run, and rejects with its error.
 */
export function viewTransition(doc, win) {
  return (update) => {
    const reduced = !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduced || typeof doc?.startViewTransition !== 'function') return update();
    return doc.startViewTransition(update).updateCallbackDone;
  };
}

/**
 * createRouter is the shell's router, started once by boot.js. Start it
 * after initHelp: help mode's capture listeners on the document must hear a
 * click first, so a tap on a tab in help mode shows its tip and does not
 * switch rooms.
 *
 *   views      the views this shell holds (createView's answers). A room
 *              whose view is not among them is loaded in full, so a shell
 *              that holds only the Listening Room still sends the Studio
 *              tab to tape.html.
 *   location   href, origin, pathname, search, hash; assign, replace, reload
 *   history    state, pushState, replaceState, scrollRestoration
 *   doc        the document: body (its classes), activeElement, and the
 *              click listener (capture)
 *   win        the window: scrollY, scrollTo, popstate, pagehide
 *   tapeOn     () -> the cached answer to "is the tape on" (nav.js keeps
 *              it as hindsight.tapeOn): true, false or null
 *   transition (update) -> promise, how a switch is drawn (viewTransition)
 *   chrome     { setPath(path), setHelp(page), say(text) }, all optional:
 *              the tabs' aria-current and lamp (nav), the help page
 *              (help), the polite live region. One that throws is reported
 *              and costs nothing else.
 *   keep       the body classes that are the shell's (KEEP_CLASSES)
 *   onError    where a failure is reported
 *
 * What it does:
 *   - start() boots the room the address names, with replaceState and not
 *     a second load (/ with the tape on says /tape.html). A room the shell
 *     does not hold, or a ?take=, is loaded in full instead. A room that
 *     fails to boot is reported and never reloaded: it would fail again.
 *   - A click on a link to a room (linkTarget, routeFor) is go().
 *   - go(url) writes the scroll of the room being left into its entry,
 *     pushes {shell: 1, view, scroll} at the room's address, and switches.
 *     A URL that is not a room this shell holds is location.assign'd.
 *   - popstate switches only when the entry's address names a different
 *     room. An entry of the same room -- the player's {player: 1}, the
 *     cassette sheet's {cassette} -- is its owner's, so Back closes the
 *     player or the sheet first.
 *   - A switch: the room left is hidden (view.js), its body classes are
 *     saved and taken off (all but `keep`), the room arrived in gets back
 *     the classes it left with plus its bodyClass, and is shown. Its title
 *     goes up (view.js), the window scrolls to where that room was left
 *     (the entry's own scroll after a reload), and focus that was in the
 *     room left, or nowhere, moves to the new room's root. Then the tabs,
 *     the help page and the live region are told.
 *   - If showing the room throws (its mount, or its show), the router
 *     reports it and loads the address in full, with location.replace:
 *     the entry it pushed becomes the loaded page, so Back does not land on
 *     a dead copy of it. A router bug costs a reload, not a session.
 *   - Switches run one at a time, each making the shown room match the
 *     address as it is when that switch starts, so taps faster than a
 *     switch end in the room last asked for.
 *
 * Answers { start, go, stop, shown, idle }: shown() is the id of the room
 * shown; idle() is a promise of the switches under way being done (for
 * tests, and for the smoke check).
 */
export function createRouter({
  views = [],
  location: loc = globalThis.location,
  history: hist = globalThis.history,
  doc = globalThis.document,
  win = globalThis.window,
  tapeOn = () => null,
  transition = null,
  chrome = {},
  keep = KEEP_CLASSES,
  onError = report,
} = {}) {
  const hosts = new Map(views.map((v) => [v.id, v]));
  const draw = transition || viewTransition(doc, win);
  const scrolls = new Map(); // each room's scrollY as it was left
  const classes = new Map(); // each room's body classes as it was left
  let shown = null;
  let started = false;
  let chain = Promise.resolve();

  const route = (url) => routeFor(url, { base: loc.href, tapeOn: tapeOn() });
  const here = () => loc.pathname + loc.search + loc.hash;
  const entry = () => { const s = hist.state; return s && typeof s === 'object' ? s : {}; };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const tell = (name, ...a) => { try { chrome[name]?.(...a); } catch (e) { onError(e); } };

  // className, not the classList's iterator: what a room left is read once.
  function takeClasses(id) {
    const mine = String(doc.body.className || '').split(/\s+/).filter((c) => c && !keep.includes(c));
    classes.set(id, mine);
    if (mine.length) doc.body.classList.remove(...mine);
  }
  function giveClasses(host) {
    const want = new Set([...(classes.get(host.id) || []), ...classesOf(host.def)]);
    if (want.size) doc.body.classList.add(...want);
  }

  async function swap(r) {
    const from = shown ? hosts.get(shown) : null;
    const to = hosts.get(r.view);
    // The room's own scroll while the shell lives; the entry's after a reload.
    const y = scrolls.has(to.id) ? scrolls.get(to.id) : finite(entry().scroll) ? entry().scroll : 0;
    try {
      await draw(async () => {
        // Where focus is, read before hiding the room it is in blurs it.
        const a = doc.activeElement;
        const lost = !a || a === doc.body || a === doc.documentElement || !!from?.root.contains(a);
        if (from) {
          scrolls.set(from.id, win.scrollY);
          await from.hide();
          takeClasses(from.id);
        }
        shown = to.id;
        giveClasses(to);
        await to.show({ url: loc.href, from: from ? from.id : null });
        win.scrollTo(0, y);
        // Taken out of the page with the room's header part, say: lost too.
        if (lost || a.isConnected === false) to.root.focus?.({ preventScroll: true });
        tell('setPath', r.path);
        tell('setHelp', to.def.help);
        tell('say', to.def.name ?? to.title ?? to.id);
      });
    } catch (e) {
      shown = null;
      onError(e);
      loc.replace(loc.href);
      return 'failed';
    }
    return 'switched';
  }

  // Make the room shown match the address as it is now.
  async function step() {
    try {
      const r = route(loc.href);
      if (!r) { loc.reload(); return 'load'; }
      if (r.load) { loc.replace(r.load); return 'load'; }
      if (!hosts.has(r.view)) { loc.replace(r.href); return 'load'; }
      if (r.href !== here()) hist.replaceState(hist.state, '', r.href);
      if (r.view === shown) return 'same';
      return await swap(r);
    } catch (e) {
      onError(e);
      return 'failed';
    }
  }
  function sync() {
    const run = chain.then(step);
    chain = run;
    return run;
  }

  /**
   * go(url, {replace}) moves to `url`: a switch when it is a room this shell
   * holds, else a load (location.assign, or location.replace with
   * `replace`). Answers a promise of 'switched' | 'same' | 'load' |
   * 'failed'. The room already shown is 'same': no entry, no switch.
   */
  function go(url, { replace = false } = {}) {
    const r = route(url);
    if (!started || !r || r.load || !hosts.has(r.view)) {
      const to = !r ? String(url) : r.load || r.href;
      if (replace) loc.replace(to); else loc.assign(to);
      return Promise.resolve('load');
    }
    const cur = route(loc.href);
    if (cur && cur.view === r.view) return Promise.resolve('same');
    // Back to this entry after a reload finds the room where it was left.
    if (!replace && cur && cur.view === shown) hist.replaceState({ ...entry(), scroll: win.scrollY }, '');
    const next = { shell: 1, view: r.view, scroll: scrolls.get(r.view) ?? 0 };
    if (replace) hist.replaceState(next, '', r.href); else hist.pushState(next, '', r.href);
    return sync();
  }

  function onClick(e) {
    const u = linkTarget(e, loc.href);
    if (!u) return;
    const r = route(u);
    if (!r || (r.view && !hosts.has(r.view))) return; // not a room here: the browser's
    e.preventDefault();
    go(u.href);
  }
  const onPop = () => { sync(); };
  // A reload, or Back from a page that is not the shell, lands where the room was.
  const onPageHide = () => {
    try { hist.replaceState({ ...entry(), scroll: win.scrollY }, ''); } catch (e) { onError(e); }
  };

  /** start boots the room the address names. 'shown' | 'load' | 'failed' | 'none'. */
  async function start() {
    if (started) return 'shown';
    try { hist.scrollRestoration = 'manual'; } catch { /* the browser restores it, as before */ }
    const r = route(loc.href);
    if (!r) { onError(new Error(`the shell has no room at ${loc.pathname}`)); return 'none'; }
    if (r.load) { loc.replace(r.load); return 'load'; }
    if (!hosts.has(r.view)) {
      if (r.href !== here()) { loc.replace(r.href); return 'load'; }
      onError(new Error(`this shell does not hold the ${r.view} room`));
      return 'none';
    }
    hist.replaceState({ ...entry(), shell: 1, view: r.view }, '', r.href);
    const to = hosts.get(r.view);
    const y = finite(entry().scroll) ? entry().scroll : 0;
    try {
      shown = to.id;
      giveClasses(to);
      await to.show({ url: loc.href, from: null });
    } catch (e) {
      // Never a reload: a room that fails as the page loads would fail again.
      shown = null;
      onError(e);
      return 'failed';
    }
    if (y) win.scrollTo(0, y);
    tell('setPath', r.path);
    tell('setHelp', to.def.help);
    // Only now: until the room is up, a tap on a tab is a load, as today.
    doc.addEventListener('click', onClick, true);
    win.addEventListener('popstate', onPop);
    win.addEventListener('pagehide', onPageHide);
    started = true;
    return 'shown';
  }

  /** stop hands links and Back to the browser again. */
  function stop() {
    doc.removeEventListener('click', onClick, true);
    win.removeEventListener('popstate', onPop);
    win.removeEventListener('pagehide', onPageHide);
    started = false;
  }

  return { start, go, stop, shown: () => shown, idle: () => chain };
}
