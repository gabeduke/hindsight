// web/static/lib/scene/dom.js
// The DOM renderer: today's objects, drawn as they always were, from their
// models' views. Each object in the scene is drawn by a drawer -- the
// drawing half of an object in lib/objects (a VU face, a pair of reels, a
// cassette, the ribbon's tape) -- which is anything with
//
//   draw(view, state, dt)   draw this object; never writes state
//   el                      (optional) its element, for hit()
//   twin()                  (optional) its button, for twin()
//   destroy()               (optional) take it down
//
// A drawer is called only when its object's view or state has changed since
// it last drew, or when it was invalidated (a resize, a font, the scheme):
// a still scene costs a frame nothing, and the ticker parks.

export class DomRenderer {
  constructor() {
    this.parts = new Map();  // id → drawer
    this.drawn = new Map();  // id → {view, state} as last drawn
    this.dirty = new Set();
    this.scene = null;
    this.el = null;
    this.leave = null;
  }

  /** part says that `drawer` draws the object `id`. Returns a function that undoes it. */
  part(id, drawer) {
    this.parts.set(id, drawer);
    this.drawn.delete(id);
    this.dirty.add(id);
    this.scene?.wake();
    return () => this.unpart(id);
  }

  unpart(id) {
    const d = this.parts.get(id);
    this.parts.delete(id);
    this.drawn.delete(id);
    this.dirty.delete(id);
    d?.destroy?.();
  }

  mount(el, scene) {
    this.el = el;
    this.scene = scene;
    this.leave = scene.attach(this);
  }

  /**
   * invalidate redraws `id` (every part, without one) on the next frame,
   * with the view it has: for what isn't motion -- a resize, a font that
   * arrived, the scheme turning dark.
   */
  invalidate(id) {
    if (id === undefined) for (const k of this.parts.keys()) this.dirty.add(k);
    else if (this.parts.has(id)) this.dirty.add(id);
    this.scene?.wake();
  }

  frame(dt) {
    if (!this.scene) return;
    for (const [id, drawer] of this.parts) {
      const obj = this.scene.get(id);
      if (!obj) continue;
      const last = this.drawn.get(id);
      if (!this.dirty.has(id) && last && last.view === obj.view && last.state === obj.state) continue;
      this.dirty.delete(id);
      this.drawn.set(id, { view: obj.view, state: obj.state });
      drawer.draw(obj.view, obj.state, dt);
    }
  }

  /** hit is the object whose element is under viewport point (x, y): the last drawn on top. */
  hit(x, y) {
    let found = null;
    for (const [id, drawer] of this.parts) {
      const r = drawer.el?.getBoundingClientRect?.();
      if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) found = id;
    }
    return found;
  }

  /** twin is the object's own control; null where the object's markup is the control. */
  twin(id) { return this.parts.get(id)?.twin?.() ?? null; }

  destroy() {
    this.leave?.();
    this.leave = null;
    for (const id of [...this.parts.keys()]) this.unpart(id);
    this.scene = null;
    this.el = null;
  }
}
