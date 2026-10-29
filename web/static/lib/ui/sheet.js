// web/static/lib/ui/sheet.js
// A sheet you drag (docs/architecture/shell.md, "Sheets"): it comes up from
// the foot of the screen, follows the finger on its handles, and when let
// go settles on a spring at the detent nearest where the flick would have
// carried it, or goes away. A swipe down, Back and Escape put it away, by
// the page's stack of open things (lib/ui/layers.js): its layer is the one
// way out, whoever asks. With less motion its travel is a fade.
//
// Its first user is the phone's player (lib/bar/player.js); the notes
// drawer is meant to be its second. What it moves is one element, by a
// transform, on the shared ticker (lib/objects/motion.js), so a frame costs
// a style write and nothing else. The owner lays the sheet out (onShow) and
// puts it away (onHide): this only moves it.
//
// Positions are px down from where the sheet stands laid out: 0 is all the
// way up, a detent is a stop on the way down, `closed` is where it comes
// from and goes back to (by default its own height: off the screen).

import { T, EASES, SPRINGS, spring, settled, project, ticker as sharedTicker, Loop } from '../objects/motion.js';
import { GESTURE } from './press.js';

/** How much of a drag above the top detent the sheet still follows: it gives, and comes back. */
export const GIVE = 0.3;

/** A finger held this long (ms) before it lets go has stopped: no flick. */
export const STILL_MS = 100;

/** What a drag never starts on: what has a drag of its own, or takes text. */
export const IGNORE = 'input, select, textarea, canvas, [data-sheet-ignore]';

/**
 * settleAt is where a sheet let go at `y`, moving at `velocity` (px/s, down
 * is positive), comes to rest: the detent, or `closed`, nearest where it
 * would have coasted to (project), not nearest the finger. Answers { y,
 * closing, detent } -- `detent` the index into `detents`, or -1 for closed.
 * With `closable` false it never closes (a sheet that is the page).
 */
export function settleAt({ y, velocity = 0, detents = [0], closed, closable = true }) {
  const aim = y + project(velocity);
  let best = -1;
  let gap = closable ? Math.abs(aim - closed) : Infinity;
  detents.forEach((d, i) => {
    const g = Math.abs(aim - d);
    if (g < gap) { gap = g; best = i; }
  });
  return best < 0 ? { y: closed, closing: true, detent: -1 } : { y: detents[best], closing: false, detent: best };
}

/** give is where a finger `y` px down puts a sheet whose top stop is `top`: past it, the sheet gives a little. */
export function give(y, top = 0) {
  return y >= top ? y : top + (y - top) * GIVE;
}

/**
 * createSheet makes `el` a sheet. Options:
 *   layers     the page's stack (layersOf(document), or a view's ctx.layers)
 *   kind       its kind on the stack: 'sheet', 'drawer' or 'player'
 *   modal      what is under it waits for it (the player)
 *   owner      the key that opened it, where the focus goes back to
 *   detents    () => [px…], its stops, read each time it settles (a
 *              sheet's height changes); [0] by default: all the way up
 *   closed     () => px, where it comes from and goes to; its height by default
 *   closable   false: a drag never puts it away (Back and Escape still do)
 *   handles    what a drag starts on ([el] by default); a drag never starts
 *              on IGNORE, and only goes up and down
 *   when       () => bool: whether a drag may start now (the player's
 *              handles are the bar's, which is no sheet wider than a phone)
 *   onShow     () => void, before it first moves in: lay it out
 *   onHide     (reason) => void, once it is all the way out: put it away
 *   onDetent   (index) => void, when it comes to rest on one
 *   clock, reduced, slop   the ticker, a () => bool for less motion, and
 *              how far a finger goes before it is a drag; for the tests
 *
 * Answers { open({detent}), close(reason), snap(detent), isOpen, detent, y,
 * destroy() }. A drag that starts on a handle while it is put away (the
 * phone's mini player) and goes up opens it under the finger.
 */
