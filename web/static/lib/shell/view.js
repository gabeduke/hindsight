// web/static/lib/shell/view.js
// The view contract (docs/superpowers/plans/2026-10-17-phase1-shell.md §2.3):
// what a room is to the shell, and what the shell hands it. The shell is one
// document that owns the header, the bar and the audio engine. The Studio,
// the Listening Room and Capture are views inside it, switched by the router
// (router.js), so a move between rooms never reloads the page and what plays
// in the bar plays on.
//
// A view is mounted once, on its first visit, and from then on it is only
// shown and hidden. page.js, shelf-page.js and app.js are module singletons;
// making them start twice is a rewrite with a silent failure (a listener
// added twice makes Space press ▶ twice: play and stop in one tap). A hidden
// view keeps its DOM, so coming back is instant, and it costs nothing: no
// polls, no frames, no keys. That is ctx's job. Everything a view does at
// window or document level goes through ctx.on, ctx.every and ctx.loop,
// which do nothing while it is hidden and pick up again when it is shown, so
// "hidden" is kept in one place and not remembered at sixty call sites
// (docs/superpowers/plans/2026-10-17-phase1-spike-b-audit.md has the list).
//
// Pure: the document, the timers and the ticker are handed in, so the tests
// stand in for all three (view.test.js). Nothing here is wired into a page
// yet; the shell's boot.js will be the first to call it.

import { Loop, ticker, report } from '../objects/motion.js';

/**
 * A view is described by a plain object, a view module's export:
 *
 *   {
 *     id: 'room',                  // the router's name for it: 'studio', 'room' or 'capture'
 *     title: 'Takes — Hindsight',  // document.title while it is shown; ctx.setTitle changes it
 *     name: 'Listening Room',      // what the live region says on arrival (default: title)
 *     bodyClass: 'shelf-page',     // its classes on <body>: a string (space-separated) or an array
 *     help: 'takes',               // the help page while it is shown (initHelp's `page`)
 *     mount(ctx) -> handle, or a promise of one
 *   }
 *
 * Which URLs show a view is the router's to say (routeFor), not the view's:
 * `/` is the Studio with the tape on and Capture with it off, which no list
 * of paths on the view could express.
 *
 * mount(ctx) runs ONCE, on the first visit. The view's root is already shown
 * when it runs, so the view can measure itself, and every listener, poll and
 * loop it starts through ctx is live at once. It resolves to a handle, each
 * part of which is optional:
 *
 *   show({ url, from, first })
 *       Every visit, the first one included (right after mount). Redraw, and
 *       put back what hide() put away. `url` is location.href, already the
 *       view's own; `from` is the id of the view that was left, or null at
 *       boot; `first` is true on the visit that mounted it. The view's polls
 *       (ctx.every) run once after it, and its loops (ctx.loop) resume.
 *   hide()
 *       Every time the view is left, while it is still shown. Close its
 *       menus, inspectors and modal sheets; stop view-local previews (bounce,
 *       an audition); close its sockets (connectLive().close()). It cannot
 *       refuse: leaving the Studio during a recording shows a REC chip with a
 *       Stop in the header, never a refusal (Gabe, 2026-10-17). Its polls,
 *       loops and listeners go quiet right after its synchronous part runs.
 *   destroy()
 *       Gone for good: undo what plain addEventListener calls did. Whatever
 *       went through ctx is undone by the shell, and ctx.signal is aborted.
 *       The router never calls it in Phase 1 (the plan's Q1); views are
 *       kept, hidden.
 *
 * A view never creates the bar's audio (that is ctx.engine's), never sets
 * `location` to a room path (that is ctx.go), and never writes
 * document.title (that is ctx.setTitle).
 */

