// web/static/lib/wave/send.js
// Send to tape, in words: what it will do with this take before the tap, and
// what it did after. Where it lands is the Pi's to decide (internal/tape/
// send.go); this only says it, so the hint below can be a little behind the
// server and never wrong about a take that has a tempo.

// A first loop can be no longer than this: past it, a send with no tempo is
// laid down linear. Mirrors firstLoopMaxSeconds in internal/tape/send.go.
export const FIRST_LOOP_MAX_S = 60;

/** fmtBpm is a tempo as it reads on the take page: 120, 125.25. */
export function fmtBpm(bpm) {
  return String(Math.round(bpm * 100) / 100);
}

const hasTempo = (bpm) => Number.isFinite(bpm) && bpm >= 20 && bpm <= 400;

/**
 * sendHint is what a tap on Send to tape will do, in one short line.
 * bpm is the take's tempo (null for none); region is the selection or null;
 * total is the take's frames; sr its sample rate.
 */
export function sendHint({ bpm, region, total, sr }) {
  const what = region ? 'the selection' : 'the whole take';
  const frames = region ? region.end - region.start : total;
  if (hasTempo(bpm)) {
    return `Sends ${what} at ${fmtBpm(bpm)} BPM, bar 1 on a tape bar line`;
  }
  if (frames > FIRST_LOOP_MAX_S * sr) {
    return `Sends ${what} at the tape's playhead as one clip, no loop; an empty tape gets no tempo`;
  }
  return `Sends ${what} at the tape's playhead; an empty tape makes it a loop that sets its tempo`;
}

/**
 * sentMessage is what the tap did, from the Pi's answer: {mode, bpm?,
 * tempo_set?, bar? (the tape bar the downbeat is on, when it was sent), warning?}. len is the sent span as m:ss. Answers
 * {msg, kind}; a tempo that didn't match is a warning, and says so.
 */
export function sentMessage(res, len, track = 1) {
  const head = `Sent ${len} to tape, track ${track}`;
  switch (res.mode) {
    case 'grid': {
      const tempo = res.tempo_set ? `, the tape is now ${fmtBpm(res.bpm)} BPM` : '';
      // No bar when the selection left the downbeat out: it still sits on the lines.
      const where = res.bar ? `bar 1 on tape bar ${res.bar}` : "on the tape's bar lines";
      return { msg: `${head}: ${where}${tempo}`, kind: 'ok' };
    }
    case 'first-loop':
      return { msg: `${head}: a loop at ${fmtBpm(res.bpm)} BPM, which is now the tape's tempo`, kind: 'ok' };
    case 'linear':
      return { msg: `${head}: one clip, no loop, no tempo`, kind: 'ok' };
    default:
      return { msg: res.warning ? `${head}. ${res.warning}` : head, kind: res.warning ? 'warn' : 'ok' };
  }
}
