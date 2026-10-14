// web/static/lib/play/surface.js
// The performance surface: one place where a press becomes a musical event,
// whatever did the pressing.
//
//   touch  ─┐
//   keys   ─┼─→  Surface.press/release  ─→  fire/end, on the grid
//   MIDI   ─┘
//
// Three adapters, one set of rules. That is the whole point of this file: the
// SMK-37 arriving later should be a hundred lines that call press() and
// release(), not a second interaction model. Nothing here touches the DOM or
// the network, so it can be tested as maths against a fake clock.
//
// ## Why quantise at all
//
// The phone is on Wi-Fi and the tape is on a Pi. A press lands when it lands.
// Quantising to the next sixteenth turns that latency from a bug into the
// thing that makes a late hand sound right -- the same trade the OP-1 makes
// with its trick pads, and the reason they feel playable rather than fiddly.
//
// A pad therefore has two moments, and the UI should show both: it is *armed*
// the instant you touch it, and it *fires* on the next grid line. Seeing the
// gap is what lets someone play ahead of the beat on purpose.

/** What a pad is doing. */
export const IDLE = 'idle';
export const ARMED = 'armed';     // pressed, waiting for its grid line
export const ON = 'on';           // firing, held
export const RELEASING = 'releasing'; // let go, waiting for its grid line

/** Grid divisions, as a fraction of a beat. `off` fires with no delay. */
export const DIVISIONS = {
  off: 0,
  '16th': 1 / 4,
  '8th': 1 / 2,
  beat: 1,
  bar: 4,
};

/**
 * Surface holds the pads and the grid. It emits four events:
 *
 *   arm   {pad, at, fireAt}  -- touched; the UI should show it pending
 *   fire  {pad, at}          -- the gesture starts now, on the grid
 *   end   {pad, at}          -- the gesture stops now, on the grid
 *   idle  {pad, at}          -- back to rest; the UI can clear it
 *
 * `fire` and `end` are the musical ones; `arm` and `idle` are for drawing.
 */
export class Surface {
  /**
   * bpm and originMs describe the grid: originMs is a time when a bar line
   * passed, which the tape gives us, so the pads land on the tape's own bars
   * rather than on a grid of their own invention.
   */
  constructor({ bpm = 120, originMs = 0, division = '16th' } = {}) {
    this.bpm = bpm;
    this.originMs = originMs;
    this.division = division;
    this.pads = new Map();
    this.handlers = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name).delete(fn);
  }

  emit(name, detail) {
    for (const fn of this.handlers.get(name) || []) {
      // One listener throwing must not cost the others their event, or a
      // drawing bug would take the sound with it.
      try { fn(detail); } catch { /* keep going */ }
    }
  }

  setGrid({ bpm, originMs, division }) {
    if (bpm != null) this.bpm = bpm;
    if (originMs != null) this.originMs = originMs;
    if (division != null) this.division = division;
  }

  /** gridMs is one grid unit in ms, or 0 when quantise is off. */
  gridMs() {
    const beats = DIVISIONS[this.division] ?? 0;
    if (!beats || !(this.bpm > 0)) return 0;
    return (60000 / this.bpm) * beats;
  }

  /**
   * nextGrid is the first grid line at or after `at`. With quantise off it is
   * `at` itself.
   *
   * Strictly at-or-after, not after: a press that lands exactly on the line
   * should fire on that line, not wait a whole sixteenth for the next one.
   */
  nextGrid(at) {
    const g = this.gridMs();
    if (!g) return at;
    const n = Math.ceil((at - this.originMs) / g - 1e-9);
    return this.originMs + n * g;
  }

  state(pad) { return this.pads.get(pad)?.state ?? IDLE; }

  /** A pad being pressed. Idempotent: holding a key that repeats is one press. */
  press(pad, at) {
    const cur = this.pads.get(pad);
    if (cur && cur.state !== IDLE) return;
    const fireAt = this.nextGrid(at);
    this.pads.set(pad, { state: ARMED, fireAt, endAt: null });
    this.emit('arm', { pad, at, fireAt });
    // With quantise off there is nothing to wait for, so it starts here and
    // the caller gets `fire` without having to tick first.
    if (fireAt <= at) this.start(pad, at);
  }

  /**
   * A pad being let go. The gesture ends on the next grid line, so a break
   * comes back in time as well as leaving in time.
   *
   * A tap shorter than one grid unit still gets a full one. Releasing on the
   * same line it fired on would be a gesture of zero length -- silence where
   * the player heard themselves hit something -- so the end is pushed to the
   * following line. That is what makes a quick stab usable rather than a
   * thing you have to hold carefully.
   */
  release(pad, at) {
    const p = this.pads.get(pad);
    if (!p || p.state === RELEASING || p.state === IDLE) return;
    const g = this.gridMs();
    let endAt = this.nextGrid(at);
    const startedAt = p.state === ON ? p.firedAt : p.fireAt;
    if (g && endAt <= startedAt) endAt = startedAt + g;
    p.endAt = endAt;
    p.state = RELEASING;
    if (p.firedAt == null) {
      // Let go before it ever fired. It still fires: the press was real and
      // the player is already committed to hearing it.
      p.pendingFire = true;
    }
    if (endAt <= at && p.firedAt != null) this.stop(pad, at);
  }

  /** tick advances the pads to `now`. Call it once a frame. */
  tick(now) {
    for (const [pad, p] of [...this.pads]) {
      if ((p.state === ARMED || (p.state === RELEASING && p.pendingFire)) && now >= p.fireAt) {
        this.start(pad, p.fireAt);
        p.pendingFire = false;
      }
      if (p.state === RELEASING && p.firedAt != null && now >= p.endAt) {
        this.stop(pad, p.endAt);
      }
    }
  }

  start(pad, at) {
    const p = this.pads.get(pad);
    if (!p || p.firedAt != null) return;
    p.firedAt = at;
    if (p.state === ARMED) p.state = ON;
    this.emit('fire', { pad, at });
  }

  stop(pad, at) {
    const p = this.pads.get(pad);
    if (!p || p.firedAt == null) return;
    this.pads.delete(pad);
    this.emit('end', { pad, at });
    this.emit('idle', { pad, at });
  }

  /** held lists the pads currently sounding. */
  held() {
    return [...this.pads].filter(([, p]) => p.firedAt != null && p.state !== IDLE).map(([pad]) => pad);
  }

  /** releaseAll ends everything, for leaving Play mode or losing focus. */
  releaseAll(at) {
    for (const [pad, p] of [...this.pads]) {
      if (p.firedAt != null) this.stop(pad, at);
      else { this.pads.delete(pad); this.emit('idle', { pad, at }); }
    }
  }
}