/**
 * The context a view is mounted with. Frozen. Besides what the shell shares
 * with every view (spread in from `shared`: engine, go, tapes, toast …):
 *
 *   id           the view's id
 *   root         its <section>, filled from its template
 *   headerSlot   a Slot in the header: the view's .appbar-page part goes here
 *   dockSlot     a Slot in #np-dock, above the bar: the Studio's clip editor
 *                and action bar, Play's strip
 *   barSlot      a Slot inside #np, the only way a view adds to the bar
 *                (the doorway's seat and grease pencil, doorway.js:437,442)
 *   active()     true while the view is shown and the document is visible
 *   on(target, type, fn, opts) -> off
 *                addEventListener on a window, document or any target,
 *                except that fn is not called while the view is hidden.
 *                The listener stays registered, so its order among the
 *                target's other listeners never changes. `opts` is
 *                addEventListener's: capture, passive and signal as usual,
 *                and `once` means once while shown (an event that arrives
 *                while hidden does not use it up). Use it for every window
 *                or document listener; one on the view's own elements needs
 *                no gate (a hidden subtree gets no input). A listener that
 *                must hear events while the view is hidden (a take's
 *                `ended`) is not ctx.on's.
 *   every(fn, ms) -> off
 *                setInterval, for polls. fn runs every `ms` while the view is
 *                active; while it is hidden no timer is armed at all; while
 *                the document is hidden the ticks are skipped. fn runs once
 *                each time the view is shown -- the first show, right after
 *                mount, included, so a view does not call it itself first --
 *                and once when the document becomes visible again while the
 *                view is shown. An error or a rejected promise from fn is
 *                reported, not thrown.
 *   loop(fn) -> { start(), stop(), running }
 *                A Loop (objects/motion.js) on the shared ticker. start()
 *                steps fn(dt, now) every frame until it returns false, as a
 *                Loop does. While the view is hidden the loop is parked; one
 *                that was running when the view was hidden, or was started
 *                while hidden, starts again when the view is shown. One that
 *                parked itself (returned false) stays parked.
 *   signal       an AbortSignal, aborted by destroy() and by a mount that
 *                throws: for fetches, and for listeners on the view's own
 *                elements
 *   setTitle(text)
 *                the view's document.title: written now if it is shown, and
 *                each time it is shown again
 */

/**
 * A Slot is a place in the shell's chrome that a view may add nodes to.
 * What a view adds is in the page only while the view is shown: hide()
 * takes it out and show() puts it back where it was asked to go, so a hidden
 * view leaves no trace in the header, the dock or the bar, and the shell's
 * CSS needs no "is this view's part hidden" selectors (§2.7).
 *
 *   add(node, where) -> remove
 *     where: omitted       the slot's own place (its `before`, or the end of
 *                          its parent)
 *            { before: el } just before el, wherever el is
 *            { after: el }  just after el (the doorway's seat goes after #np-open)
 *            'first'        the start of the slot's parent (Play's strip in #np)
 *     An `el` that is no longer in the page when the view is shown means
 *     the slot's own place. remove() takes the node out for good.
 */

/** classesOf is a view's bodyClass as a list: a string, space-separated, or an array. */
export function classesOf(def) {
  return [].concat(def?.bodyClass ?? []).flatMap((c) => String(c).split(/\s+/)).filter(Boolean);
}

const resolve = (v) => (typeof v === 'function' ? v() : v) || null;

/**
 * makeSlot is one view's handle on one slot. `spec` is {parent, before}:
 * nodes or functions that answer them (a header tool made after the slots
 * were, say). `isShown` is the view's state; put() and take() are the
 * host's, for show and hide.
 */
function makeSlot(spec, isShown, name) {
  const placed = [];
  const place = ({ node, where }) => {
    const ref = where && typeof where === 'object' ? where.before || where.after : null;
    if (ref && ref.isConnected) {
      if (where.before) ref.before(node); else ref.after(node);
      return;
    }
    const parent = resolve(spec?.parent);
    if (!parent) return;
    if (where === 'first') { parent.prepend(node); return; }
    const before = resolve(spec?.before);
    if (before && before.parentElement === parent) before.before(node);
    else parent.append(node);
  };
  return {
    add(node, where) {
      if (!node) throw new TypeError(`${name}.add needs a node`);
      const ref = where && typeof where === 'object' ? where.before || where.after : null;
      if (!ref && !resolve(spec?.parent)) throw new Error(`this shell has no ${name}`);
      const entry = { node, where };
      placed.push(entry);
      if (isShown()) place(entry);
      return () => {
        const i = placed.indexOf(entry);
        if (i >= 0) placed.splice(i, 1);
        node.remove();
      };
    },
    put() { for (const e of placed) place(e); },
    take() { for (const e of placed) e.node.remove(); },
    clear() { this.take(); placed.length = 0; },
  };
}

