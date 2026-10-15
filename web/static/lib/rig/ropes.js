// web/static/lib/rig/ropes.js
// The rig's cables, drawn as ropes: an SVG renderer on the scene contract
// (lib/scene/renderer.js) for objects of the `cable` kind
// (lib/scene/cable.js; docs/superpowers/specs/2026-10-15-r4-cables-design.md).
//
// It only draws. The model works out where each rope's points are; this
// turns them into a path, in P6's width, dash and ink for the cable's kind
// (kinds.js), with a plug at each end. A cable waiting for a restart is
// hollow with open square plugs, as P6 drew it. A rope is redrawn only when
// its view or state changed, so a still rig costs a frame nothing.
//
// It never takes input. Nothing it draws has pointer events (the SVG is
// .rig-wires); the sockets underneath are the controls, for a finger, the
// keyboard and a screen reader. A tap on a rope's run finds it through
// hit(), and twin() is the socket button at its `from` end.

import { styleOf } from './kinds.js';

const SVGNS = 'http://www.w3.org/2000/svg';
/** How near a point must be to a rope's run to hit it, beyond its half-width, in px. */
export const HIT_PX = 8;
/** The rope in the hand while a cable is drawn out of a socket (P6's .rig-wire-drawing). */
const DRAWING = { width: 5, dash: '', ink: '', faded: false, hollow: false };

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * ropePath is the SVG path through a rope's points: a smooth curve through
 * the midpoints between them, from the first point to the last.
 */
