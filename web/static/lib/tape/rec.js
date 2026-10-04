// web/static/lib/tape/rec.js
// A punch in progress on the tape page: where on the tape it started, and a
// trace of the source's level as it records, so the lane shows something is
// coming in before the punch ends and becomes a clip. The trace is built from
// the meter the page already polls; nothing new is asked of the Pi.
// Node-tested.

// barStart and nextBar round as the Pi's Grid does: bar n starts at
// round(n × bar), and a bar line belongs to the bar it starts.
function barStart(grid, n) { return Math.round(n * (grid.frames / grid.bars)); }
function nextBar(grid, pos) {
  let n = Math.floor(pos / (grid.frames / grid.bars));
  while (barStart(grid, n + 1) <= pos) n++;
  while (barStart(grid, n) > pos) n--;
  if (barStart(grid, n) < pos) n++;
  return barStart(grid, n);
}

/**
 * punchStart is the tape frame a punch records from: the first bar line the
 * tape plays at or after it was asked for. obs is what the page saw on the
 * first poll after: counting (a count-in, with the tape standing at pos), or
 * else heard and delivered (the device's tape frame and output frame now)
 * and from (the punch's output frame). A tape that has since wrapped the
 * loop is followed back round it.
 */
export function punchStart(grid, loop, obs) {
  let p = obs.counting ? obs.pos : obs.heard - (obs.delivered - obs.from);
  const looping = loop && loop.on && loop.out > loop.in;
  if (looping && p < loop.in && obs.heard >= loop.in) {
    const len = loop.out - loop.in;
    p = loop.out - ((loop.in - p) % len);
  }
  const s = nextBar(grid, Math.max(0, p));
  return looping && p < loop.out && s >= loop.out ? loop.in : s;
}

/**
 * traceAdd adds a poll's level at the heard tape frame to a punch's trace
 * (null for a new one): {passes, samples: [{pos, db}]}. A frame before the
 * last is the loop coming round, and starts the next pass's trace.
 */
export function traceAdd(trace, pos, db) {
  if (typeof db !== 'number') return trace;
  const s = { pos, db };
  if (!trace) return { passes: 0, samples: [s] };
  const last = trace.samples[trace.samples.length - 1];
  if (last && pos < last.pos) return { passes: trace.passes + 1, samples: [s] };
  return { passes: trace.passes, samples: [...trace.samples, s] };
}

/**
 * wrappedSince says whether the loop has come round since a punch was asked
 * for: more output has played since then than tape since In. Only for a
 * poll after any count-in, when the tape has played all along.
 */
export function wrappedSince(loop, obs) {
  if (!loop || !loop.on || !(loop.out > loop.in)) return false;
  return obs.delivered - obs.from > obs.heard - loop.in;
}

/**
 * fullPasses is how many whole passes of the loop a punch asked for at
 * output frame from has covered, from the passes the Pi logged: what Rec
 * would keep the last of.
 */
export function fullPasses(cycles, from) {
  return (cycles || []).filter((c) => c.out >= from).length;
}

/**
 * recRegion is the span of the lane a punch has covered on this pass: from
 * its start (or, once the loop has wrapped, from In) to the playhead; null
 * while the tape hasn't reached the punch yet.
 */
export function recRegion(wrapped, start, loop, heard) {
  const from = wrapped && loop && loop.on ? loop.in : start;
  return heard >= from ? { from, to: heard } : null;
}
