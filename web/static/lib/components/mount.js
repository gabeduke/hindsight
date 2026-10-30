// web/static/lib/components/mount.js
// The component contract (docs/architecture/components.md; the spec,
// docs/plan/components.md, 1): what a component is to the surface that
// arranges it, and what it is handed. A component draws inside the root it
// is given, from its models' snapshots, and does at window or document
// level only what goes through cx, which keeps "hidden" in one place, as a
// shell view's ctx does for a room (lib/shell/view.js).
//
// A component is a module's default export:
//
//   {
//     id: 'display',            // its name, and its check's
//                               //   (scripts/components/<id>.check.mjs)
//     root: 'lcd-keys',         // the class mountComponent puts on its root,
//                               //   where every selector in its css starts
//     needs: ['transport'],     // its models, by noun
//     css: 'css/display.css',   // its one stylesheet
//     mount(root, models, cx)   // once per root -> { show, hide, unmount },
//                               //   each optional
//   }
//
// mount fills the root from the component's template, binds its keys,
// watches its models and draws from their snapshots. It never waits on the
// network: a model with no answer yet says so in its snapshot.
//
// Pure apart from the root and the ctx it is handed, so the tests stand in
// for both (mount.test.js).

import { barTop } from '../ui/menu.js';
import { report } from '../objects/motion.js';

const KEYS = ['id', 'root', 'needs', 'css', 'mount'];

/** lacks names what a component's export is missing, or has wrong: [] for a component. */
export function lacks(def) {
  if (!def || typeof def !== 'object') return KEYS;
  return KEYS.filter((k) => {
    if (k === 'needs') return !Array.isArray(def.needs) || def.needs.some((n) => typeof n !== 'string');
    if (k === 'mount') return typeof def.mount !== 'function';
    return typeof def[k] !== 'string' || !def[k];
  });
}

// The roots a component is mounted on now: a second mount on one is a
// listener bound twice (view.js's header: Space pressing ▶ twice).
const mounted = new WeakSet();

/**
 * mountComponent mounts `def` on `root` with the page's `models` (every noun
 * in def.needs), inside a shell view's `ctx` (its on, loop, layers, toast,
 * go), with `props` from the surface: the callbacks and the values it hands
 * this one (a key's menu to open, the take it shows). It mounts shown; a
 * surface hidden at the time hides it at once, as a view mounted out of
 * sight does (decision 0048). Answers { show(), hide(), unmount(), shown }.
 *
 * The component is handed cx:
 *   watch(model, fn)  fn(model.snapshot()) now and on each change; never
 *                     while hidden, and on show if the snapshot moved
 *                     meanwhile; off on unmount. Answers its off.
 *   on(target, type, fn, opts)
 *                     ctx.on: a listener on the window or the document (a
 *                     key), quiet while hidden, off on unmount
 *   loop(fn)          ctx.loop: a step on the shared ticker, parked while
 *                     hidden. Answers { start(), stop(), running }
 *   layers            its share of the view's stack: what it opens there
 *                     closes when it is hidden or unmounted
 *   floor             where its menus stop above the bar (menu()'s floor)
 *   toast, go         ctx's: words for a person; a move to another room
 *   id(name)          the id of a part of it: its root's id and the name
 *                     (root np and 'play' make np-play)
 *   props             the surface's, frozen
 */