export function ropePath(pts) {
  const n = pts.length;
  if (n < 2) return '';
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
  if (n === 2) return `${d} L${r1(pts[1].x)} ${r1(pts[1].y)}`;
  d += ` L${r1((pts[0].x + pts[1].x) / 2)} ${r1((pts[0].y + pts[1].y) / 2)}`;
  for (let i = 1; i < n - 1; i++) {
    const nx = (pts[i].x + pts[i + 1].x) / 2;
    const ny = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${r1(pts[i].x)} ${r1(pts[i].y)} ${r1(nx)} ${r1(ny)}`;
  }
  return `${d} L${r1(pts[n - 1].x)} ${r1(pts[n - 1].y)}`;
}

/**
 * strokes is a cable's stroke, as path elements: one, or two for a hollow
 * one (a restart cable before the restart) -- its ink, and the desk showing
 * down the middle. The legend draws its samples with it too.
 */
export function strokes(doc, d, st, cls) {
  const one = (width, stroke, extra) => {
    const p = doc.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', `${cls}${st.faded ? ' faded' : ''}${extra}`);
    p.setAttribute('stroke-width', String(width));
    if (st.dash) p.setAttribute('stroke-dasharray', st.dash);
    if (stroke) p.style.stroke = stroke;
    return p;
  };
  if (!st.hollow) return [one(st.width, st.ink, '')];
  return [one(st.width, st.ink, ''), one(Math.max(1.5, st.width - 3.5), 'var(--desk-felt-lo)', ' rig-wire-core')];
}

/** look is what a rope's state says about how it's drawn: its elements change only when this does. */
function look(s) {
  return [s.kind, s.pending || '', !!s.off, !!s.waiting, !!s.selected, !!s.drawing, !!s.declared, s.loose || ''].join('|');
}

/** near is how far point (x, y) is from a rope's run. */
function near(pts, x, y) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

export class RopeRenderer {
  /**
   * doc: where elements come from (a test passes a stand-in). twinOf: the
   * socket button for a socket id; by default the rig's .rig-sock.
   */
  constructor({ doc = globalThis.document, twinOf = null } = {}) {
    this.doc = doc;
    this.twinOf = twinOf || ((id) => [...doc.querySelectorAll('.rig-sock')].find((b) => b.dataset.sock === id) || null);
    this.ropes = new Map(); // id → {g, lines, plugs, view, state, look}
    this.scene = null;
    this.el = null;
    this.leave = null;
    this.redrawn = 0; // ropes redrawn in all: for tests, and the frame-time probe
  }

  mount(el, scene) {
    this.el = el;
    this.scene = scene;
    this.leave = scene.attach(this);
  }

  frame() {
    if (!this.scene) return;
    const live = new Set();
    for (const obj of this.scene.objects()) {
      if (obj.kind !== 'cable') continue;
      live.add(obj.id);
      const r = this.ropes.get(obj.id);
      if (r && r.view === obj.view && r.state === obj.state) continue;
      this.draw(obj, r);
    }
    for (const [id, r] of this.ropes) {
      if (live.has(id)) continue;
      r.g.remove();
      this.ropes.delete(id);
    }
  }

  // draw redraws one rope: its path, and its plugs where its ends are. Its
  // elements are made again only when how it looks changed.
  draw(obj, r) {
    const { state, view } = obj;
    const pts = view ? view.points : [];
    const d = ropePath(pts);
    const lk = look(state);
    if (!r || r.look !== lk) {
      const g = r ? r.g : this.doc.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'rig-rope');
      g.setAttribute('data-cable', obj.id);
      const st = state.drawing ? DRAWING : styleOf(state);
      const cls = state.drawing
        ? 'rig-wire rig-wire-drawing'
        : `rig-wire rig-wire-${state.kind}${state.pending ? ' pending' : ''}${state.selected ? ' sel' : ''}`;
      const lines = strokes(this.doc, d, st, cls);
      // A jack you drew is a label, drawn from its tag: no plugs.
      const plugs = state.declared ? [] : [0, 1].map((end) => {
        const loose = state.loose === (end ? 'b' : 'a');
        const p = this.doc.createElementNS(SVGNS, state.pending ? 'rect' : 'circle');
        p.setAttribute('class', `rig-plug${state.pending ? ' pending' : ''}${loose ? ' loose' : ''}`);
        if (state.pending) {
          p.setAttribute('width', '12');
          p.setAttribute('height', '12');
        } else {
          p.setAttribute('r', loose ? '6' : '5');
        }
        return p;
      });
      if (r) r.g.replaceChildren(...lines, ...plugs);
      else {
        g.append(...lines, ...plugs);
        this.el.append(g);
      }
      r = { g, lines, plugs, look: lk };
      this.ropes.set(obj.id, r);
    } else {
      for (const l of r.lines) l.setAttribute('d', d);
    }
    if (pts.length) {
      r.plugs.forEach((p, end) => {
        const at = end ? pts[pts.length - 1] : pts[0];
        if (state.pending) {
          p.setAttribute('x', String(r1(at.x - 6)));
          p.setAttribute('y', String(r1(at.y - 6)));
        } else {
          p.setAttribute('cx', String(r1(at.x)));
          p.setAttribute('cy', String(r1(at.y)));
        }
      });
    }
    r.view = view;
    r.state = state;
    this.redrawn++;
  }

  /**
   * hit is the cable whose rope runs within HIT_PX (and its half-width) of
   * viewport point (x, y): the nearest, and of two as near the one on top.
   * The rope in the hand isn't a cable yet, so it's never hit.
   */
  hit(x, y) {
    if (!this.scene || !this.el) return null;
    const box = this.el.getBoundingClientRect();
    const px = x - box.left, py = y - box.top;
    let found = null;
    let best = Infinity;
    for (const obj of this.scene.objects()) {
      if (obj.kind !== 'cable' || obj.state.drawing || !obj.view) continue;
      const reach = HIT_PX + (styleOf(obj.state).width || 0) / 2;
      const d = near(obj.view.points, px, py);
      if (d <= reach && d <= best) {
        found = obj.id;
        best = d;
      }
    }
    return found;
  }

  /** twin is the socket button at a cable's `from` end (its socket, for a label): the control for it. */
  twin(id) {
    const obj = this.scene && this.scene.get(id);
    if (!obj || obj.kind !== 'cable') return null;
    const { from, to } = obj.state;
    return this.twinOf(String(from || '').startsWith('label:') ? to : from) || null;
  }

  destroy() {
    this.leave?.();
    this.leave = null;
    for (const r of this.ropes.values()) r.g.remove();
    this.ropes.clear();
    this.scene = null;
    this.el = null;
  }
}
