// web/static/lib/ui/layers.js
// The one stack of open things (docs/plan/the-studio-space.md, "One way to
// close things"): menus, popovers, sheets, drawers, a selection and the
// phone's player. Back and Escape close the top one first, and only once
// nothing is open does Back leave the room. A press outside closes a menu.
// A switch of rooms closes everything but the phone's player first (leave,
// the router's beforeSwitch), and a view's hide closes what it opened.
//
// How a close request arrives depends on the browser:
//
//   - Where there is CloseWatcher (Chromium, so the Android tablet), each
//     layer has one, made inside the press that opened it. Escape, and
//     Android's Back, are one close request, which the browser hands to the
//     newest watcher: the top layer.
//   - Elsewhere (Safari, so the iPad) an Escape keydown closes the top
//     layer, and the stack holds ONE history entry while anything is open,
//     so the edge swipe's Back closes the top layer too (historyStep).
//
// Never both for one layer: with a watcher and an entry, one Back would
// close the layer and the next would land on its leftover entry and do
// nothing.
//
// A layer closes in the order things opened, newest first, which is how
// they nest: a menu over a sheet over a selection over the player.
//
// One stack per document: layersOf(doc) is it (the shell's boot.js hands it
// to the views as ctx.layers, a scope of it; Open, the guide and the rig use
// it directly). createLayers is the factory, with the window's parts handed
// in so the tests stand in for them.

import { report } from '../objects/motion.js';

export const KINDS = Object.freeze(['menu', 'popover', 'sheet', 'drawer', 'selection', 'player']);
export const REASONS = Object.freeze(['escape', 'back', 'outside', 'pick', 'navigate', 'program']);

/** KEY is the history state's key for the fallback's one entry. */
export const KEY = 'layer';

// How long a switch waits for the stack's own Back to come back before it
// goes ahead anyway: a popstate that never arrives must not hold a room.
const UNWIND_WAIT_MS = 500;

/**
 * historyStep is what the fallback's one history entry does next: a pure
 * reducer (the Listening Room's cassette sheet had one, sheetState; this is
 * it for any number of layers). State:
 *
 *   held       how many open layers the entry is for
 *   on         the entry is the one the history is on now
 *   unwinding  Backs the stack asked for whose popstate has not come yet
 *
 * Events, and what the answer's `history` and `close` ask for:
 *
 *   { type: 'open' }               a layer opened. The first pushes the entry
 *                                  ('push'), unless a Back of ours is still on
 *                                  its way: its popstate pushes it again.
 *   { type: 'close', current }     a layer closed, not by Back. The last one
 *                                  takes the entry away ('back'), when the
 *                                  history is still on it (`current`); one
 *                                  buried under another entry (the router's,
 *                                  a switch's) is left, and stripped if it is
 *                                  ever landed on.
 *   { type: 'popstate', ours, marked }
 *                                  the history moved. `ours`: it landed on the
 *                                  live entry; `marked`: on an entry of ours,
 *                                  live or not. Our own Back coming back is
 *                                  swallowed. Leaving the entry is Back: close
 *                                  the top layer (close: 'top'), then 'settle'.
 *                                  Landing on a dead entry strips it ('strip').
 *   { type: 'settle' }             after that close: the layers still open
 *                                  get an entry again ('push').
 */
export function historyStep(prev, ev) {
  const s = { held: prev?.held || 0, on: !!prev?.on, unwinding: prev?.unwinding || 0, history: null, close: null };
  const refill = () => {
    if (s.held && !s.on && !s.unwinding) { s.on = true; s.history = 'push'; }
    return s;
  };
  switch (ev?.type) {
    case 'open':
      s.held++;
      return refill();
    case 'close':
      s.held = Math.max(0, s.held - 1);
      if (!s.held && s.on) {
        s.on = false;
        if (ev.current) { s.unwinding++; s.history = 'back'; }
      }
      return s;
    case 'popstate':
      if (s.unwinding) {
        s.unwinding--;
        s.on = !!ev.ours;
        return refill();
      }
      if (s.on && !ev.ours) {
        s.on = false;
        if (s.held) s.close = 'top';
        return s;
      }
      if (ev.ours) { s.on = true; return s; }
      if (ev.marked) s.history = 'strip';
      return s;
    case 'settle':
      return refill();
    default:
      return s;
  }
}