export function mountComponent(def, root, models = {}, ctx = {}, props = {}) {
  const missing = lacks(def);
  if (missing.length) throw new TypeError(`a component exports { ${KEYS.join(', ')} }: ${def?.id ?? 'this one'} has no good ${missing.join(', ')}`);
  if (!root || typeof root.replaceChildren !== 'function') throw new TypeError(`the ${def.id} component needs a root element`);
  if (mounted.has(root)) throw new Error(`the ${def.id} component's root has a component mounted on it already: unmount that first`);
  const unmet = def.needs.filter((n) => !models[n] || typeof models[n].snapshot !== 'function' || typeof models[n].onChange !== 'function');
  if (unmet.length) throw new TypeError(`the ${def.id} component needs the ${unmet.join(', ')} model${unmet.length > 1 ? 's' : ''} (snapshot and onChange)`);

  let shown = true;
  let gone = false;
  const watchers = new Set();
  const offs = new Set();
  const loops = new Set();
  const opened = new Set();

  const deliver = (w) => {
    const s = w.model.snapshot();
    if (s === w.last) return;
    w.last = s;
    try { w.fn(s); } catch (e) { report(e); }
  };

  function watch(model, fn) {
    if (!model || typeof model.snapshot !== 'function' || typeof model.onChange !== 'function') {
      throw new TypeError('cx.watch needs a model with snapshot() and onChange()');
    }
    const w = { model, fn, last: undefined, off: null };
    w.off = model.onChange(() => { if (shown && !gone) deliver(w); });
    watchers.add(w);
    if (shown) deliver(w);
    const off = () => { w.off?.(); watchers.delete(w); offs.delete(off); };
    offs.add(off);
    return off;
  }

  function on(target, type, fn, opts) {
    if (typeof ctx.on !== 'function') throw new TypeError('cx.on needs a view’s ctx.on');
    const gated = function gated(e) { return shown ? fn.call(this, e) : undefined; };
    const viewOff = ctx.on(target, type, gated, opts);
    const off = () => { viewOff(); offs.delete(off); };
    offs.add(off);
    return off;
  }

  function loop(fn) {
    if (typeof ctx.loop !== 'function') throw new TypeError('cx.loop needs a view’s ctx.loop');
    // A step that parks itself (returns false) stays parked through a show.
    const e = { wanted: false, l: null };
    e.l = ctx.loop((dt, now) => {
      const more = fn(dt, now) !== false;
      if (!more) e.wanted = false;
      return more;
    });
    loops.add(e);
    return {
      start() { e.wanted = true; if (shown && !gone) e.l.start(); },
      stop() { e.wanted = false; e.l.stop(); },
      get running() { return e.l.running; },
    };
  }

  // Its share of the view's stack: opened through the view's scope, and
  // closed by handle, so the view's other layers stay as they are.
  const scope = ctx.layers || null;
  const layers = scope && Object.freeze({
    open(spec) {
      const h = scope.open(spec);
      opened.add(h);
      return h;
    },
    top: () => scope.top?.() ?? null,
    ownsKeys: (e) => !!scope.ownsKeys?.(e),
    settled: () => scope.settled?.(),
    closeAll({ reason = 'program' } = {}) {
      for (const h of [...opened]) { if (h.open) h.close(reason); opened.delete(h); }
    },
    get size() { for (const h of [...opened]) if (!h.open) opened.delete(h); return opened.size; },
  });

  const cx = Object.freeze({
    watch,
    on,
    loop,
    layers,
    floor: ctx.floor ?? barTop(root.ownerDocument),
    toast: ctx.toast,
    go: ctx.go,
    id(name) {
      if (!root.id) throw new Error(`the ${def.id} component's root has no id to name its parts by`);
      return `${root.id}-${name}`;
    },
    props: Object.freeze({ ...props }),
  });

  mounted.add(root);
  root.classList.add(def.root);
  let handle;
  try {
    handle = def.mount(root, models, cx) || {};
  } catch (e) {
    teardown();
    throw e;
  }

  function quiet() {
    shown = false;
    layers?.closeAll({ reason: 'navigate' });
    for (const e of loops) e.l.stop();
  }

  function teardown() {
    gone = true;
    quiet();
    for (const off of [...offs]) off();
    for (const e of loops) { e.wanted = false; e.l.stop(); }
    loops.clear();
    root.replaceChildren();
    root.classList.remove(def.root);
    mounted.delete(root);
  }

  return {
    get shown() { return shown && !gone; },
    show() {
      if (gone || shown) return;
      shown = true;
      for (const w of [...watchers]) deliver(w);
      try { handle.show?.(); } catch (e) { report(e); }
      for (const e of loops) if (e.wanted) e.l.start();
    },
    hide() {
      if (gone || !shown) return;
      try { handle.hide?.(); } catch (e) { report(e); }
      quiet();
    },
    unmount() {
      if (gone) return;
      if (shown) { try { handle.hide?.(); } catch (e) { report(e); } }
      try { handle.unmount?.(); } catch (e) { report(e); }
      teardown();
    },
  };
}
