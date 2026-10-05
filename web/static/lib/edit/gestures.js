// web/static/lib/edit/gestures.js
// The pointer machinery shared by every editing surface: the take page's
// waveform now, the tape page's lanes later. A surface subclasses
// GestureSurface, says what is under a point (hit), and handles the drags of
// the things it lets you grab. Everything else is here:
//
//   - one finger dragged pans, always, wherever it starts on the surface;
//   - press and hold, then drag, selects (where the surface allows it), with
//     the view scrolling under a finger held near an edge;
//   - a tap, and a double-tap;
//   - two fingers pinch, and a wheel zooms (shift or a sideways swipe pans);
//   - a cancelled pointer, a second finger or a lost capture rolls back
//     whatever the first finger had started, and commits nothing.
//
// It owns no state about what is being edited: it calls the surface's hooks
// and the surface emits to its page.

import { xToFrame, clampRegion, edgeScrollStep } from '../wave/geometry.js';

export const HOLD_MS = 350; // exported so the tests can tick exactly this far
export const TAP_MS = 300;
export const TAP_MOVE = 8;
export const DOUBLE_TAP_MOVE = 20;
export const MIN_FPP = 1 / 8; // 8 px per frame: far enough
const MIN_PINCH = 8;          // below this the ratio of finger distances goes wild
// A held select only survives release if it spans this many pixels: a hold
// that barely moved puts the old selection back instead of leaving a sliver.
export const MIN_REGION_PX = 24;

// True separation of two fingers, floored so a near-vertical pinch cannot
// divide by ~0 and fling the zoom.
function pinchDist(a, b) { return Math.max(MIN_PINCH, Math.hypot(a.x - b.x, a.y - b.y)); }

/**
 * GestureSurface is the base of an editing canvas. A subclass provides:
 *
 *   this.canvas, this.view {start, fpp, width}, this.total, this.minLen
 *   hit(x, y)      -> { kind, grab?, select?, ... }: grab marks something
 *                     draggable (a pin, a grip); select marks a surface where
 *                     a hold selects; anything else pans and taps
 *   grabStart(h, p) -> extra gesture state for a grab, or null to refuse it
 *   grabMove(g, p)  -> follow the finger (g.dx is the travel so far)
 *   grabEnd(g, p, tap) -> commit, or handle a tap on the thing
 *   grabRollback(g) -> undo a grab that will never be released
 *   snapX(x)        -> the frame a selection edge at x lands on
 *   tapAt(p, h, double) -> a tap on the surface (double: the second of two)
 *   emit(event, payload), panTo(start), clampView(), changed(), draw(), maxFpp()
 *
 * Selections are emitted as 'regionChange' {region, final}; the surface's
 * page treats final:false as provisional.
 */
