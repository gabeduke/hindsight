// Overdubbing away from the rig: the arithmetic. The tape plays on this
// device (the Pi renders it: GET /api/tapes/listen) while the phone
// recorder records over it; this works out which part of that recording to
// keep, and where it goes on the tape. It also reads a calibration: clicks
// played through the speaker and heard back through the mic.
//
// Everything is on the audio context's clock. A frame of the tape that
// leaves the context at time t is heard a moment later; what you play along
// with it reaches the mic and comes back into the context later again. The
// sum of those two is the round trip, rt: what you played in time with the
// tape's frame t is in the recording at t + rt.

/** barStart is where bar n begins on a grid, as the Pi rounds it. */
export function barStart(grid, n) {
  return Math.round((n * grid.frames) / grid.bars);
}

/**
 * keptSpan is what to keep of a recording made over the tape, or null if
 * not a bar of it was played over the tape.
 *
 * - t0: the context time the listen file's first frame played.
 * - rt: the round trip, in seconds.
 * - recStart: the context time of the recording's first frame.
 * - seconds: how long the recording is.
 * - listen: { from, frames, loop }, in tape frames, as the Pi sent it.
 * - grid: the tape's { frames, bars }, or null.
 *
 * Over the loop it keeps the last full pass, as a punch does; or else the
 * bars from the first bar line to the last, up to a loop's length, wrapped
 * at the loop's end as they were played. Over the whole tape it keeps the
 * bars played (or all of it, with no grid). The answer is take frames
 * [from, to), the tape frame at they go to, and whether they wrap.
 */
export function keptSpan({ t0, rt, recStart, seconds, listen, grid, sr = 48000 }) {
  const off = (recStart - rt - t0) * sr; // tape frames played, since listen.from, at the take's frame 0
  const total = Math.floor(seconds * sr);
  const u0 = Math.max(off, 0); // nothing from before the tape began
  const u1 = off + total;
  if (!(u1 > u0)) return null;
  const span = (uA, uB, at, wrap) => {
    if (!(uB - uA >= 1)) return null;
    const from = Math.round(uA - off);
    return { from, to: from + (uB - uA), at, wrap };
  };
  if (listen.loop) {
    const L = listen.frames;
    const k = Math.floor((u1 - L) / L);
    if (k >= 0 && k * L >= u0) return span(k * L, k * L + L, listen.from, true);
    // The bar lines inside the loop, from its start.
    const lines = [];
    if (grid) {
      for (let n = Math.ceil((listen.from * grid.bars) / grid.frames) - 1; ; n++) {
        const b = barStart(grid, n) - listen.from;
        if (b > L) break;
        if (b >= 0) lines.push(b);
      }
    } else {
      lines.push(0, L);
    }
    let uA = Infinity;
    let uB = -Infinity;
    for (let p = Math.floor(u0 / L); p <= Math.floor(u1 / L); p++) {
      for (const b of lines) {
        const u = p * L + b;
        if (u >= u0 && u < uA) uA = u;
        if (u <= u1 && u > uB) uB = u;
      }
    }
    if (!(uB > uA)) return null;
    if (uB - uA > L) uA = uB - L;
    return span(uA, uB, listen.from + (((uA % L) + L) % L), true);
  }
  const a = Math.max(u0, 0);
  const b = Math.min(u1, listen.frames);
  if (!(b > a)) return null;
  let uA = Math.ceil(a);
  let uB = Math.floor(b);
  if (grid) {
    const nA = Math.ceil(((listen.from + a) * grid.bars) / grid.frames) - 1;
    uA = Infinity;
    uB = -Infinity;
    for (let n = Math.max(0, nA); ; n++) {
      const u = barStart(grid, n) - listen.from;
      if (u > b) break;
      if (u >= a && u < uA) uA = u;
      if (u <= b) uB = u;
    }
    if (!(uB > uA)) return null;
  }
  return span(uA, uB, listen.from + uA, false);
}

/**
 * onsets finds where clicks begin in a mono recording: the first sample of
 * each burst above a third of the loudest, at least gapSeconds apart. In
 * seconds from the recording's start.
 */
export function onsets(x, rate, { gapSeconds = 0.25 } = {}) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (!(peak > 0.01)) return [];
  const th = peak / 3;
  const out = [];
  let quietUntil = -1;
  for (let i = 0; i < x.length; i++) {
    if (i < quietUntil) continue;
    if (Math.abs(x[i]) >= th) {
      out.push(i / rate);
      quietUntil = i + Math.round(gapSeconds * rate);
    }
  }
  return out;
}

/**
 * roundTrip reads a calibration: for each click played at a scheduled time,
 * the first onset heard after it, within maxSeconds. The answer is the mean
 * delay of those within 5 ms of the median, if that's at least four in five
 * of the clicks played; or null. Asking that much keeps a noise that comes
 * and goes on its own -- a beep every second against clicks every half --
 * from passing for the clicks.
 */
export function roundTrip(scheduled, heard, { maxSeconds = 0.45 } = {}) {
  const d = [];
  for (const s of scheduled) {
    const h = heard.find((t) => t >= s && t - s <= maxSeconds);
    if (h !== undefined) d.push(h - s);
  }
  const need = Math.max(2, Math.ceil(scheduled.length * 0.8));
  if (d.length < need) return null;
  d.sort((a, b) => a - b);
  const median = d[Math.floor(d.length / 2)];
  const close = d.filter((v) => Math.abs(v - median) <= 0.005);
  if (close.length < need) return null;
  return close.reduce((a, b) => a + b, 0) / close.length;
}

/**
 * guessRoundTrip is the round trip from what the browser says, when it
 * says: its output latency (or base latency) and the mic's input latency.
 * A phone's own figures are often low; a calibration is better.
 */
export function guessRoundTrip(ctx, settings = {}) {
  const out = (typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0) ? ctx.outputLatency : (ctx.baseLatency || 0);
  const inp = typeof settings.latency === 'number' ? settings.latency : 0.01;
  return out + inp;
}
