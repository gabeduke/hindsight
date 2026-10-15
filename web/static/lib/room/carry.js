// web/static/lib/room/carry.js
// The conductor of the move off the shelf and into the deck, and back
// (docs/superpowers/specs/2026-10-15-r2-shelf-to-deck-design.md).
//
// The models draw the move: a `flight` for the thing in the air, the `deck`
// for its door and reels (lib/scene). This decides what happens when, and
// it does so on a clock, never on a frame:
//
//   - at the press, a timer for SEAT: the sound (the page's onSeat), a
//     10 ms buzz, and the deck, which shuts its door and settles the face
//     in while the thing in the air, now at its window, is put down. A
//     dropped frame, a parked ticker or a hidden tab can't hold the sound
//     back;
//   - one thing in flight: whatever else is moving lands at once -- going
//     into the deck, its sound starts then -- before the next move starts;
//   - reduced motion (the ticker's, never the media query): nothing flies.
//     The sound starts at once and the change is handed to `fade`, the
//     page's 150 ms cross-fade.
//
// It holds no DOM. `attach(c)` is the page's: it draws a flight (a drawer
// on the scene's renderer) and answers how to stop drawing it.

import { SceneObject } from '../scene/object.js';
import { SEAT_AT, SEATED, EJECT_MS, BACK_RATE } from '../scene/choreo.js';
import { report } from '../objects/motion.js';

/** SEAT's buzz on a phone, ms. */
export const BUZZ_MS = 10;

const TIMERS = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h),
};

/** call runs one of the page's callbacks; one that throws is heard, and the move goes on. */
function call(fn, ...args) {
  if (!fn) return;
  try { fn(...args); } catch (e) { report(e); }
}

export class Carry {
  /**
   * scene: the doorway's scene, whose ticker says whether motion is
   * reduced. deck: its deck object. attach(c): draws flight `c`, answering
   * a function that stops. fade(update): the page's cross-fade for reduced
   * motion. vibrate(ms): a buzz. onSettle(): after anything lands, for the
   * page to draw its shelves again. timers: {set, clear}, for tests.
   */
  constructor({ scene, deck, attach = () => null, fade = (update) => update(), vibrate = () => {}, onSettle = null, timers = TIMERS }) {
    this.scene = scene;
    this.onSettle = onSettle;
    this.deck = deck;
    this.attach = attach;
    this.fade = fade;
    this.vibrate = vibrate;
    this.timers = timers;
    /** The one thing away from its shelf and not in the deck: {key, goal, obj, …}, or null. */
    this.current = null;
  }

  get reduced() { return !!this.scene.clock?.reduced; }

  /** key of what's in flight or held out, if it's `key`. */
  holds(key) { return this.current?.key === key; }

  playhead(c) { return c.obj.view ? c.obj.view.t : (c.obj.state.t0 ?? 0); }

  begin(key, state) {
    const obj = new SceneObject(`flight:${key}`, 'flight', state);
    const c = { key, goal: state.goal, obj, face: state.face ?? null, seated: false, landed: false, timers: [], detach: null };
    this.scene.add(obj);
    this.current = c;
    try { c.detach = this.attach(c) || null; } catch (e) { report(e); }
    return c;
  }

  after(c, ms, fn) {
    const h = this.timers.set(() => {
      c.timers = c.timers.filter((x) => x !== h);
      fn();
    }, Math.max(0, ms));
    c.timers.push(h);
  }

  clear(c) {
    for (const h of c.timers) this.timers.clear(h);
    c.timers = [];
  }

  /**
   * pick takes `key` off its shelf: PICK and PULL, then held out while its
   * card is open. `from` is its slot; `turn`, whether it stands spine out.
   */
  pick(key, { from, turn = true, face = null } = {}) {
    if (this.current && this.current.key !== key) this.finish();
    const c = this.current;
    if (!c) return this.begin(key, { goal: 'out', from, to: null, turn, face, t0: 0 });
    // Picked again on its way back in: it turns round.
    this.clear(c);
    c.goal = 'out';
    c.obj.set({ goal: 'out', ...(from ? { from } : {}) });
    return c;
  }

  /** putBack puts a picked thing back in its slot: its card closed without PUT IT ON. */
  putBack(key) {
    const c = this.current;
    if (!c || c.key !== key || c.goal !== 'out') return false;
    this.clear(c);
    c.goal = 'shelf';
    c.obj.set({ goal: 'shelf' });
    if (this.reduced) this.fade(() => this.land(c));
    else this.after(c, this.playhead(c) / BACK_RATE, () => this.land(c));
    return true;
  }

