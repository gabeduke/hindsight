// web/static/lib/bar/layout.js
// The bar's layout, as the page lays out around it: folded by its grabber
// (fold.js), and the phone's player pulled up (player.js). The page's own
// rules read it off <body> (body.np-fold, body.player-open), and the router
// keeps a room's body classes with the room (np-fold) or for the shell
// (player-open, KEEP_CLASSES), so the body is where it is kept: this is the
// surface's one place that writes it, and what the Studio hears it change
// by (ctx.barLayout), in place of a page-wide event
// (docs/plan/transport-extraction.md, decisions 2 and 3).

/**
 * barLayout is `doc`'s: { snapshot(), folded, open, set({folded, open}),
 * onChange(fn) }. snapshot() is {folded, open}, frozen, the same object
 * until one moves; set() writes what it is given, and fn(snapshot) hears it
 * when that moved something. A room switch that takes np-fold with the room
 * says nothing: what reads it reads it as it draws.
 */
export function barLayout(doc = globalThis.document) {
  const fns = new Set();
  const has = (c) => !!doc?.body?.classList.contains(c);
  let snap = null;
  const snapshot = () => {
    const folded = has('np-fold');
    const open = has('player-open');
    if (!snap || snap.folded !== folded || snap.open !== open) snap = Object.freeze({ folded, open });
    return snap;
  };
  return {
    snapshot,
    get folded() { return has('np-fold'); },
    get open() { return has('player-open'); },
    set({ folded, open } = {}) {
      const before = snapshot();
      if (folded !== undefined) doc.body.classList.toggle('np-fold', !!folded);
      if (open !== undefined) doc.body.classList.toggle('player-open', !!open);
      const after = snapshot();
      if (after !== before) for (const fn of [...fns]) fn(after);
    },
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
}