/**
 * createView is the shell's side of one view: it mounts it on the first
 * show, builds its ctx, and keeps "hidden" true of everything that went
 * through ctx. The router (router.js) only calls show() and hide().
 *
 *   def        the view (above)
 *   root       its <section> in the shell. Hidden here until it is shown.
 *   template   a <template> cloned into root once, before mount; or none,
 *              when root already holds the markup
 *   slots      { header, dock, bar }: each {parent, before}, where that
 *              slot's nodes go. #np-dock's is {parent: #np-dock, before:
 *              #np}: a place, not a wrapper element (spike D: a wrapper
 *              breaks the .np-dock > .clip-editor selectors).
 *   shared     what every view's ctx carries: engine, go, tapes, toast …
 *   doc        for document.title, visibilityState and visibilitychange
 *   timers     {setInterval, clearInterval}
 *   clock      the ticker the loops run on (the shared one)
 *   onError    where an error a view throws is reported
 *
 * Answers {id, def, root, ctx, state, shown, title, show, hide, destroy}.
 * state is 'new' | 'mounting' | 'shown' | 'hidden' | 'failed' | 'destroyed'.
 */
export function createView(def, {
  root,
  template = null,
  slots = {},
  shared = {},
  doc = globalThis.document,
  timers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) },
  clock = ticker,
  onError = report,
} = {}) {
  if (!def || typeof def.id !== 'string' || !def.id) throw new TypeError('a view needs an id');
  if (typeof def.mount !== 'function') throw new TypeError(`the ${def.id} view needs a mount(ctx)`);
  if (!root) throw new TypeError(`the ${def.id} view needs a root`);

  let state = 'new';
  let shown = false;
  let handle = null;
  let showing = null; // the visit under way
  let first = true;
  let title = def.title ?? null;
  let ctx = null;
  const controller = new AbortController();
  const offs = new Set(); // ctx.on's
  const polls = new Set(); // ctx.every's: {fn, ms, id}
  const loops = new Set(); // ctx.loop's: {loop, wanted}
  const isShown = () => shown;
  const slot = {
    header: makeSlot(slots.header, isShown, 'headerSlot'),
    dock: makeSlot(slots.dock, isShown, 'dockSlot'),
    bar: makeSlot(slots.bar, isShown, 'barSlot'),
  };
  const visible = () => (doc?.visibilityState ?? 'visible') === 'visible';
  const active = () => shown && visible();

  root.hidden = true;

  const run = (p) => {
    try {
      const r = p.fn();
      if (r && typeof r.then === 'function') r.then(null, onError);
    } catch (e) { onError(e); }
  };
  const arm = (p) => {
    if (p.id != null) timers.clearInterval(p.id);
    p.id = timers.setInterval(() => { if (active()) run(p); }, p.ms);
  };
  const disarm = (p) => { if (p.id != null) timers.clearInterval(p.id); p.id = null; };
  const onVisibility = () => { if (active()) for (const p of [...polls]) run(p); };

  function on(target, type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const once = !!(opts && typeof opts === 'object' && opts.once);
    const signal = opts && typeof opts === 'object' ? opts.signal : undefined;
    if (signal?.aborted) return () => {};
    // `once` and `signal` are kept here, not handed on: a native once would
    // be used up by an event that arrived while the view was hidden.
    const native = opts && typeof opts === 'object' ? { capture, passive: opts.passive } : capture;
    let gone = false;
    const off = () => {
      if (gone) return;
      gone = true;
      offs.delete(off);
      target.removeEventListener(type, gated, capture);
      signal?.removeEventListener?.('abort', off);
    };
    function gated(e) {
      if (!shown) return undefined;
      if (once) off();
      return fn.call(this, e);
    }
    target.addEventListener(type, gated, native);
    offs.add(off);
    signal?.addEventListener?.('abort', off, { once: true });
    return off;
  }

  function every(fn, ms) {
    if (typeof fn !== 'function') throw new TypeError('every needs a function');
    const p = { fn, ms: Math.max(0, Number(ms) || 0), id: null };
    polls.add(p);
    if (shown) arm(p);
    return () => { disarm(p); polls.delete(p); };
  }

  function loop(fn) {
    const entry = { wanted: false, loop: null };
    // A step that parks itself, or throws, is no longer wanted: show() does
    // not wake it.
    entry.loop = new Loop((dt, now) => {
      let more = false;
      try { more = fn(dt, now) !== false; } finally { if (!more) entry.wanted = false; }
      return more;
    }, clock);
    loops.add(entry);
    return {
      // A destroyed or failed view is never shown again, so its loops never start.
      start() { entry.wanted = true; if (shown) entry.loop.start(); },
      stop() { entry.wanted = false; entry.loop.stop(); },
      get running() { return entry.loop.running; },
    };
  }

  function setTitle(text) {
    title = text == null ? null : String(text);
    if (shown && title != null && doc) doc.title = title;
  }

  // Everything that went through ctx goes quiet: the view is out of sight.
  function quiet() {
    shown = false;
    for (const p of polls) disarm(p);
    for (const l of loops) l.loop.stop();
    slot.header.take(); slot.dock.take(); slot.bar.take();
    root.hidden = true;
  }

  // ... and, for good, is undone.
  function teardown() {
    quiet();
    for (const off of [...offs]) off();
    polls.clear();
    for (const l of loops) { l.wanted = false; l.loop.stop(); }
    loops.clear();
    slot.header.clear(); slot.dock.clear(); slot.bar.clear();
    doc?.removeEventListener?.('visibilitychange', onVisibility);
    controller.abort();
  }

  async function mount() {
    state = 'mounting';
    if (template) root.appendChild(template.content.cloneNode(true));
    // The router moves focus here when it was in the room that was left.
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    ctx = Object.freeze({
      ...shared,
      id: def.id,
      root,
      headerSlot: { add: slot.header.add },
      dockSlot: { add: slot.dock.add },
      barSlot: { add: slot.bar.add },
      active,
      on,
      every,
      loop,
      signal: controller.signal,
      setTitle,
    });
    doc?.addEventListener?.('visibilitychange', onVisibility);
    handle = (await def.mount(ctx)) || {};
  }

  async function show({ url = null, from = null } = {}) {
    if (state === 'destroyed') throw new Error(`the ${def.id} view was destroyed`);
    if (state === 'failed') throw new Error(`the ${def.id} view failed to mount`);
    if (state === 'shown') return;
    if (showing) return showing;
    shown = true;
    root.hidden = false;
    slot.header.put(); slot.dock.put(); slot.bar.put();
    showing = (async () => {
      try {
        if (!handle) await mount();
        await handle.show?.({ url, from, first });
      } catch (e) {
        // A mount that throws leaves nothing behind: whatever it started
        // through ctx is undone, and it is not tried again (a second mount
        // would add every listener the first one did a second time).
        if (state === 'mounting') { state = 'failed'; teardown(); } else { state = 'hidden'; quiet(); }
        throw e;
      } finally {
        showing = null;
      }
      first = false;
      state = 'shown';
      if (title != null && doc) doc.title = title;
      for (const l of loops) if (l.wanted) l.loop.start();
      for (const p of [...polls]) { run(p); if (shown) arm(p); }
    })();
    return showing;
  }

  async function hide() {
    if (state !== 'shown') return;
    let r;
    try { r = handle.hide?.(); } catch (e) { onError(e); }
    state = 'hidden';
    quiet();
    try { await r; } catch (e) { onError(e); }
  }

  function destroy() {
    if (state === 'destroyed') return;
    const was = handle;
    if (state === 'shown') {
      try { handle.hide?.(); } catch (e) { onError(e); }
    }
    state = 'destroyed';
    teardown();
    try { was?.destroy?.(); } catch (e) { onError(e); }
  }

  return {
    id: def.id,
    def,
    root,
    get ctx() { return ctx; },
    get state() { return state; },
    get shown() { return shown; },
    get title() { return title; },
    show,
    hide,
    destroy,
  };
}
