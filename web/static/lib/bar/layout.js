// web/static/lib/bar/layout.js
// The bar's layout, as the page lays out around it: folded by its grabber
// (fold.js), the phone's player pulled up (player.js), and something docked
// above it (the Studio's clip editor or action bar, Capture's drawer, in
// #np-dock). The router keeps a room's body classes with the room (np-fold)
// or for the shell (player-open, KEEP_CLASSES), so <body> is where the fold
// and the player are kept, and the page's own rules (styles.css) read the
// player off it: this is the surface's one place that writes them, and
// what the Studio hears them change by (ctx.barLayout), in place of a
// page-wide event (docs/plan/transport-extraction.md, decisions 2 and 3).
//
// The bar's root says the same on itself (data-fold, data-open,
// data-docked), and the bar's own stylesheet (css/bar.css) reads only the
// root, never <body> (steps 5c, 5d): written by set(), and by sync(), which the shell calls the
// moment the router has given a room its classes (chrome.classesGiven),
// in the same frame as the body. The fold is kept for the visit (through a
// reload) in the page's storage, when the page hands one.

export const NP_FOLD_KEY = 'hindsight.npFold';

/**
 * barLayout is `doc`'s: { snapshot(), folded, open, docked, set({folded,
 * open, docked}), sync(), onChange(fn) }. snapshot() is {folded, open,
 * docked}, frozen, the same object until one moves; set() writes what it is
 * given, and fn(after, before) hears it when that moved something, `before`
 * read as set() began, so a listener compares what moved and keeps no copy
 * of its own. A room switch that takes np-fold with the room says nothing:
 * what reads it reads it as it draws, and a copy kept across one would be
 * stale.
 *
 * Options:
 *   root     the bar's root (an element, or a function answering it), on
 *            which set() and sync() write data-fold, data-open and
 *            data-docked, each there while it is so
 *   storage  where the fold is kept for the visit (sessionStorage): read
 *            once here, so a page reloaded folded opens folded, and written
 *            by each set() that says the fold. None, and it is not kept.
 */
export function barLayout(doc = globalThis.document, { root = null, storage = null } = {}) {
  const fns = new Set();
  const has = (c) => !!doc?.body?.classList.contains(c);
  let docked = false;
  let snap = null;
  const snapshot = () => {
    const folded = has('np-fold');
    const open = has('player-open');
    if (!snap || snap.folded !== folded || snap.open !== open || snap.docked !== docked) snap = Object.freeze({ folded, open, docked });
    return snap;
  };
  const rootEl = () => (typeof root === 'function' ? root() : root) || null;
  const mark = (el, name, on) => {
    if (on && !el.hasAttribute(name)) el.setAttribute(name, '');
    else if (!on && el.hasAttribute(name)) el.removeAttribute(name);
  };
  // The root says what the body says, and whether something is docked.
  function sync() {
    const el = rootEl();
    if (!el) return;
    mark(el, 'data-fold', has('np-fold'));
    mark(el, 'data-open', has('player-open'));
    mark(el, 'data-docked', docked);
  }
  const keep = (folded) => {
    try {
      if (folded) storage?.setItem(NP_FOLD_KEY, '1');
      else storage?.removeItem(NP_FOLD_KEY);
    } catch { /* private mode */ }
  };

  let restored = false;
  try { restored = storage?.getItem(NP_FOLD_KEY) === '1'; } catch { /* private mode */ }
  if (restored) doc?.body?.classList.add('np-fold');
  sync();

  return {
    snapshot,
    get folded() { return has('np-fold'); },
    get open() { return has('player-open'); },
    get docked() { return docked; },
    set({ folded, open, docked: d } = {}) {
      const before = snapshot();
      if (folded !== undefined) {
        doc.body.classList.toggle('np-fold', !!folded);
        keep(!!folded);
      }
      if (open !== undefined) doc.body.classList.toggle('player-open', !!open);
      if (d !== undefined) docked = !!d;
      sync();
      const after = snapshot();
      if (after !== before) for (const fn of [...fns]) fn(after, before);
    },
    sync,
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