/**
 * createLayers is a stack of open things for one document.
 *
 *   doc           the document (activeElement, body)
 *   win           where the window's events are heard: keydown, pointerdown,
 *                 popstate (default: doc.defaultView, or doc itself)
 *   CloseWatcher  the browser's, where it has one
 *   history       the fallback's: state, pushState, replaceState, back.
 *                 Only used without CloseWatcher; none means no entries.
 *   onError       where an owner's onClose that throws is reported
 *
 * Answers { open(spec) -> Layer, top(), closeAll({kinds, reason}),
 * ownsKeys(e), scope(), leave({keep}), settled(), size }.
 *
 * open(spec):
 *   el           what is open (a menu's panel, a sheet's dialog)
 *   kind         one of KINDS
 *   modal        it covers the page: the page's keys are not the page's
 *   owner        the button that opened it: a press on it is not outside,
 *                and Escape or Back gives it the focus back
 *   returnFocus  where focus goes on Escape or Back (default: owner)
 *   outside      a press outside el and owner closes it (default: a menu's
 *                or a popover's)
 *   onClose(reason)
 *                the owner puts it away: called once, however it closed,
 *                after it has left the stack. reason is one of REASONS:
 *                'escape' and 'back' (a close request), 'outside' (a press
 *                elsewhere), 'pick' (an item chosen), 'navigate' (the room
 *                or the page is changing: a link picked, a switch; the
 *                history is left to it) and 'program' (the owner's own).
 *   Opening the el of a layer that is open answers that layer.
 *
 * A Layer is { kind, el, close(reason = 'program'), get open() }. The owner
 * closes it by layer.close(); its onClose does the putting away, so there is
 * one way out, whoever asked.
 */