export function createSheet(el, {
  layers, kind = 'sheet', modal = false, owner = null,
  detents = () => [0],
  closed = () => el.getBoundingClientRect().height || 0,
  closable = true,
  handles = [el],
  when = () => true,
  onShow = () => {}, onHide = () => {}, onDetent = () => {},
  clock = sharedTicker,
  reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  slop = GESTURE.SLOP_PX,
} = {}) {
  if (!layers) throw new TypeError('createSheet: a sheet goes on the page’s stack (layers)');
  let layer = null;   // on the stack while it is open
  let shown = false;  // laid out (onShow ran, onHide hasn't)
  let y = null;       // where it is, px down; null while put away
  let v = 0;          // px/s
  let target = 0;
  let closing = null; // the reason it is going, while it goes
  let at = -1;        // the detent it rests on
  let drag = null;    // { id, x0, y0, from, t, moved, opening }
  let swallow = false; // the click a drag's lift sends is not a tap
  let fade = null;

  const stops = () => { const d = detents(); return d.length ? d : [0]; };

  function paint() {
    el.style.transform = y ? `translate3d(0, ${Math.round(y * 10) / 10}px, 0)` : '';
  }

  const loop = new Loop((dt) => {
    ({ value: y, velocity: v } = spring(y, v, target, dt, SPRINGS.lid));
    if (settled(y, v, target, 0.5)) {
      y = target;
      v = 0;
      paint();
      arrive();
      return false;
    }
    paint();
    return true;
  }, clock);

  function arrive() {
    if (closing !== null) { hide(); return; }
    onDetent(at);
  }

  function hide() {
    const why = closing;
    closing = null;
    loop.stop();
    fade?.cancel?.();
    fade = null;
    y = null;
    v = 0;
    at = -1;
    el.style.transform = '';
    el.style.opacity = '';
    if (shown) { shown = false; onHide(why); }
  }

  // Less motion: no travel. It is where it goes at once, and fades in or out.
  function fadeTo(on, done) {
    fade?.cancel?.();
    const a = el.animate?.([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], { duration: on ? T.touch : T.exit, easing: `cubic-bezier(${(on ? EASES.out : EASES.in).join(', ')})`, fill: 'forwards' });
    fade = a || null;
    if (!a) { done(); return; }
    a.onfinish = () => { if (fade === a) { fade = null; done(); } };
  }

  // go moves it to `to` (a detent's index, or -1 for away) from where it is,
  // carrying `velocity`.
  function go(to, velocity = 0) {
    const s = stops();
    at = to;
    target = to < 0 ? closed() : s[Math.min(to, s.length - 1)];
    v = velocity;
    if (reduced()) {
      loop.stop();
      if (to < 0) { fadeTo(false, hide); return; }
      y = target;
      paint();
      onDetent(at);
      return;
    }
    if (y === null) y = target;
    loop.start();
  }

  function show(from) {
    closing = null;
    // Opened again while it fades out: the fade stops, or it would hide it.
    fade?.cancel?.();
    fade = null;
    el.style.opacity = '';
    if (!shown) {
      shown = true;
      onShow();
      if (reduced()) fadeTo(true, () => { el.style.opacity = ''; });
    }
    if (y === null) { y = from; paint(); }
  }

  function push() {
    if (layer?.open) return;
    layer = layers.open({
      el, kind, modal, owner,
      // The one way out: a swipe down, Back, Escape, a tap on its grabber,
      // or the owner's own close all come here.
      onClose: (reason) => {
        layer = null;
        drag = null;
        closing = reason || 'program';
        go(-1, Math.max(0, v));
      },
    });
  }

  function open({ detent = 0 } = {}) {
    const from = y ?? closed();
    push();
    show(from);
    go(detent, v);
  }

  function close(reason = 'program') {
    if (layer?.open) layer.close(reason);
    else if (shown && closing === null) { closing = reason; go(-1, Math.max(0, v)); }
  }

  // --- the finger ---------------------------------------------------------
  const isIgnored = (t) => !!t?.closest?.(IGNORE);
  function onDown(e) {
    swallow = false;
    if (drag || e.button > 0 || isIgnored(e.target) || !when()) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, from: y, t: e.timeStamp || 0, last: e.clientY, moved: false, opening: y === null, handle: e.currentTarget };
  }
  function onMove(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      // Up and down only: a sideways move is someone else's.
      if (Math.hypot(e.clientX - d.x0, dy) <= slop) return;
      if (Math.abs(e.clientX - d.x0) > Math.abs(dy)) { drag = null; return; }
      // Put away, only a drag up opens it.
      if (d.opening && dy > 0) { drag = null; return; }
      d.moved = true;
      d.handle?.setPointerCapture?.(e.pointerId);
      if (d.opening) {
        d.from = closed();
        push();
        show(d.from);
      } else if (closing !== null) {
        // Caught on its way out: it's open again.
        push();
        closing = null;
      }
      loop.stop();
      fade?.cancel?.();
      fade = null;
      el.style.opacity = '';
      // It follows from the edge of the slop, so it neither jumps by the
      // slop nor loses a move that went far in one event.
      d.y0 += Math.sign(dy) * slop;
      d.last = d.y0;
      d.t = e.timeStamp || 0;
      v = 0;
    }
    e.preventDefault?.();
    const now = e.timeStamp || 0;
    const dt = now - d.t;
    if (dt > 0) v = 0.8 * (((e.clientY - d.last) * 1000) / dt) + 0.2 * v;
    d.t = now;
    d.last = e.clientY;
    y = give(d.from + e.clientY - d.y0, stops()[0]);
    paint();
  }
  function onUp(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (!d.moved) return; // a tap: the click does it
    swallow = true;
    // Held still before the lift: no flick.
    if ((e.timeStamp || 0) - d.t > STILL_MS) v = 0;
    const to = settleAt({ y, velocity: v, detents: stops(), closed: closed(), closable });
    if (to.closing) close('program');
    else go(to.detent, v);
  }
  function onCancel(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (!d.moved) return;
    v = 0;
    // An opening drag cancelled goes back down; any other settles where it was.
    if (d.opening) { close(); return; }
    go(Math.max(0, at), 0);
  }
  function onClick(e) {
    if (!swallow) return;
    swallow = false;
    // A keyboard's click (no pointer) is never a drag's lift.
    if (e.detail === 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  const wired = [];
  const on = (t, type, fn, opts) => { t.addEventListener(type, fn, opts); wired.push([t, type, fn, opts]); };
  for (const h of handles.filter(Boolean)) {
    on(h, 'pointerdown', onDown);
    on(h, 'pointermove', onMove);
    on(h, 'pointerup', onUp);
    on(h, 'pointercancel', onCancel);
    on(h, 'click', onClick, true);
  }

  return {
    open,
    close,
    /** snap moves an open sheet to another of its detents. */
    snap(detent) { if (shown && closing === null) go(detent, 0); },
    get isOpen() { return shown && closing === null; },
    get detent() { return at; },
    get y() { return y; },
    destroy() {
      for (const [t, type, fn, opts] of wired) t.removeEventListener(type, fn, opts);
      wired.length = 0;
      loop.stop();
      if (layer?.open) layer.close('program');
      hide();
    },
  };
}
