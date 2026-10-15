// web/static/lib/scene/scene.js
// A scene holds scene objects, steps each one's model on the shared ticker
// (lib/objects/motion.js), and then lets its renderers draw what the models
// derived. It parks with the ticker: once every model has settled it asks
// for no more frames, and a page's set() on any object wakes it again.
//
// The order inside a frame is the contract: models first, renderers after,
// so every renderer draws the same frame, and a renderer only ever reads.
// While renderers draw, set() throws.

import { ticker as shared, report } from '../objects/motion.js';
import { MODELS } from './models.js';

export class Scene {
  /**
   * ticker: the clock the models are stepped by -- the pages' shared one by
   * default; the bench passes its own, to run slowly. models: kind → a
   * function making that kind's model. onError: where a model or renderer
   * that throws is reported (by default as an uncaught error would be),
   * once per failure; the frame carries on without it.
   */
  constructor({ ticker = shared, models = MODELS, onError = report } = {}) {
    this.clock = ticker;
    this.models = models;
    this.onError = onError;
    this.items = new Map(); // id → {obj, model, off, broken, reported}
    this.renderers = new Set();
    this.failing = new WeakSet(); // renderers whose last frame threw, already reported
    this.off = null;
    this.drawing = false;
  }

  /**
   * add puts `obj` in the scene, with a model for its kind, and derives its
   * first view. All or nothing: if that first step throws, the object is
   * left out and the error is the caller's.
   */
  add(obj) {
    if (this.items.has(obj.id)) throw new Error(`${obj.id} is already in this scene`);
    if (obj.scene && obj.scene !== this) throw new Error(`${obj.id} is already in another scene`);
    const make = this.models[obj.kind];
    if (!make) throw new Error(`no model for a ${obj.kind}: add one to lib/scene/models.js`);
    const item = { obj, model: make(), off: null, broken: null, reported: false };
    // The first view now, at dt 0, so a renderer mounted next has something
    // to draw before the first frame.
    this.stepOne(item, 0, this.now());
    obj.scene = this;
    item.off = obj.on('change', () => this.wake());
    this.items.set(obj.id, item);
    this.wake();
    return obj;
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return false;
    item.off();
    item.obj.scene = null;
    this.items.delete(id);
    this.wake();
    return true;
  }

  get(id) { return this.items.get(id)?.obj ?? null; }

  objects() { return [...this.items.values()].map((it) => it.obj); }

  /** attach is how a renderer's mount() joins the scene; it returns detach. */
  attach(renderer) {
    this.renderers.add(renderer);
    this.wake();
    return () => { this.renderers.delete(renderer); };
  }

  /** start steps this scene on its ticker; it parks itself when everything has settled. */
  start() {
    if (!this.off) this.off = this.clock.add((dt, now) => this.step(dt, now));
  }

  /** stop takes the scene off its ticker for good: call it before throwing the scene away. */
  stop() {
    const off = this.off;
    this.off = null;
    off?.();
  }

  get running() { return this.off !== null; }

  /** wake asks for a frame: a state changed, or a renderer has something new to draw. */
  wake() { if (this.off) this.clock.start(); }

  /** now is the scene's clock: the time a page stamps a poll with. */
  now() { return this.clock.now(); }

  /**
   * step is one frame: every model stepped by `dt` ms at time `now`, then
   * every renderer's frame(dt). It says whether any model still moves. The
   * ticker calls it; a page with a still picture to land can call it by hand.
   */
  step(dt, now = this.now()) {
    let more = false;
    for (const item of this.items.values()) {
      // A model that threw rests until the page gives it something new.
      if (item.broken && item.broken === item.obj.state) continue;
      try {
        if (this.stepOne(item, dt, now)) more = true;
        item.broken = null;
      } catch (e) {
        // Reported once per failure: a retry on new state that throws
        // again is the same failure.
        if (!item.reported) this.onError(e);
        item.broken = item.obj.state;
        item.reported = true;
        continue;
      }
      item.reported = false;
    }
    this.draw(dt);
    return more;
  }

  stepOne(item, dt, now) {
    const more = item.model.step(item.obj.state, dt, now) === true;
    item.obj._view = item.model.view ?? null;
    return more;
  }

  draw(dt) {
    this.drawing = true;
    try {
      for (const r of [...this.renderers]) {
        try {
          r.frame(dt);
          this.failing.delete(r);
        } catch (e) {
          if (!this.failing.has(r)) { this.failing.add(r); this.onError(e); }
        }
      }
    } finally {
      this.drawing = false;
    }
  }
}
