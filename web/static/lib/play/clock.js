// web/static/lib/play/clock.js
// Where the tape is, in the surface's time.
//
// The surface quantises in performance.now() milliseconds; the tape counts
// frames on the Pi. Each of the page's polls says which frame is being heard
// and when the answer arrived, which is enough to put the two on one line:
// the tape's frame 0 passed (or would have, playing straight through) at
//
//   at - heard / rate
//
// and the tape's grid starts at frame 0, in 4/4, so that instant is a bar
// line the pads can land on.
//
// What this cannot see is the network's half of the round trip, nor the
// device's output latency, and both put the real downbeat a little after the
// line drawn here. Closing that gap is part of making the pads audible.
//
// Pure: no DOM, no clock of its own, so it is tested as arithmetic.

/**
 * JITTER_MS is how far apart two polls may place the bar line and still be
 * read as the same line. A poll's answer is late by however long the network
 * took, which moves from poll to poll; moving the grid with it would shift a
 * pad that is already armed under the player's finger.
 */
export const JITTER_MS = 25;

const mod = (a, n) => ((a % n) + n) % n;

/** origin is when the tape's frame 0 passed, in performance.now() ms. */
export function origin({ heard, rate, at }) {
  return at - (heard / rate) * 1000;
}

/**
 * gridFrom is the grid the surface should take from one tape state, or null
 * to keep the one it has. `prev` is the grid already in use.
 *
 * A stopped tape gives no reading: its heard frame stands still while the
 * clock runs on, so the line it implies drifts away from every bar. The grid
 * keeps the last one a playing tape gave.
 */
export function gridFrom(s, prev) {
  if (!s || !s.playing || !(s.bpm > 0) || !(s.rate > 0) || !Number.isFinite(s.heard) || !Number.isFinite(s.at)) return null;
  const originMs = origin(s);
  if (prev && prev.bpm === s.bpm && Number.isFinite(prev.originMs)) {
    // Compared on the bar, not in absolute time: a loop that wrapped puts
    // the line a whole number of bars from the last one, and that is the
    // same grid.
    const bar = (60000 / s.bpm) * 4;
    const drift = mod(originMs - prev.originMs + bar / 2, bar) - bar / 2;
    if (Math.abs(drift) < JITTER_MS) return null;
  }
  return { bpm: s.bpm, originMs };
}

/**
 * ringAt is what the ring shows at `now`: `frac` of the way round the loop,
 * the bar the playhead is in (counted from the tape's bar 1, as the LCD
 * counts), and how many bars the ring is divided into.
 *
 * Between polls a playing tape is carried forward at its rate, so the sweep
 * moves every frame rather than in five steps a second. With no loop drawn,
 * the ring is the whole grid.
 */
export function ringAt(s, now) {
  const none = { frac: 0, bar: null, bars: null };
  if (!s || !(s.rate > 0) || !Number.isFinite(s.heard)) return none;
  const barFrames = s.bar_frames > 0 ? s.bar_frames : 0;
  const loop = s.loop && s.loop.out > s.loop.in ? s.loop : null;
  let pos = s.heard + (s.playing && Number.isFinite(s.at) ? Math.max(0, (now - s.at) / 1000) * s.rate : 0);
  if (loop && loop.on && s.playing && pos >= loop.out) pos = loop.in + mod(pos - loop.in, loop.out - loop.in);
  const span = loop || (barFrames && s.bars > 0 ? { in: 0, out: barFrames * s.bars } : null);
  if (!span) return { ...none, bar: barFrames ? Math.floor(pos / barFrames + 1e-9) + 1 : null };
  return {
    frac: Math.max(0, Math.min(1, (pos - span.in) / (span.out - span.in))),
    bar: barFrames ? Math.floor(pos / barFrames + 1e-9) + 1 : null,
    bars: barFrames ? Math.round((span.out - span.in) / barFrames) : null,
  };
}
