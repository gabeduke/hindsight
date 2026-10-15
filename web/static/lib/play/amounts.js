// web/static/lib/play/amounts.js
// The amounts this page knows (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md):
// each punch-in FX's, the bend's, and the tape mods' as they're dragged.
// What each is at, from this hand or any other, and this hand's moves on
// their way to the Pi -- no more than 30 a second each, and the last one
// always sent, so a knob let go lands where the hand left it.
//
// The Pi echoes every move to every page (an `at` with `move`), this one's
// included. A hand dragging a knob outranks that echo for a moment, or the
// knob would twitch back toward where it was a round trip ago.
//
// Like the other adapters it knows nothing of the DOM or the socket: `send`
// is handed in, and so are the clock and the timers, for the tests.

/** EVERY_MS is the least time between two sends of one amount: 30 a second. */
export const EVERY_MS = 1000 / 30;

/** HOLD_MS is how long this hand's own move outranks what the Pi says. */
export const HOLD_MS = 400;

/**
 * DEFAULTS are where an amount starts before anything moved it: the middle
 * for the FX (a key on a computer keyboard has no velocity), the centre for
 * the bend, nothing for a tape mod.
 */
export const DEFAULTS = { roll: 0.5, filter: 0.5, echo: 0.5, crush: 0.5, bend: 0 };

/** clampFor keeps an amount in its range: -1 to 1 for the bend, 0 to 1 else. */
export function clampFor(id, v) {
  if (!Number.isFinite(v)) return null;
  return Math.max(id === 'bend' ? -1 : 0, Math.min(1, v));
}

export class Amounts {
  constructor({
    send = () => {}, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  } = {}) {
    this.send = send;
    this.now = now;
    // Called bare, never as this object's methods: a browser's setTimeout
    // throws "Illegal invocation" with any `this` but the window.
    this.later = (fn, ms) => setTimer(fn, ms);
    this.cancel = (t) => clearTimer(t);
    this.values = new Map();
    this.mine = new Map();    // id → when this hand last moved it
    this.sent = new Map();    // id → when it was last sent
    this.waiting = new Map(); // id → the timer that sends its last move
    this.fns = new Set();
  }

  /** get is where id is: as last moved or heard, or its default. */
  get(id) {
    return this.values.has(id) ? this.values.get(id) : (DEFAULTS[id] ?? 0);
  }

  /** on hears every change: fn(id, v, fromHere). It returns the unhook. */
  on(fn) {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  emit(id, v, here) {
    for (const fn of this.fns) {
      try { fn(id, v, here); } catch { /* a drawing bug must not stop the sound */ }
    }
  }

  /**
   * move is this hand moving id to v: drawn at once, sent now if the last
   * send was long enough ago, else once it is -- with whatever it's at by
   * then.
   */
  move(id, v) {
    const x = clampFor(id, v);
    if (x == null) return;
    const t = this.now();
    this.values.set(id, x);
    this.mine.set(id, t);
    this.emit(id, x, true);
    if (this.waiting.has(id)) return; // the waiting send takes the newest
    const last = this.sent.get(id) ?? -Infinity;
    if (t - last >= EVERY_MS) {
      this.sent.set(id, t);
      this.send(id, x);
      return;
    }
    this.waiting.set(id, this.later(() => {
      this.waiting.delete(id);
      this.sent.set(id, this.now());
      this.send(id, this.get(id));
    }, last + EVERY_MS - t));
  }

  /**
   * note sets id without sending it: a velocity at the press (which the
   * press carries), or the tape's own value of a mod.
   */
  note(id, v) {
    const x = clampFor(id, v);
    if (x == null || this.values.get(id) === x) return;
    this.values.set(id, x);
    this.emit(id, x, false);
  }

  /**
   * heard is the Pi saying id is at v -- another hand's move, or this
   * one's echo. A move of this hand's in the last moment outranks it.
   */
  heard(id, v) {
    const m = this.mine.get(id);
    if (m != null && this.now() - m < HOLD_MS) return;
    this.note(id, v);
  }

  /** busy says this hand moved id a moment ago: the Pi's word waits. */
  busy(id) {
    const m = this.mine.get(id);
    return m != null && this.now() - m < HOLD_MS;
  }

  close() {
    for (const t of this.waiting.values()) this.cancel(t);
    this.waiting.clear();
  }
}