export class GestureSurface {
  initGestures(canvas) {
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.edgeRaf = 0;
    canvas.style.touchAction = 'none';
    // One AbortController so destroy() actually detaches the listeners.
    this.gestureAC = new AbortController();
    const sig = { signal: this.gestureAC.signal };
    canvas.addEventListener('pointerdown', (e) => this.down(e), sig);
    canvas.addEventListener('pointermove', (e) => this.move(e), sig);
    canvas.addEventListener('pointerup', (e) => this.up(e), sig);
    canvas.addEventListener('pointercancel', (e) => this.cancel(e), sig);
    canvas.addEventListener('lostpointercapture', (e) => this.lostCapture(e), sig);
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false, signal: this.gestureAC.signal });
  }

  destroyGestures() {
    // A pending hold, or a live edge scroll, would otherwise fire into a
    // torn-down surface.
    this.clearHold(this.gesture);
    this.stopEdgeLoop();
    this.gestureAC?.abort();
  }

  pt(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    // Two or more fingers is always a pinch: replacing the gesture discards
    // whatever the first finger had started, so a pinch never also selects
    // or drags. Roll that back first -- it may have emitted provisional
    // changes that nothing else will ever finalize.
    if (this.pointers.size >= 2) {
      this.rollback(this.gesture);
      const [a, b] = [...this.pointers.values()];
      this.gesture = { kind: 'pinch', dist: pinchDist(a, b), mid: (a.x + b.x) / 2, fpp: this.view.fpp, start: this.view.start };
      this.lastTap = null;
      return;
    }
    const h = this.hit(p.x, p.y);
    // Every one-finger gesture carries the pointer that owns it, so a palm or
    // a stray second pointer can neither finalize nor cancel it.
    const base = { x0: p.x, y0: p.y, t0: performance.now(), moved: false, id: e.pointerId, hit: h, dx: 0 };
    if (h.grab) {
      const extra = this.grabStart(h, p);
      if (extra) {
        this.gesture = { ...base, kind: 'grab', ...extra };
        // A grab is never half of a double-tap.
        this.lastTap = null;
        return;
      }
    }
    // A press on the surface is undecided: it pans if it moves first, and
    // selects if it holds still for HOLD_MS where the surface allows it.
    const g = { ...base, kind: 'press', select: !!h.select, anchor: this.snapX(p.x), prev: this.selection(), selecting: false, start: this.view.start, holdTimer: null, lastX: p.x };
    if (g.select) g.holdTimer = setTimeout(() => this.beginSelect(g), HOLD_MS);
    this.gesture = g;
  }

  /** The current selection, for a select to restore when it is abandoned. */
  selection() { const s = this.getState?.().region; return s ? { ...s } : null; }

  // The hold fired: the press becomes a selection. Guarded because the timer
  // outlives the gesture -- a second finger, a cancel or a release may have
  // replaced it, and a press that already moved has chosen panning instead.
  // The provisional band under the finger is the cue that the hold took.
  beginSelect(g) {
    if (this.gesture !== g || g.moved) return;
    g.holdTimer = null;
    g.selecting = true;
    // A hold that changes meaning deserves a tick of feedback where the
    // device has one; iOS Safari has no vibrate, and that must not matter.
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    this.emit('regionChange', { region: clampRegion({ start: g.anchor, end: g.anchor + this.minLen }, this.total, this.minLen), final: false });
    this.draw();
  }

  clearHold(g) { if (g && g.holdTimer) { clearTimeout(g.holdTimer); g.holdTimer = null; } }

  // A selection can only reach as far as the screen unless the screen moves.
  // While the finger sits in an edge margin, pan a little every frame and
  // re-derive the selection from the anchor to whatever frame is now under
  // the (still) finger. At the ends of the take the clamp pins the view, and
  // the loop does no work until the finger moves.
  updateEdgeLoop(g) {
    const step = edgeScrollStep(g.lastX, this.view.width);
    if (!step) { this.stopEdgeLoop(); return; }
    if (this.edgeRaf) return; // already running; it re-reads g.lastX each frame
    const tick = () => {
      this.edgeRaf = 0;
      if (this.gesture !== g || !g.selecting) return;
      const s = edgeScrollStep(g.lastX, this.view.width);
      if (!s) return;
      const before = this.view.start;
      const span = this.view.width * this.view.fpp;
      const target = span >= this.total ? 0 : Math.max(0, Math.min(this.total - span, before + s * this.view.fpp));
      if (target !== before) {
        this.panTo(target);
        this.emitSelect(g, g.lastX, false);
      }
      if (this.gesture === g && g.selecting && !this.destroyed) this.edgeRaf = requestAnimationFrame(tick);
    };
    this.edgeRaf = requestAnimationFrame(tick);
  }

  stopEdgeLoop() { if (this.edgeRaf) { cancelAnimationFrame(this.edgeRaf); this.edgeRaf = 0; } }

  // The selection from the anchor to x. While the finger moves the minimum
  // length isn't enforced, so the band tracks the finger from the start.
  emitSelect(g, x, final) {
    const cur = this.snapX(x);
    const r = { start: Math.min(g.anchor, cur), end: Math.max(g.anchor, cur) };
    const min = final ? this.minLen : Math.max(1, Math.min(this.minLen, r.end - r.start));
    this.emit('regionChange', { region: clampRegion(r, this.total, min), final });
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = pinchDist(a, b);
      const mid = (a.x + b.x) / 2;
      const fpp = Math.min(this.maxFpp(), Math.max(MIN_FPP, g.fpp * (g.dist / dist)));
      const anchor = g.start + g.mid * g.fpp; // the frame under the original midpoint
      this.view.fpp = fpp;
      this.view.start = anchor - mid * fpp;
      this.clampView(); this.changed();
      return;
    }
    const dx = p.x - g.x0;
    g.dx = dx;
    if (Math.abs(dx) > TAP_MOVE || Math.abs(p.y - g.y0) > TAP_MOVE) g.moved = true;
    if (g.kind === 'grab') {
      if (g.moved) { this.grabMove(g, p); this.draw(); }
      return;
    }
    if (g.kind !== 'press') return;
    if (g.selecting) {
      this.emitSelect(g, p.x, false);
      this.draw();
      g.lastX = p.x;
      this.updateEdgeLoop(g);
    } else if (g.moved) {
      // Moved before the hold fired: this press is a pan, and stays one --
      // killing the timer is what decides. A pan is never half of a
      // double-tap either.
      this.clearHold(g);
      this.lastTap = null;
      this.view.start = g.start - dx * this.view.fpp;
      this.clampView(); this.changed();
    }
  }

  up(e) {
    const g = this.gesture;
    // A release from some other pointer must not finalize this gesture.
    // Pinches have no single owner and keep their own bookkeeping.
    if (g && g.id !== undefined && e.pointerId !== g.id) return;
    const p = this.pt(e);
    this.pointers.delete(e.pointerId);
    if (!g) return;
    // Dropping to one finger ends a pinch outright: the survivor does nothing
    // until it too lifts, rather than selecting from a stale anchor.
    if (g.kind === 'pinch') { if (this.pointers.size < 2) this.gesture = null; return; }
    this.gesture = null;
    const isTap = !g.moved && performance.now() - g.t0 < TAP_MS;
    if (g.kind === 'grab') {
      // A still press on something grabbable is a tap on it, however long
      // it was held: a slow tap on a pin still opens the flag.
      this.grabEnd(g, p, !g.moved);
      this.draw();
      return;
    }
    this.clearHold(g);
    this.stopEdgeLoop();
    if (g.selecting) {
      const cur = this.snapX(p.x);
      const len = Math.abs(cur - g.anchor);
      // A held select only commits if it left a visible band on screen.
      if (len >= this.minLen && len / this.view.fpp >= MIN_REGION_PX) {
        this.lastTap = null;
        this.emitSelect(g, p.x, true);
      } else {
        // Held, then barely moved: put back whatever selection the press
        // began from, so a hold that changed its mind destroys nothing.
        this.emit('regionChange', { region: g.prev, final: true });
      }
      return;
    }
    // Never held and never travelled: a tap, even one held past TAP_MS but
    // released before the hold fired. A press that panned ends silently.
    if (!g.moved) this.tap(p, g.hit);
  }

  // A tap, or the second of two taps close together in time and place.
  tap(p, h) {
    const now = performance.now();
    const double = !!(this.lastTap && now - this.lastTap.t < TAP_MS && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < DOUBLE_TAP_MOVE);
    this.lastTap = double ? null : { t: now, x: p.x, y: p.y };
    this.tapAt(p, h, double);
  }

  // Losing the capture mid-gesture is a cancel, not a release. It also fires
  // as the implicit release after every pointerup, so it only counts while
  // this pointer is still one being tracked: after a normal up() the pointer
  // is gone, and a plain tap can't land here and lose its lastTap.
  lostCapture(e) {
    if (this.gesture && this.pointers.has(e.pointerId)) this.cancel(e);
  }

  // A cancelled pointer is not a release: roll back, commit nothing.
  cancel(e) {
    if (this.gesture && this.gesture.id !== undefined && e.pointerId !== this.gesture.id) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    this.gesture = null;
    this.lastTap = null;
    this.rollback(g);
    this.draw();
  }

  // Undo a gesture that will never get its release. A drag that never moved,
  // or a press whose hold never fired, emitted nothing, so has nothing to
  // undo; clearing the hold first stops a pinch sprouting a selection.
  rollback(g) {
    if (!g) return;
    this.clearHold(g);
    this.stopEdgeLoop();
    if (g.kind === 'press' && g.selecting) this.emit('regionChange', { region: g.prev, final: true });
    if (g.kind === 'grab' && g.moved) this.grabRollback(g);
  }

  wheel(e) {
    e.preventDefault();
    // A surface can take the wheel over (the take page's boundary editor
    // moves its point with it).
    if (this.onWheel && this.onWheel(e)) return;
    const p = this.pt(e);
    // A plain wheel zooms about the pointer; shift, or a trackpad's sideways
    // axis, pans. Firefox reports lines or pages rather than pixels: scale
    // them so a notch goes about as far as it does elsewhere.
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if (e.shiftKey || horizontal) this.panTo(this.view.start + (horizontal ? dx : dy) * this.view.fpp);
    else this.zoomTo(this.view.fpp * Math.exp(dy * 0.01), p.x);
  }

  // --- viewport (shared by every surface) -----------------------------------
  maxFpp() { return Math.max(MIN_FPP, this.total / this.view.width); }
  fitAll() { this.view.fpp = this.maxFpp(); this.view.start = 0; this.changed(); }
  centerOn(frame) { this.view.start = frame - (this.view.width * this.view.fpp) / 2; this.clampView(); this.changed(); }
  panTo(start) { this.view.start = start; this.clampView(); this.changed(); }
  zoomTo(fpp, aroundX) {
    const f = xToFrame(aroundX, this.view);
    this.view.fpp = Math.min(this.maxFpp(), Math.max(MIN_FPP, fpp));
    this.view.start = f - aroundX * this.view.fpp;
    this.clampView(); this.changed();
  }
  clampView() {
    // fpp first: a resize changes what maxFpp() means, and fpp above it
    // would leave dead space past the end of the take.
    this.view.fpp = Math.min(this.maxFpp(), Math.max(MIN_FPP, this.view.fpp));
    const span = this.view.width * this.view.fpp;
    this.view.start = Math.max(0, Math.min(this.total - span, this.view.start));
    if (span >= this.total) this.view.start = 0;
  }
  /** Keep a frame on screen, paging the view if it has run off either side. */
  follow(frame) {
    const span = this.view.width * this.view.fpp;
    if (frame < this.view.start || frame > this.view.start + span) this.centerOn(frame);
  }
}