export function createLayers({
  doc = globalThis.document,
  win = doc?.defaultView || doc,
  CloseWatcher = win?.CloseWatcher,
  history = win?.history,
  onError = report,
} = {}) {
  const stack = []; // open records, oldest first
  const watching = typeof CloseWatcher === 'function';
  const hist = !watching && history && typeof history.pushState === 'function' ? history : null;
  let h = { held: 0, on: false, unwinding: 0 };
  let token = null; // the live entry's
  const page = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  let waiters = [];
  let escaping = false; // an Escape keydown is being handled: its close request is Escape's

  const stateOf = () => { const s = hist?.state; return s && typeof s === 'object' ? s : {}; };
  const without = () => { const { [KEY]: _gone, ...rest } = stateOf(); return rest; };
  const isCurrent = () => token != null && stateOf()[KEY] === token;

  // A reload on the entry leaves nothing open: the entry is a dead one.
  if (hist && stateOf()[KEY] != null) {
    try { hist.replaceState(without(), ''); } catch (e) { onError(e); }
  }

  function apply(next) {
    h = next;
    try {
      if (next.history === 'push') {
        token = `${page}.${++seq}`;
        hist.pushState({ ...stateOf(), [KEY]: token }, '');
      } else if (next.history === 'back') {
        hist.back();
      } else if (next.history === 'strip') {
        hist.replaceState(without(), '');
      }
    } catch (e) { onError(e); }
    if (!h.unwinding && waiters.length) { const w = waiters; waiters = []; for (const r of w) r(); }
  }

  const handleOf = (rec) => rec.handle;

  function focusBack(rec) {
    const to = rec.spec.returnFocus === undefined ? rec.spec.owner : rec.spec.returnFocus;
    if (!to || typeof to.focus !== 'function') return;
    const a = doc?.activeElement;
    const lost = !a || a === doc.body || a === doc.documentElement || a.isConnected === false
      || !!rec.spec.el?.contains?.(a) || !!rec.spec.owner?.contains?.(a);
    if (lost) to.focus({ preventScroll: true });
  }

  function shut(rec, reason = 'program') {
    if (!rec.open) return;
    rec.open = false;
    const i = stack.indexOf(rec);
    if (i >= 0) stack.splice(i, 1);
    rec.scope?.delete(rec);
    const w = rec.watcher;
    rec.watcher = null;
    if (w) { try { w.destroy(); } catch (e) { onError(e); } }
    // Back has taken the entry already; a navigation is about to move the
    // history itself (a Back of ours now would race it, and a link's load
    // would be dropped for it). Anything else takes the entry back.
    if (hist) apply(historyStep(h, { type: 'close', current: reason !== 'back' && reason !== 'navigate' && isCurrent() }));
    try { rec.spec.onClose?.(reason); } catch (e) { onError(e); }
    if (reason === 'escape' || reason === 'back') focusBack(rec);
  }

  function arm(rec) {
    try {
      const w = new CloseWatcher();
      w.onclose = () => {
        if (rec.watcher !== w) return;
        rec.watcher = null;
        shut(rec, escaping ? 'escape' : 'back');
      };
      rec.watcher = w;
    } catch (e) { onError(e); }
  }

  function open(spec = {}) {
    if (!KINDS.includes(spec.kind)) throw new TypeError(`a layer's kind is one of ${KINDS.join(', ')}, not ${spec.kind}`);
    const had = spec.el ? stack.find((r) => r.spec.el === spec.el) : null;
    if (had) return had.handle;
    const rec = { spec, open: true, watcher: null, scope: null };
    rec.handle = Object.freeze({
      kind: spec.kind,
      el: spec.el || null,
      close: (reason = 'program') => shut(rec, reason),
      get open() { return rec.open; },
    });
    stack.push(rec);
    if (watching) arm(rec);
    else if (hist) apply(historyStep(h, { type: 'open' }));
    return rec.handle;
  }

  const top = () => (stack.length ? handleOf(stack[stack.length - 1]) : null);

  function closeAll({ kinds = null, reason = 'program', only = null } = {}) {
    for (const rec of [...stack].reverse()) {
      if (only && !only.has(rec)) continue;
      if (kinds && !kinds.includes(rec.spec.kind)) continue;
      shut(rec, reason);
    }
  }

  // ownsKeys: a key pressed now is a layer's, not the page's: a menu or a
  // modal layer is open, or the key was pressed inside one.
  function ownsKeys(e) {
    const t = e?.target;
    return stack.some((r) => r.spec.modal || r.spec.kind === 'menu' || r.spec.kind === 'popover'
      || (!!t && !!r.spec.el?.contains?.(t)));
  }

  /**
   * leave is a switch of rooms about to write the history (the router's
   * chrome.beforeSwitch): every layer but the kinds in `keep` closes
   * ('navigate': a room's own sheets and selection close with it anyway),
   * and it answers what the switch does first --
   *   a promise   the stack's own Back is still on its way: wait for it;
   *   'replace'   the history is on the stack's entry and nothing holds it
   *               any more: write the room's entry over it, so no dead
   *               entry is left for Back to land on;
   *   null        push as usual.
   */
  function leave({ keep = [] } = {}) {
    closeAll({ kinds: KINDS.filter((k) => !keep.includes(k)), reason: 'navigate' });
    if (h.unwinding) return settled();
    if (hist && !h.held && isCurrent()) return 'replace';
    return null;
  }

  /** settled is null, or a promise of the stack's own Back having come back. */
  function settled() {
    if (!h.unwinding) return null;
    return new Promise((resolve) => {
      waiters.push(resolve);
      setTimeout(resolve, UNWIND_WAIT_MS);
    });
  }

  function scope() {
    const mine = new Set();
    return Object.freeze({
      open(spec) {
        const l = open(spec);
        const rec = stack.find((r) => r.handle === l);
        if (rec && !rec.scope) { rec.scope = mine; mine.add(rec); }
        return l;
      },
      top,
      ownsKeys,
      settled,
      /** closeAll closes what this scope opened (the kinds asked, or all). */
      closeAll: ({ kinds = null, reason = 'program' } = {}) => closeAll({ kinds, reason, only: mine }),
      get size() { return mine.size; },
    });
  }

  // A press outside a menu or popover closes it (on the window, first:
  // the page's other menus stop their buttons' clicks).
  win?.addEventListener?.('pointerdown', (e) => {
    const t = e.target;
    for (const rec of [...stack].reverse()) {
      const { el, owner, kind } = rec.spec;
      const outside = rec.spec.outside ?? (kind === 'menu' || kind === 'popover');
      if (!outside) continue;
      if (t && (el?.contains?.(t) || owner?.contains?.(t))) continue;
      shut(rec, 'outside');
    }
  }, true);

  if (watching) {
    // The close request an Escape sends comes while its keydown is handled:
    // so a close then is Escape's, and any other is Back's.
    win?.addEventListener?.('keydown', (e) => {
      if (e.key !== 'Escape') return;
      escaping = true;
      setTimeout(() => { escaping = false; }, 0);
    }, true);
  } else {
    // Escape closes the top layer, unless something under it took the key
    // for itself (preventDefault: a field's own Escape, a drag let go).
    win?.addEventListener?.('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !stack.length) return;
      e.preventDefault?.();
      shut(stack[stack.length - 1], 'escape');
    });
  }

  if (hist) {
    win?.addEventListener?.('popstate', (e) => {
      const landed = (e?.state && typeof e.state === 'object' ? e.state : stateOf())[KEY];
      const ours = landed != null && landed === token && h.held > 0;
      const next = historyStep(h, { type: 'popstate', ours, marked: landed != null });
      h = next;
      if (next.close === 'top' && stack.length) {
        shut(stack[stack.length - 1], 'back');
        apply(historyStep(h, { type: 'settle' }));
      } else {
        apply(next);
      }
    });
  }

  return {
    open,
    top,
    closeAll: ({ kinds = null, reason = 'program' } = {}) => closeAll({ kinds, reason }),
    ownsKeys,
    scope,
    leave,
    settled,
    get size() { return stack.length; },
  };
}

const byDoc = new WeakMap();

/** layersOf is the document's one stack, made on first asking. */
export function layersOf(doc = globalThis.document) {
  if (!doc) return createLayers({ doc });
  let l = byDoc.get(doc);
  if (!l) { l = createLayers({ doc }); byDoc.set(doc, l); }
  return l;
}
