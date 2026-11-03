// web/static/lib/bar/tape-status.js
// What the bar says of the tape besides its display, in every room
// (docs/architecture/bar.md, *The lamp and the output strip*): the output
// strip across its top while the tape plays on this phone, and the
// clock-out lamp, who follows the tape's clock (TAPE_CLOCK=lead). Pure: the
// words from the models (the tape's snapshot(), the engine's stream), which
// NowPlaying (bar.js) writes on its own elements.

import { barBeat } from '../tape/geometry.js';
import { outDelay } from '../tape/out-switch.js';

/**
 * outStrip is the output strip for the tape `tape` and its `live` state (the
 * tape's snapshot()), played on this device by `stream` (the engine's
 * StreamPlayer, or null). `ghost` is a locate the Studio sent and this phone
 * has not heard yet ({pos, until}, the Studio's hands), and `now` the time
 * in ms it is measured against (performance.now()).
 *
 * Answers {hidden: true} unless the tape plays on this device, else
 * {hidden: false, resume, led, text, right}: resume, the tap its locked
 * sound waits for; led, 'wait' or 'on'; text, how it is going; right, how
 * far behind or what it waits for.
 */
export function outStrip({ stream = null, live = null, tape = null, ghost = null, now = 0 } = {}) {
  const mode = (live && live.output_mode) || 'jam';
  const here = !!(stream && stream.active);
  if (!here || mode === 'jam') return { hidden: true };
  const delay = outDelay(stream.delayMs());
  const s = stream.state;
  const moving = ghost && now < ghost.until && tape && tape.grid ? ghost : null;
  const wait = s === 'buffering' || s === 'lost' || s === 'locked';
  const text = s === 'buffering' ? 'Starting on this phone…'
    : s === 'lost' ? `Stream lost · paused at ${(live && tape && barBeat(live.heard, tape.grid)) || 'the same spot'}`
    : s === 'locked' ? (stream.waitingTap ? 'Still on this phone' : 'Paused when the screen locked')
    : moving ? `Moving to bar ${barBeat(moving.pos, tape.grid) || ''}…`
    : live && live.playing ? 'Playing on this phone' : 'Ready on this phone';
  const right = s === 'buffering' ? 'buffering' : s === 'lost' ? 'reconnecting'
    : s === 'locked' ? '' : moving ? `in ${delay}` : `${delay} behind`;
  return { hidden: false, resume: s === 'locked', led: wait ? 'wait' : 'on', text, right };
}

/**
 * clockLamp is the clock-out lamp for the tape's `clock` (live.clock: who
 * follows it, whether it runs, the tempo it hears) and the tape `tape`:
 * {hidden: true} with no clock sent, else {hidden: false, text, none}, none
 * when no device is plugged in to follow it.
 */
export function clockLamp(clock, tape) {
  if (!clock) return { hidden: true };
  const devices = clock.devices || [];
  const who = devices.length ? devices.join(', ') : 'no device plugged in';
  const text = !(tape && tape.grid) ? 'clock: once the tape has a tempo'
    : `clock → ${who}${clock.running ? ' ●' : ''}${clock.running && clock.heard_bpm ? ` · hears ${clock.heard_bpm} BPM` : ''}`;
  return { hidden: false, text, none: !devices.length };
}
