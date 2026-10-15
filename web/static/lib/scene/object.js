// web/static/lib/scene/object.js
// What a drawn thing is, whoever draws it: an id, a kind, the state the page
// gives it, and the view its model last derived from that state.
//
//   the page          the model                the renderer
//   writes state  →   step(dt) on the ticker →  draws the view
//   (targets)         (derives the view)        (reads only)
//
// State is plain data and the page's alone. It holds targets -- a level, a
// position on the tape, a take that's been played this far -- set from what
// the page fetched. Objects don't fetch. The view is what the model made of
// it on the last step: a needle's angle, a reel's turn. A renderer reads
// both and writes neither.

/** changes says whether `patch` would change anything in `state`. */
function changes(state, patch) {
  for (const k of Object.keys(patch)) if (!Object.is(state[k], patch[k])) return true;
  return false;
}

export class SceneObject {
  /**
   * id names it in its scene ('vu:0', 'reels', 'take:41'); kind says which
   * model steps it ('vu', 'reels', 'cassette', 'ribbon').
   */
  constructor(id, kind, state = {}) {
    if (!id || typeof id !== 'string') throw new TypeError('a scene object needs a string id');
    if (!kind || typeof kind !== 'string') throw new TypeError(`scene object ${id} needs a kind`);
    this.id = id;
    this.kind = kind;
    this._state = Object.freeze({ ...state });
    // Set by the scene that holds it: the view its model derived, and the
    // scene, which says when a renderer is drawing.
    this._view = null;
    this.scene = null;
    this.handlers = new Map();
  }

  /** state is a frozen snapshot: a new object each time something changes. */
  get state() { return this._state; }

  /**
   * set is the page's only way in. It merges `patch` into the state and
   * emits 'change' with {patch, state} -- unless nothing actually changed,
   * which is most polls of a still tape and costs nothing. A renderer may
   * never call it: the scene makes that an error.
   */
  set(patch) {
    if (this.scene?.drawing) {
      throw new Error(`a renderer tried to set ${this.id}: renderers read state, the page writes it`);
    }
    if (!patch || !changes(this._state, patch)) return false;
    this._state = Object.freeze({ ...this._state, ...patch });
    this.emit('change', { patch, state: this._state });
    return true;
  }

  /** view is what the model derived on the last step; null before it has anything to show. */
  get view() { return this._view; }

  /**
   * on listens for 'change' (from set) and, from renderers, 'pick', 'drop',
   * 'hover', 'plug' and 'unplug'. Returns a function that stops listening.
   */
  on(event, fn) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(event, detail) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(detail, this);
  }
}
