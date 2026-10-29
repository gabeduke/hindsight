// web/static/lib/play/piclock.js
// The Pi's clock, as this page knows it: what a touch's time is on the Pi.
//
// Latency is measured in use (docs/plan/the-instrument.md, step 1): every
// press, set and release carries the moment it was touched and the moment
// it was sent, on the Pi's clock, so the Pi can time it to the ear
// (internal/tape/latency.go). The page learns the Pi's clock from the Play
// socket's round trips (link.js): it sends its own time, the Pi answers
// with the moment it read it and the moment it answered, and the offset is
// taken from the trip that came back quickest, whose two legs are nearest
// even. A few dozen seconds of trips are kept, so the two clocks' drift
// never builds up in it.
//
// There is one on a page (piClock): the stream (tape/stream-player.js) says
// on it when this phone hears a frame.

export class PiClock {
  constructor({ keep = 16 } = {}) {
    this.keep = keep;
    this.trips = [];
  }

  /**
   * take is one round trip: the page sent `c`, the Pi read it at `pi_in` and
   * answered at `pi_out`, and the answer was back at `back` (all ms; c and
   * back on the page's clock, the others on the Pi's).
   */
  take({ c, pi_in: piIn, pi_out: piOut }, back) {
    if (![c, piIn, piOut, back].every(Number.isFinite) || back < c || piOut < piIn) return;
    const rtt = (back - c) - (piOut - piIn);
    const offset = ((piIn - c) + (piOut - back)) / 2;
    this.trips.push({ rtt, offset });
    if (this.trips.length > this.keep) this.trips.shift();
  }

  /** best is the quickest trip kept, or null. */
  best() {
    let b = null;
    for (const t of this.trips) if (!b || t.rtt < b.rtt) b = t;
    return b;
  }

  get ready() { return this.trips.length > 0; }

  /** rttMs is the quickest round trip kept, or undefined. */
  get rttMs() { return this.best()?.rtt; }

  /** toPi is page time `t` (ms) on the Pi's clock, or undefined until a trip is back. */
  toPi(t) {
    const b = this.best();
    if (!b || !Number.isFinite(t)) return undefined;
    return Math.round((t + b.offset) * 10) / 10;
  }

  /** reset forgets the trips: a new socket may be a Pi started again, on a new clock. */
  reset() { this.trips = []; }
}

/** The page's one. */
export const piClock = new PiClock();
