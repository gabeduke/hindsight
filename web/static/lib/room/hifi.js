// web/static/lib/room/hifi.js
// The drawing half of the move off the shelf and into the deck
// (docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md): the
// deck's moving parts, and the ghost of a thing in flight, as drawers for
// the scene's DOM renderer (lib/scene/dom.js).
//
// They only draw. The deck's door, its reels and the tape's sag come from
// the deck model's view; the ghost's every pose comes from the flight
// model's. Each frame writes transforms and opacities and nothing else, so
// the browser composites the move rather than laying the page out again.
// What's in the deck's window is built from the deck's `loaded` state when
// it changes, by the same function that builds the ghost's face, so the
// hand-over at the window is the same picture on both sides.

import { MODELS } from '../scene/models.js';
import { FlightModel } from '../scene/flight.js';
import { DeckModel } from '../scene/deck.js';

/**
 * HIFI_MODELS are the scene's kinds with the room's two: the deck, and a
 * thing in flight. Registered here rather than in lib/scene/models.js, so
 * only the room -- behind its flag -- ever loads them.
 */
export const HIFI_MODELS = Object.freeze({
  ...MODELS,
  deck: () => new DeckModel(),
  flight: () => new FlightModel(),
});

const NS = 'http://www.w3.org/2000/svg';

function el(tag, cls, attrs = {}, ...kids) {
  const e = document.createElement(tag);
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
 * vtName is the View Transition name a take or a tape wears while it's away
 * from its shelf: `take-<name>` or `tape-<id>`, made a CSS identifier.
 */
export function vtName(key) {
  const i = key.indexOf(':');
  const kind = key.slice(0, i), id = key.slice(i + 1);
  return `${kind}-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** tapeStrand is a strand of tape, as an SVG path its sag is written into. */
export function tapeStrand(cls) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 -2 100 14');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M0 0 Q50 0 100 0');
  svg.append(path);
  return svg;
}

/**
 * faceEl draws what a thing shows in the deck's window: a take is a
 * cassette, its label in its stripe and its name in marker, its hubs in the
 * middle with the tape between them. A tape shows nothing of its own there:
 * the deck's reels are its reels. `ghost` draws a tape anyway, as the front
 * of its reel box, for its flight.
 */
export function faceEl(face, { ghost = false } = {}) {
  if (!face) return null;
  if (face.kind === 'tape') {
    if (!ghost) return null;
    return el('span', `room-face room-face-box box-${face.stripe}`, { 'aria-hidden': 'true' },
      el('span', 'room-face-box-hole', {}, el('span', 'room-face-box-reel')),
      el('span', 'room-face-box-label', { text: face.name }));
  }
  return el('span', `room-face room-face-cassette stripe-${face.stripe}`, { 'aria-hidden': 'true' },
    el('span', 'room-face-label', {}, el('span', 'room-face-band'), el('span', 'room-face-name', { text: face.name })),
    el('span', 'room-face-window', {},
      tapeStrand('room-face-tape'),
      el('span', 'room-face-hub'), el('span', 'room-face-hub')));
}

/**
 * DeckDrawer draws the deck object: its door, the reels within (the big
 * reels for a tape, a cassette's hubs for a take), the tape's sag, and what
 * is in its window.
 */
export class DeckDrawer {
  /** parts: the deck section, its window, the holder for what's in it, the door, the two reels, the tape. */
  constructor({ deck, window: win, load, door, reels, tape }) {
    this.deck = deck;
    this.el = win;
    this.load = load;
    this.door = door;
    this.reels = reels;
    this.tape = tape;
    this.loaded = undefined;
    this.face = null;
    this.spinners = reels;
    this.path = tape.querySelector('path');
  }

  draw(view, state) {
    if (state.loaded !== this.loaded) {
      this.loaded = state.loaded;
      const f = state.loaded;
      this.face = faceEl(f);
      this.load.replaceChildren(...(this.face ? [this.face] : []));
      this.deck.classList.toggle('room-has-cassette', f?.kind === 'take');
      this.deck.classList.toggle('room-has-tape', f?.kind === 'tape');
      // The one thing away from its shelf wears its name: here, once it's in.
      this.el.style.viewTransitionName = f ? vtName(f.key) : '';
      this.spinners = this.face ? [...this.face.querySelectorAll('.room-face-hub')] : this.reels;
      this.path = (this.face?.querySelector('.room-face-tape') || this.tape).querySelector('path');
    }
    if (!view) return;
    this.door.style.transform = `translate3d(0, ${view.door.toFixed(2)}px, 0)`;
    if (this.face) this.face.style.transform = view.seat === 1 ? '' : `scale(${view.seat.toFixed(4)})`;
    const turn = `rotate(${view.angle.toFixed(2)}deg)`;
    for (const r of this.spinners) r.style.transform = turn;
    this.path.setAttribute('d', `M0 0 Q50 ${(2 * view.sag).toFixed(2)} 100 0`);
  }

  twin() { return null; }
}

/**
 * FlightDrawer draws one flight: a ghost of the thing, fixed over the page,
 * with two planes -- its spine (a copy of the shelf's own button, drawn as
 * the shelf draws it) and its face (as the deck's window will show it) --
 * each with a shadow under it. It takes no input: the shelf's button stays
 * where it was, as the gap, and is the control.
 */
export class FlightDrawer {
  constructor({ host, source, face, name }) {
    const spineCopy = source ? source.cloneNode(true) : el('span');
    for (const n of [spineCopy, ...spineCopy.querySelectorAll('*')]) {
      n.removeAttribute('id');
      n.removeAttribute('data-key');
    }
    spineCopy.classList.remove('pulled', 'on-deck', 'room-out');
    spineCopy.setAttribute('tabindex', '-1');
    // Each plane's shadow is a soft dark shape the size of what's drawn,
    // under it: only its edges show, more as it lifts.
    this.spine = el('span', 'room-carry-plane room-carry-spine', {}, el('span', 'room-carry-shade'), spineCopy);
    this.face = el('span', 'room-carry-plane room-carry-face', {},
      el('span', `room-carry-shade room-carry-shade-${face?.kind || 'take'}`), faceEl(face, { ghost: true }));
    this.box = el('span', 'room-carry', { 'aria-hidden': 'true', inert: true, hidden: true }, this.spine, this.face);
    this.shades = [...this.box.querySelectorAll('.room-carry-shade')];
    this.name = name;
    this.sized = null;
    host.append(this.box);
  }

  size(from, to) {
    const sw = from.w, sh = from.h;
    const fw = to ? to.w : Math.max(from.w, from.h);
    const fh = to ? to.h : Math.max(from.w, from.h) * 0.63;
    Object.assign(this.spine.style, { width: `${sw}px`, height: `${sh}px`, marginLeft: `${-sw / 2}px`, marginTop: `${-sh / 2}px` });
    Object.assign(this.face.style, { width: `${fw}px`, height: `${fh}px`, marginLeft: `${-fw / 2}px`, marginTop: `${-fh / 2}px` });
  }

  draw(view, state) {
    if (!view) { this.box.hidden = true; return; }
    if (this.box.hidden) {
      this.box.hidden = false;
      this.box.style.viewTransitionName = this.name;
    }
    const geo = `${state.from.x},${state.from.y},${state.from.w},${state.from.h}|${state.to ? `${state.to.w},${state.to.h}` : ''}`;
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
