// web/static/lib/room/stage.js
// The Listening Room drawn: a renderer on the scene contract (lib/scene/
// renderer.js) that draws ROOM (lib/room/space.js) as one SVG picture, each
// object by its own art function (lib/room/art/), and can lay a page's own
// markup -- an object's control -- over where that object stands: its DOM
// twin. The room is the Listening Room's backdrop now (backdropRoom, below),
// drawn with no twins: the shelves are a wall of their own in front of it.
//
// It draws once per view (the wide one, or the tall one for a portrait
// frame) and then nothing: the room is still, its props never ask the ticker
// for a frame, and a resize inside the same view is the browser's (the SVG
// scales, the twins are placed in fractions of the frame). The deck's reels
// turn in CSS on the deck's own markup.
//
// A later renderer (R3's planes with parallax; a 3D one) reads the same scene
// -- each object's box, material and the lights -- and keeps the same twins.

import { Scene } from '../scene/scene.js';
import { SceneObject } from '../scene/object.js';
import { ROOM, viewFor, project, face, inFrame, corners, lit, diffuse, drawOrder, keyLight, wallShadow } from './space.js';
import { ART } from './art/index.js';
import { Defs, textures } from './art/kit.js';

/**
 * backdropRoom is the room as the Listening Room's backdrop (docs/plan/
 * the-studio-space.md, "The studio is a place"): the room without the
 * furniture whose faces were the page's own markup -- the bookcase, whose
 * shelves are the wall in front of it now, and the deck, which is the bar.
 * Drawn alone, either would be its sides and its shadow, with nothing on
 * them.
 */
export function backdropRoom(room = ROOM) {
  return { ...room, objects: room.objects.filter((o) => o.id !== 'shelves' && o.id !== 'deck') };
}

/** roomScene is the room as a scene: one prop per object, its state the object. */
export function roomScene(room = ROOM, opts = {}) {
  const scene = new Scene(opts);
  for (const o of room.objects) scene.add(new SceneObject(o.id, 'prop', o));
  return scene;
}

/**
 * drawRoom is the picture of `objects` (ROOM.objects' entries) in the view
 * named `name`, as an SVG string. Pure.
 */
export function drawRoom(objects, name = 'wide', room = ROOM, { onError = null } = {}) {
  const view = room.views[name];
  const id = `room-art-${name}`;
  const defs = new Defs(id);
  const P = (x, y, z) => project({ x, y, z }, view);
  const ctx = {
    view, P, defs, id, room: { ...room, objects },
    light: (normal, point) => diffuse(normal, point, room.lights),
  };
  let body = '';
  for (const o of drawOrder(objects)) {
    const art = ART[o.art];
    if (!art) continue;
    try {
      body += `<g class="room-art-part" data-object="${o.id}">${art(o, ctx)}</g>`;
    } catch (e) {
      if (onError) onError(e); else throw e;
    }
  }
  // The air: a vignette, darker at the corners, and darker still low down
  // in the near floor, where no light reaches.
  const c = view.crop;
  const lamp = project(keyLight(room).at, view);
  const vg = defs.radial([[0, '--room-shadow', 0], [0.55, '--room-shadow', 0], [0.85, '--room-shadow', 0.38], [1, '--room-shadow', 0.62]],
    { cx: c.left + c.width / 2, cy: -c.top + c.height * 0.46, rx: Math.hypot(c.width, c.height) * 0.62, ry: Math.hypot(c.width, c.height) * 0.5 });
  body += `<rect class="room-art-air" x="${c.left - 900}" y="${-c.top - 600}" width="${c.width + 1800}" height="${c.height + 1200}" fill="${vg}"/>`;
  const tex = textures(id).replace('x="SX"', `x="${lamp.x.toFixed(1)}"`).replace('y="SY"', `y="${lamp.y.toFixed(1)}"`);
  return `<svg class="room-art" viewBox="${c.left} ${-c.top} ${c.width} ${c.height}" preserveAspectRatio="xMidYMid meet" overflow="visible" aria-hidden="true" focusable="false"><defs>${tex}${defs}</defs>${body}</svg>`;
}

/**
 * RoomRenderer draws a room scene into an element, and places its twins.
 * twins: object id → the element that is that object's control and face
 * ({shelves, deck}). box: the element the picture and the twins
 * share (it is the view's crop).
 */
export class RoomRenderer {
  constructor({ twins = {}, box = null, room = ROOM, onError = null } = {}) {
    this.twins = twins;
    this.box = box;
    this.room = room;
    this.onError = onError;
    this.view = null;
    this.scene = null;
    this.el = null;
    this.leave = null;
  }