  /**
   * put sends `key` into the deck: from where it is (held out, or its slot)
   * through TURN, FLY and SEAT. `to` is the deck's window; `face`, what the
   * deck shows once it's in. onSeat() is the sound, at SEAT; onLand(), once
   * it's in the deck and the flight is over.
   */
  put(key, { from, to, turn = true, vanish = false, face = null, onSeat, onLand } = {}) {
    if (this.current && this.current.key !== key) this.finish();
    let c = this.current;
    // No flight with reduced motion, or with nowhere to fly from or to (the
    // deck hidden behind a month's box, a take not on this month's shelf):
    // the sound now, and the change as one cross-fade.
    if (this.reduced || !to || (!c && !from)) {
      const held = c;
      call(onSeat);
      this.fade(() => {
        this.deck.set({ door: 'shut', loaded: face });
        if (held) { held.goal = 'deck'; held.face = face; held.seated = true; this.land(held); }
        call(onLand);
        if (!held) call(this.onSettle);
      });
      return held;
    }
    if (!c) c = this.begin(key, { goal: 'deck', from, to, turn, vanish, face, t0: 0 });
    else {
      this.clear(c);
      c.obj.set({ goal: 'deck', to, vanish, face, ...(from ? { from } : {}) });
    }
    Object.assign(c, { goal: 'deck', face, onSeat, onLand });
    this.deck.set({ door: 'open' });
    // At SEAT the flight is at the window, and the deck takes over: the
    // sound, the door, and the face settling in are the deck's.
    this.after(c, SEAT_AT - this.playhead(c), () => this.land(c));
    return c;
  }

  /**
   * eject takes `key` out of the deck and back to its slot: the sound stops
   * at the press (onStop), the door opens, and the flight runs backwards in
   * EJECT_MS. `under` is what the deck shows once it's out (a tape still
   * loaded), or null for an empty deck.
   */
  eject(key, { from, to, turn = true, vanish = false, face = null, under = null, onStop, onLand } = {}) {
    if (this.current) this.finish();
    call(onStop);
    const after = { door: under ? 'shut' : 'open', loaded: under };
    if (this.reduced || !from || !to) {
      this.fade(() => { this.deck.set(after); call(onLand); call(this.onSettle); });
      return null;
    }
    const c = this.begin(key, { goal: 'shelf', from, to, turn, vanish, face, t0: SEATED });
    Object.assign(c, { goal: 'shelf', after, onLand });
    this.deck.set({ door: 'open', loaded: under });
    this.after(c, EJECT_MS, () => this.land(c));
    return c;
  }

  /**
   * arrive flies `key` home from somewhere the page remembers -- the
   * chair's deck, before the page changed -- with the deck left alone.
   */
  arrive(key, { from, to, turn = true, vanish = false, face = null, onLand } = {}) {
    if (this.current) this.finish();
    if (this.reduced || !from || !to) { call(onLand); call(this.onSettle); return null; }
    const c = this.begin(key, { goal: 'shelf', from, to, turn, vanish, face, t0: SEATED });
    Object.assign(c, { goal: 'shelf', onLand });
    this.after(c, EJECT_MS, () => this.land(c));
    return c;
  }

  /** finish lands whatever is in flight at once; held out, it goes back in. */
  finish() {
    const c = this.current;
    if (!c) return;
    if (c.goal === 'out') {
      c.goal = 'shelf';
      c.obj.set({ goal: 'shelf' });
    }
    this.land(c);
  }

  seat(c) {
    if (c.seated) return;
    c.seated = true;
    // The sound first: the picture follows it.
    call(c.onSeat);
    if (!this.reduced) call(this.vibrate, BUZZ_MS);
    this.deck.set({ door: 'shut', loaded: c.face });
  }

  land(c) {
    if (c.landed) return;
    if (c.goal === 'deck' && !c.seated) this.seat(c);
    c.landed = true;
    this.clear(c);
    if (c.after) this.deck.set(c.after);
    this.scene.remove(c.obj.id);
    call(c.detach);
    if (this.current === c) this.current = null;
    call(c.onLand);
    call(this.onSettle);
  }
}

// --- across pages ---------------------------------------------------------------
// The chair's ⏏ sends what's on its deck back to the shelf, but the shelf is
// on another page, drawn after that page's first frame -- so no View
// Transition can carry it there. The chair remembers where its deck was; the
// doorway, once its shelves are drawn, flies it home from there (a FLIP: the
// first rect remembered, the last measured, the move between played by the
// flight model).

export const EJECT_KEY = 'hindsight.room.eject';
/** How long a remembered eject is worth flying: a page that takes longer to come has lost the thread. */
export const EJECT_FRESH_MS = 4000;

const session = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

/** remember notes that `key` left the chair's deck from `rect` (viewport px). */
export function remember(key, rect, { store = session(), now = Date.now() } = {}) {
  if (!store || !rect) return;
  const r = { x: rect.x ?? rect.left, y: rect.y ?? rect.top, w: rect.w ?? rect.width, h: rect.h ?? rect.height };
  try { store.setItem(EJECT_KEY, JSON.stringify({ key, rect: r, at: now })); } catch { /* private mode: it just appears */ }
}

/** recall answers what the chair sent home -- {key, rect} -- once, if it's fresh. */
export function recall({ store = session(), now = Date.now() } = {}) {
  if (!store) return null;
  let v = null;
  try {
    v = JSON.parse(store.getItem(EJECT_KEY) || 'null');
    store.removeItem(EJECT_KEY);
  } catch { return null; }
  if (!v || typeof v.key !== 'string' || !v.rect || !(now - v.at >= 0 && now - v.at < EJECT_FRESH_MS)) return null;
  const { x, y, w, h } = v.rect;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { key: v.key, rect: { x, y, w, h } };
}
