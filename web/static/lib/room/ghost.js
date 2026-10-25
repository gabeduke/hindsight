// web/static/lib/room/ghost.js
// The drawing half of the flight from a spine on the shelf to the deck
// (docs/superpowers/plans/2026-10-15-f5b.md; the motion is R2's, ported from
// docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md): the ghost of
// a take, as a drawer for the scene's DOM renderer (lib/scene/dom.js).
//
// It only draws. Every pose -- where the ghost is, how its spine and its
// face are turned, how much shadow it throws -- comes from the flight model's
// view (lib/scene/flight.js); each frame writes transforms and opacities and
// nothing else, so the browser composites the move and lays nothing out. It
// takes no input: the shelf's own spine stays where it was, ringed, and is
// the control.

import { MODELS } from '../scene/models.js';
import { FlightModel } from '../scene/flight.js';

/** FLIGHT_MODELS are the scene's kinds with the flight's: registered here, so only the room, behind its flag, loads it. */
export const FLIGHT_MODELS = Object.freeze({ ...MODELS, flight: () => new FlightModel() });

function el(doc, tag, cls, attrs = {}, ...kids) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}

/**
 * faceEl is what the ghost shows once the spine has turned: a take as a
 * cassette, its label in its tag's stripe and its name in marker.
 * `face` is {name, stripe}.
 */
export function faceEl(doc, face) {
  return el(doc, 'span', `room-face room-face-cassette stripe-${face.stripe}`, { 'aria-hidden': 'true' },
    el(doc, 'span', 'room-face-label', {}, el(doc, 'span', 'room-face-band'), el(doc, 'span', 'room-face-name', { text: face.name })),
    el(doc, 'span', 'room-face-window', {}, el(doc, 'span', 'room-face-hub'), el(doc, 'span', 'room-face-hub')));
}

/**
 * GhostDrawer draws one flight: a ghost of the thing, fixed over the page,
 * with two planes -- its spine (a copy of the shelf's own button, drawn as
 * the shelf draws it) and its face -- each with a shadow under it.
 */
export class GhostDrawer {
  constructor({ doc, host, source, face }) {
    const spineCopy = source ? source.cloneNode(true) : el(doc, 'span');
    // A copy of the button must not be a second one: no id, no key, no focus.
    for (const n of [spineCopy, ...(spineCopy.querySelectorAll?.('[id], [data-key]') || [])]) {
      n.removeAttribute?.('id');
      n.removeAttribute?.('data-key');
    }
    spineCopy.classList?.remove('on-deck', 'selected', 'down');
    spineCopy.setAttribute?.('tabindex', '-1');
    spineCopy.setAttribute?.('aria-hidden', 'true');
    this.spine = el(doc, 'span', 'room-carry-plane room-carry-spine', {}, el(doc, 'span', 'room-carry-shade'), spineCopy);
    this.face = el(doc, 'span', 'room-carry-plane room-carry-face', {}, el(doc, 'span', 'room-carry-shade room-carry-shade-take'), faceEl(doc, face));
    this.box = el(doc, 'span', 'room-carry', { 'aria-hidden': 'true', inert: true, hidden: true }, this.spine, this.face);
    this.shades = [this.spine.children[0], this.face.children[0]];
    this.sized = null;
    host.append(this.box);
  }

  size(from, to) {
    const fw = to ? to.w : Math.max(from.w, from.h);
    const fh = to ? to.h : fw / 1.59;
    Object.assign(this.spine.style, { width: `${from.w}px`, height: `${from.h}px`, marginLeft: `${-from.w / 2}px`, marginTop: `${-from.h / 2}px` });
    Object.assign(this.face.style, { width: `${fw}px`, height: `${fh}px`, marginLeft: `${-fw / 2}px`, marginTop: `${-fh / 2}px` });
  }

  draw(view, state) {
    if (!view) { this.box.hidden = true; return; }
    this.box.hidden = false;
    const geo = `${state.from.w},${state.from.h}|${state.to ? `${state.to.w},${state.to.h}` : ''}`;
    if (geo !== this.sized) { this.sized = geo; this.size(state.from, state.to); }
    this.box.style.transform = `translate3d(${view.x.toFixed(2)}px, ${view.y.toFixed(2)}px, 0) rotate(${view.tilt.toFixed(2)}deg)`;
    this.spine.style.transform = `rotateY(${view.spine.ry.toFixed(2)}deg) scale(${view.spine.s.toFixed(4)})`;
    this.spine.style.opacity = String(view.spine.o);
    this.face.style.transform = `rotateY(${view.face.ry.toFixed(2)}deg) scale(${view.face.s.toFixed(4)})`;
    this.face.style.opacity = String(view.face.o);
    for (const s of this.shades) {
      s.style.opacity = view.shadow.o.toFixed(3);
      s.style.transform = `translate3d(0, ${view.shadow.dy.toFixed(1)}px, 0)`;
    }
  }

  twin() { return null; }

  destroy() { this.box.remove(); }
}
