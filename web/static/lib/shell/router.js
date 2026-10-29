// web/static/lib/shell/router.js
// The shell's router (docs/architecture/shell.md, The
// router and Moving between rooms): which room a URL is, which clicks on links it takes over, and how
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
 * WALLS is where each room is in the space, in the tabs' order: the Studio
 * (or Capture, which the Studio's tab is while the tape is off) on the left
 * wall, the Listening Room on the right. A switch from one wall to the other
 * turns the camera that way; a switch along one wall is a crossfade.
 */
export const WALLS = Object.freeze({ studio: 0, capture: 0, room: 1 });

/**
 * turnOf is how a switch from the room `from` to the room `to` is drawn:
 * 'right' or 'left' (the way the camera turns, to a room further along the
 * walls or back), or 'fade' (the same wall, or a room with no wall).
 */
export function turnOf(from, to) {
  const a = WALLS[from], b = WALLS[to];
  if (a == null || b == null || a === b) return 'fade';
  return b > a ? 'right' : 'left';
}

const LESS_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * viewTransition is how the router draws a switch by default: inside
 * document.startViewTransition where the browser has it, and straight away
 * where it has not. It answers the transition: {updateCallbackDone, ready,
 * finished, skipTransition()}, as the browser's ViewTransition is (one of
 * its own, already settled, without the API).
 *
 * Before it starts, the html element says how to draw it, for
 * css/rooms-motion.css: `data-turn` is 'right' or 'left' (the camera turns,
 * turnOf) or 'fade' (a crossfade: along one wall, and every switch with
 * less motion, which the person may turn on at any moment); and
 * `data-arriving` is the room a turn arrives in ('room', 'studio',
 * 'capture'), for that room's entrance. Both go when the transition has
 * finished (or was skipped); with less motion or no View Transitions there
 * is no `data-arriving` at all. A transition started after this one keeps
 * its own.
 */
export function viewTransition(doc, win) {
  let latest = 0;
  return (update, { from = null, to = null } = {}) => {
    if (typeof doc?.startViewTransition !== 'function') return settled(update());
    const html = doc.documentElement;
    const reduced = !!win?.matchMedia?.(LESS_MOTION)?.matches;
    const turn = reduced ? 'fade' : turnOf(from, to);
    const mine = ++latest;
    html?.setAttribute('data-turn', turn);
    if (turn !== 'fade' && to) html?.setAttribute('data-arriving', to);
    else html?.removeAttribute('data-arriving');
    const clear = () => {
      if (mine !== latest) return;
      html?.removeAttribute('data-turn');
      html?.removeAttribute('data-arriving');
    };
    let vt;
    try {
      vt = doc.startViewTransition(update);
    } catch (e) {
      clear();
      throw e;
    }
    Promise.resolve(vt.finished).then(clear, clear);
    return vt;
  };
}

/** settled is a switch drawn at once as a transition: its update has run. */
function settled(run) {
  const done = Promise.resolve(run);
  const after = done.then(() => undefined);
  after.catch(() => {});
  return { updateCallbackDone: done, ready: after, finished: after, skipTransition() {} };
}

