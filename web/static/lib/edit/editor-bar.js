// web/static/lib/edit/editor-bar.js
// The editor bar's gesture core, shared by every page that edits a point to
// the sample: the take page's boundary editor (In, Out, bar 1) and the tape
// page's clip editor (Align). Moved here from lib/wave/page.js; see
// docs/superpowers/specs/2026-10-05-boundary-editor-design.md.
//
// It owns how a hand moves the point -- the two encoder pads, the ◂ ▸ steps,
// the pads' arrow keys, the wheel -- and when a move is saved: a whole
// gesture (a drag, a held key, a burst of wheel notches) is one save, so it
// is one undo step. What the point is, where it may go and how it is saved
// belong to the host page:
//
//   host.active()        -> is something being edited
//   host.frame()         -> the point, or null
//   host.land(frame)     -> where a move to frame lands (the host's clamp); no side effects
//   host.place(f, save)  -> put the point at f (as land answered); save it if save
//   host.fpp(), host.width() -> the view's zoom and its width in px
//   host.follow(fpp?)    -> centre the view on the point (at fpp)
//   host.sampleRate
//   host.render()        -> redraw the readout and the view, after a move
//   host.readout()       -> redraw the readout alone, after a zoom (default: render)
//
// els: { zoom, pos, back, fwd, step } -- the pads, the step keys, the step label.

import { zoomBy, positionBy, stepFrames, stepLabel, wholeFrames } from '../wave/boundary.js';

/**
 * gestureSave is the rule that makes a gesture one save: a move that isn't
 * final marks the gesture dirty and saves nothing; a final one saves if it
 * changed the point or the gesture before it did, and ends the gesture.
 */
export function gestureSave(prev, next, final, dirty) {
  const changed = next !== prev;
  return { save: final && (changed || dirty), dirty: final ? false : dirty || changed };
}

export class EditorBar {
  constructor({ els, host }) {
    this.els = els;
    this.host = host;
    // Moved but not yet saved (a drag, a held key, a wheel): the next final one
    // saves, so a whole gesture is one undo step.
    this.dirty = false;
    this.wheelTimer = 0;
    this.wheelAcc = 0; // fractional frames the wheel has turned but not yet moved
    this.posAcc = 0; // fractional frames the POSITION pad has turned but not yet moved

    this.wirePad(els.zoom, (dx, w) => { host.follow(zoomBy(host.fpp(), dx, w)); this.readout(); });
    this.wirePad(els.pos, (dx, w, final) => {
      if (final) {
        this.posAcc = 0;
        if (this.dirty) this.move(host.frame(), true);
        return;
      }
      const { whole, rest } = wholeFrames(this.posAcc + positionBy(dx, w, { width: host.width(), fpp: host.fpp() }));
      this.posAcc = rest;
      if (whole) this.move(host.frame() + whole, false);
    }, () => { this.posAcc = 0; });

    els.back.addEventListener('click', () => this.step(-1));
    els.fwd.addEventListener('click', () => this.step(1));
    // On a focused pad: ← / → are a step on POSITION, a halving or doubling of
    // the zoom on ZOOM; Shift is ten times as much.
    els.pos.addEventListener('keydown', (e) => {
      if (!host.active() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault(); e.stopPropagation();
      this.step(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 10 : 1, !e.repeat);
    });
    els.zoom.addEventListener('keydown', (e) => {
      if (!host.active() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault(); e.stopPropagation();
      const k = e.shiftKey ? 10 : 2;
      host.follow(e.key === 'ArrowRight' ? host.fpp() / k : host.fpp() * k);
      this.readout();
    });
    // A held key saves when it lets go.
    document.addEventListener('keyup', (e) => {
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && host.active() && this.dirty) this.move(host.frame(), true);
    });
  }

  readout() {
    if (this.host.readout) this.host.readout(); else this.host.render();
  }

  // A pad turned by dragging sideways, like a knob: fn(dx, padWidth, final)
  // for each move, and once more with final on release.
  wirePad(pad, fn, onStart) {
    const host = this.host;
    let last = null, id = null;
    pad.addEventListener('pointerdown', (e) => {
      if (!host.active() || id !== null || e.button !== 0) return; // the primary button; touch and pen report 0
      id = e.pointerId; last = e.clientX;
      onStart?.();
      pad.setPointerCapture(id); pad.classList.add('active');
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - last; last = e.clientX;
      if (dx && host.active()) fn(dx, pad.getBoundingClientRect().width, false);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; pad.classList.remove('active');
      if (host.active()) fn(0, pad.getBoundingClientRect().width, true);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end); // a lost capture ends the drag too, or the pad is dead
  }

  // Moves the point to frame; final saves (one undo step, however many moves
  // came before it).
  move(frame, final) {
    const prev = this.host.frame();
    if (prev == null) return;
    const f = this.host.land(frame);
    const { save, dirty } = gestureSave(prev, f, final, this.dirty);
    this.dirty = dirty;
    this.host.place(f, save);
    this.host.render();
  }

  // One step on the keys and the pads' arrows; a held key saves when it lets go.
  step(sign, n = 1, final = true) {
    this.move(this.host.frame() + sign * n * stepFrames(this.host.fpp(), this.host.sampleRate), final);
  }

  // Saves a move still being made (a drag, a held key, a wheel burst), so
  // nothing that reaches the screen is lost to what happens next.
  commit() {
    clearTimeout(this.wheelTimer);
    this.wheelAcc = 0;
    if (this.host.active() && this.dirty) this.move(this.host.frame(), true);
  }

  // The wheel moves the point (⌘ or Ctrl with it zooms), a notch about as far
  // as it goes on the canvas elsewhere. A burst of notches is one undo step.
  // For a view's onWheel: true when it took the wheel.
  wheel(e) {
    const host = this.host;
    if (!host.active()) return false;
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.metaKey || e.ctrlKey) {
      host.follow(host.fpp() * Math.exp(e.deltaY * k * 0.01));
    } else {
      // Small deltas at a deep zoom add up to a frame, in either direction.
      const { whole, rest } = wholeFrames(this.wheelAcc + (e.deltaY + e.deltaX) * k * host.fpp());
      this.wheelAcc = rest;
      if (whole) this.move(host.frame() + whole, false);
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => this.commit(), 250);
    }
    this.readout();
    return true;
  }

  // The step label: what one ◂ or ▸ moves at this zoom.
  renderStep() {
    this.els.step.textContent = stepLabel(stepFrames(this.host.fpp(), this.host.sampleRate), this.host.sampleRate);
  }
}