  mount(el, scene) {
    this.el = el;
    this.scene = scene;
    this.leave = scene.attach(this);
  }

  /** setView draws the room in a view, if it isn't already drawn in it. */
  setView(name) {
    if (!this.room.views[name] || name === this.view) return false;
    this.view = name;
    const objects = this.scene.objects().map((o) => o.view || o.state);
    this.el.innerHTML = drawRoom(objects, name, this.room, { onError: this.onError });
    this.place();
    return true;
  }

  /** viewFor is the view for a frame box `w` by `h`. */
  pick(w, h) { return w > 0 && h > 0 ? viewFor(w / h, this.room) : 'wide'; }

  /**
   * place puts each twin over its object, in fractions of the frame, with
   * what the room's light says about it as custom properties for its CSS:
   * --lamp-x/--lamp-y (where the lamp is, in its own box, %), --key (how
   * much of the lamp reaches it, 0..1), --cast-x/--cast-y (its shadow on the
   * wall, in room units: the CSS multiplies by --room-u).
   */
  place() {
    const view = this.room.views[this.view];
    const L = keyLight(this.room);
    const lampAt = project(L.at, view);
    const objects = new Map(this.scene.objects().map((o) => [o.id, o.view || o.state]));
    // Where the lamp is in the frame, for the glow laid over the picture.
    const lf = inFrame({ x: lampAt.x, y: lampAt.y, w: 0, h: 0 }, view);
    this.el.style?.setProperty?.('--lamp-fx', `${(lf.left * 100).toFixed(2)}%`);
    this.el.style?.setProperty?.('--lamp-fy', `${(lf.top * 100).toFixed(2)}%`);
    for (const [oid, el] of Object.entries(this.twins)) {
      const o = objects.get(oid);
      if (!o || !el) continue;
      const fc = face(o, view);
      const r = inFrame(fc, view);
      const st = el.style;
      const pct = (n) => `${(n * 100).toFixed(3)}%`;
      if (oid === 'shelves') {
        st.left = pct(r.left);
        st.width = pct(r.width);
        st.bottom = pct(1 - r.top - r.height);
        st.minHeight = pct(r.height);
      } else {
        st.left = pct(r.left);
        st.top = pct(r.top);
        st.width = pct(r.width);
        st.height = pct(r.height);
      }
      const k = lit(o, this.room.lights).lamp;
      const cast = wallShadow(o, L);
      st.setProperty('--lamp-x', pct((lampAt.x - fc.x) / (fc.w || 1)));
      st.setProperty('--lamp-y', pct((lampAt.y - fc.y) / (fc.h || 1)));
      st.setProperty('--key', (k ? k.amount : 0).toFixed(3));
      st.setProperty('--cast-x', cast.dx.toFixed(2));
      st.setProperty('--cast-y', cast.dy.toFixed(2));
      st.setProperty('--cast-dir', String(k ? -k.side : 1));
    }
  }

  /** unplace takes the twins back to the page's own layout (the rows), and forgets the view. */
  unplace() {
    if (this.view === null) return;
    this.view = null;
    for (const el of Object.values(this.twins)) {
      if (!el) continue;
      for (const k of ['left', 'top', 'width', 'height', 'bottom', 'min-height', '--lamp-x', '--lamp-y', '--key', '--cast-x', '--cast-y', '--cast-dir']) el.style.removeProperty(k);
    }
  }

  frame() { /* still: everything was drawn by setView */ }

  /** hit is the object whose box, as drawn, holds viewport point (x, y): the nearest on top. */
  hit(x, y) {
    const box = (this.box || this.el)?.getBoundingClientRect?.();
    if (!box || !box.width || !this.view) return null;
    const view = this.room.views[this.view];
    const c = view.crop;
    const px = c.left + ((x - box.left) / box.width) * c.width;
    const py = -c.top + ((y - box.top) / box.height) * c.height;
    const order = drawOrder(this.scene.objects().map((o) => o.view || o.state)).reverse();
    for (const o of order) {
      if (o.mount === 'shell') continue;
      const pts = Object.values(corners(o)).map((p) => project(p, view));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      if (px >= Math.min(...xs) && px <= Math.max(...xs) && py >= Math.min(...ys) && py <= Math.max(...ys)) return o.id;
    }
    return null;
  }

  /** twin is the control laid over an object: the shelves, the deck; null for a picture. */
  twin(id) { return this.twins[id] || null; }

  destroy() {
    this.leave?.();
    this.leave = null;
    if (this.el) this.el.innerHTML = '';
    this.scene = null;
    this.el = null;
  }
}