/** drawn is what a `transition` answered, as a transition (an older one answers the update's promise). */
function drawn(t) {
  if (t && typeof t === 'object' && 'updateCallbackDone' in t) return t;
  return settled(t);
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
 *   doc        the document: body (its classes), activeElement, the click
 *              listener (capture), documentElement and elementFromPoint
 *   win        the window: scrollY, scrollTo, popstate, pagehide, and a
 *              press and its click (capture), with MouseEvent
 *   tapeOn     () -> the cached answer to "is the tape on" (nav.js keeps
 *              it as hindsight.tapeOn): true, false or null
 *   transition (update, {from, to}) -> the switch drawn, how a switch is
 *              drawn (viewTransition): a transition ({updateCallbackDone,
 *              ready, finished, skipTransition}), or a promise of `update`
 *              having run
 *   chrome     { setPath(path), setHelp(page), say(text), beforeSwitch() },
 *              all optional: the tabs' aria-current and lamp (nav), the help
 *              page (help), the polite live region, and what is closed
 *              before a room is left (the stack, lib/ui/layers.js leave()).
 *              beforeSwitch may answer a promise -- the stack's own Back
 *              still on its way -- which a go() waits for before it writes
 *              the history, or 'replace': the entry the history is on is
 *              the stack's, and nothing holds it now, so the room's entry
 *              is written over it. One that throws is reported and costs
 *              nothing else.
 *   keep       the body classes that are the shell's (KEEP_CLASSES)
 *   idle       (fn) -> runs fn when the page has nothing better to do
 *              (requestIdleCallback, a second at most; a timeout without
 *              it): when prewarm mounts each room
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
 *     room. An entry of the same room -- the stack's own, where there is no
 *     CloseWatcher (lib/ui/layers.js) -- is its owner's, so Back closes the
 *     player, a sheet or a menu first.
 *   - A switch first asks chrome.beforeSwitch to close what is open over
 *     the room (the menus): on a tap, before the new entry is pushed, so
 *     the stack's own history entry is gone first; on Back or Forward, as
 *     the switch starts.
 *   - A switch, inside the transition's update: the room left is hidden
 *     (view.js), its body classes are saved and taken off (all but `keep`),
 *     the room arrived in gets back the classes it left with plus its
 *     bodyClass, and is revealed (view.js reveal: shown as it was left,
 *     mounted first on a first visit it was not prewarmed for). The window
 *     scrolls to where that room was left (the entry's own scroll after a
 *     reload), and focus that was in the room left, or nowhere, moves to the
 *     new room's root. Then the tabs, the help page and the live region are
 *     told. Only once the transition has finished -- the turn over -- is
 *     the room woken (view.js wake): its own show, its title, its loops and
 *     its polls, so no redraw, fetch or import holds up the turn.
 *   - A switch asked for while one is still drawn (a second tap on a tab,
 *     Back) skips the drawing one's turn (skipTransition) and goes on.
 *   - A press while a switch is drawn ends the turn at once. Its click
 *     lands only on the desk that holds still (the header and the bar), on
 *     the control it was pressed on, once the swap is done; anywhere else
 *     (the room, turning or frozen in the picture, and laid out otherwise
 *     under it) it goes nowhere.
 *   - If showing the room throws (its mount, or its show), the router
 *     reports it and loads the address in full, with location.replace:
 *     the entry it pushed becomes the loaded page, so Back does not land on
 *     a dead copy of it. A router bug costs a reload, not a session.
 *   - Switches run one at a time, each making the shown room match the
 *     address as it is when that switch starts, so taps faster than a
 *     switch end in the room last asked for.
 *
 *   - prewarm() mounts, out of sight and one after another, each room a
 *     tab leads to now that is not shown and says it may be (a view's
 *     `prewarm`), so its first visit is a reveal and not a mount. boot.js
 *     calls it in idle time once the first room is up.
 *
 * Answers { start, go, stop, prewarm, shown, idle }: shown() is the id of
 * the room shown; idle() is a promise of the switches under way being done
 * (for tests, and for the smoke check).
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
  idle = null,
  onError = report,
} = {}) {
  const hosts = new Map(views.map((v) => [v.id, v]));
  const draw = transition || viewTransition(doc, win);
  const scrolls = new Map(); // each room's scrollY as it was left
  const classes = new Map(); // each room's body classes as it was left
  let shown = null;
  let started = false;
  let chain = Promise.resolve();
  let waiting = Promise.resolve(); // a go() waiting on beforeSwitch
  let drawing = null; // the switch's transition while it is drawn

  const route = (url) => routeFor(url, { base: loc.href, tapeOn: tapeOn() });
  const here = () => loc.pathname + loc.search + loc.hash;
  const entry = () => { const s = hist.state; return s && typeof s === 'object' ? s : {}; };
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const tell = (name, ...a) => { try { return chrome[name]?.(...a); } catch (e) { onError(e); return undefined; } };

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
    // Back or Forward to another room: what is open over this one closes
    // as it goes (a tap closed it in go(), before its entry). The history
    // has moved already, so nothing here waits on it.
    const closing = tell('beforeSwitch');
    if (closing && typeof closing.then === 'function') closing.then(null, () => {});
    const from = shown ? hosts.get(shown) : null;
    const to = hosts.get(r.view);
    const came = from ? from.id : null;
    // The room's own scroll while the shell lives; the entry's after a reload.
    const y = scrolls.has(to.id) ? scrolls.get(to.id) : finite(entry().scroll) ? entry().scroll : 0;
    let t;
    try {
      // Only flips: what is hidden, what is shown, the classes, the scroll
      // and the focus. The room's redraw, its fetches and its loops are
      // wake's, below, once the turn is over.
      t = drawn(draw(async () => {
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
        await to.reveal({ url: loc.href, from: came });
        win.scrollTo(0, y);
        // Taken out of the page with the room's header part, say: lost too.
        if (lost || a.isConnected === false) to.root.focus?.({ preventScroll: true });
        tell('setPath', r.path);
        tell('setHelp', to.def.help);
        tell('say', to.def.name ?? to.title ?? to.id);
      }, { from: came, to: to.id }));
      drawing = t;
      const done = () => { if (drawing === t) drawing = null; };
      Promise.resolve(t.finished).then(done, done);
      await t.updateCallbackDone;
      // The turn is over (or was skipped, or there is none): now the room
      // arrived in redraws, polls and starts its loops. Not while it turns:
      // on a tablet, work on the page then holds up the turn's first frames
      // (measured: 100-170 ms more of the old room, frozen, at 4x CPU), and
      // the room turns in as it was left -- a canvas keeps its picture.
      try { await t.finished; } catch { /* wake it all the same */ }
      await to.wake({ url: loc.href, from: came });
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
    // A switch still drawn gives way: its turn ends where it is, and this
    // one starts from the room it was going to.
    drawing?.skipTransition?.();
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
    // What is open over the room closes first; the stack may still be
    // taking its own history entry back, and the new one waits for that.
    const wait = tell('beforeSwitch');
    if (wait === 'replace') return enter(r, true);
    if (wait && typeof wait.then === 'function') {
      const run = Promise.resolve(wait).catch(onError).then(() => enter(r, replace));
      waiting = run;
      return run;
    }
    return enter(r, replace);
  }

  // enter writes the room's entry and switches to it.
  function enter(r, replace) {
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
  // A press while a switch is drawn. What is on the screen is the turn --
  // the room left, frozen until the turn's first frame, then the two walls
  // turning -- and the page under it is already the room arrived in, laid
  // out at rest (or, before the update has run, still the room left).
  // Chromium hit-tests the press to <html>; its click goes to <html> too
  // with a mouse, and with a finger through the overlay
  // (pointer-events: none) to whatever is laid out under it. So the press
  // ends the turn there and then, and its click lands only where the
  // picture and the page agree: on the desk that holds still (the header
  // and the bar), on the very control it was pressed on, once the switch
  // has done its swap. Anywhere else -- the room, or a key the swap took
  // away (the bar's at 1000 px and wider, the header's room part) -- the
  // click goes nowhere: a tap never does what you could not see.
  const DESK = '.appbar, #np';
  const CONTROL = 'a[href], button, input, select, textarea, label, [role="button"], [tabindex]';
  const NEAR_PX = 16; // a click this near its press is the press's (a finger's click may land a little off it)
  const SOON_MS = 1500; // ...and this soon after it
  let pressed = null; // {x, y, at, t, on}: the press a turn took, and the desk's control it was on
  const html = () => doc.documentElement;
  const under = (x, y) => { try { return doc.elementFromPoint?.(x, y) || null; } catch { return null; } };
  // The desk's control at an element: the key, the tab, the field (or the
  // element itself); null off the desk.
  const control = (el) => {
    if (!el || el === html() || !el.closest?.(DESK)) return null;
    return el.closest(CONTROL) || el;
  };
  function onPress(e) {
    if (!drawing) { pressed = null; return; }
    const t = drawing;
    try { t.skipTransition?.(); } catch (err) { onError(err); }
    // Hit-tested once the turn is over: while it is drawn, Chromium answers <html> for every point.
    pressed = { x: e.clientX, y: e.clientY, at: Date.now(), t, on: control(under(e.clientX, e.clientY)) };
  }
  function onPressedClick(e) {
    const p = pressed;
    if (!p) return;
    pressed = null;
    // A keyboard's click (no press at all), or one long after: not the press's.
    if (e.detail === 0 || Date.now() - p.at > SOON_MS) return;
    const near = Math.abs(e.clientX - p.x) <= NEAR_PX && Math.abs(e.clientY - p.y) <= NEAR_PX;
    const on = e.target === html() ? null : e.target;
    // The browser put it through the overlay, on the control it was pressed on: it lands as it is.
    if (on && near && p.on && control(on) === p.on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (on || !near || !p.on) return;
    // Given to <html>: once the swap is done, to the control pressed, if it is still under the finger.
    const give = () => {
      const el = under(p.x, p.y);
      if (!el || control(el) !== p.on) return;
      const Click = win.MouseEvent || globalThis.MouseEvent;
      el.dispatchEvent(new Click('click', {
        bubbles: true, cancelable: true, composed: true, view: win, detail: 1,
        clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
        altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, button: e.button,
      }));
    };
    Promise.resolve(p.t.updateCallbackDone).then(give, () => {}).catch(onError);
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
    win.addEventListener('pointerdown', onPress, true);
    win.addEventListener('click', onPressedClick, true);
    started = true;
    return 'shown';
  }

  const later = idle || ((fn) => {
    if (typeof win?.requestIdleCallback === 'function') win.requestIdleCallback(() => fn(), { timeout: 1000 });
    else setTimeout(fn, 200);
  });
  const whenIdle = () => new Promise((r) => later(r));

  /**
   * prewarm mounts, out of sight, each room a tab leads to now (the
   * Listening Room, and the Studio or Capture as the tape is) that is not
   * shown, has not been mounted, and says it may be (its view's
   * `prewarm`): once the room shown is up (its mount's `ready`, the
   * Studio's first poll), one at a time, each in idle time. A class one
   * put on <body> as it mounted is its own on its first visit. Answers the
   * ids of the rooms it mounted.
   */
  async function prewarm() {
    if (!started) return [];
    await hosts.get(shown)?.settled?.();
    const want = [];
    for (const path of ['/takes.html', '/']) {
      const v = hosts.get(route(path)?.view);
      if (v && v.def.prewarm && !want.includes(v)) want.push(v);
    }
    const done = [];
    for (const v of want) {
      await whenIdle();
      if (!started || v.id === shown || v.state !== 'new') continue;
      try {
        const taken = await v.prewarm();
        if (taken?.length) classes.set(v.id, [...new Set([...(classes.get(v.id) || []), ...taken])]);
        done.push(v.id);
      } catch (e) {
        onError(e);
      }
    }
    return done;
  }

  /** stop hands links and Back to the browser again. */
  function stop() {
    doc.removeEventListener('click', onClick, true);
    win.removeEventListener('popstate', onPop);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pointerdown', onPress, true);
    win.removeEventListener('click', onPressedClick, true);
    started = false;
  }

  return { start, go, stop, prewarm, shown: () => shown, idle: () => waiting.then(() => chain) };
}
