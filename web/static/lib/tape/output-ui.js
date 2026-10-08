// Where the tape plays, on the tape page: the output button and the Output
// sheet (out-switch.js, shared with Takes and Capture), the status strip
// across the top of the bar, and the banner other devices show while a phone has it.
import { StreamPlayer } from './stream-player.js';
import { rejoin } from './listener.js';
import { barBeat } from './geometry.js';
import { wireOutput, paintOutButtons, paintOutSheet, switchOutput, outDelay } from './out-switch.js';

const REPLAY_MS = 30000; // play on after a loss shorter than this
const $ = (id) => document.getElementById(id);

export function initOutput({ toast, poll, transport, getTape, getGhost = () => null }) {
  let live = null;
  let wasPlaying = false; // the tape was playing here when the stream was last fine
  const player = new StreamPlayer({
    onState: (s) => {
      if (s === 'moved') toast(`${(getTape() && getTape().name) || 'The tape'} moved to another device`, 'warn');
      render(live);
    },
    onTransport: (kind) => transport(kind),
    // The Pi stopped the tape when the stream dropped (6 s): play on from
    // there, but only after a short blip, and only if the tape (as the first
    // packet back stamps it) is still stopped. A late return mustn't start
    // whatever the room is doing now.
    onReconnect: ({ lostMs, playing }) => { if (wasPlaying && !playing && lostMs < REPLAY_MS) transport('play'); },
    getLoop: () => { const t = getTape(); return t && t.loop; },
    getTitle: () => (getTape() && getTape().name) || 'Tape',
  });
  // A suspended context needs a tap to run again: the strip's, or ▶. That ▶
  // plays the tape if it's stopped, and never stops it (page.js shows ▶ for
  // it, and its own handler is held back while the tape plays).
  $('out-strip-resume').addEventListener('click', () => player.resume());
  $('play').addEventListener('click', (e) => {
    if (player.state !== 'locked') return;
    player.resume();
    if (live && (live.playing || live.count_in > 0)) e.stopImmediatePropagation();
  }, true);

  const setMode = (mode) => switchOutput(mode, { player, poll, toast });
  // Two output buttons, one control: the header's, and the OUT pill in the
  // phone's open player.
  wireOutput({ choose: setMode, name: () => getTape() && getTape().name });
  $('out-jam').addEventListener('click', () => setMode('jam'));

  const ghostNow = () => { const g = getGhost(); return g && performance.now() < g.until && getTape() && getTape().grid ? g : null; };

  function render(l) {
    live = l;
    if (player.state === 'playing') wasPlaying = !!(l && l.playing);
    const mode = (l && l.output_mode) || 'jam';
    const st = (l && l.stream) || {};
    const here = player.active;
    const delay = outDelay(here ? player.delayMs() : st.delay_ms);
    paintOutButtons(l && l.output_mode);
    paintOutSheet(mode, delay);
    // Another device has the tape: say so, and offer it back.
    const elsewhere = mode === 'phone' && !here;
    $('out-banner').hidden = !elsewhere;
    $('out-banner-what').textContent = `${(getTape() && getTape().name) || 'The tape'} is playing on a phone`;
    $('out-banner-delay').textContent = delay;
    // This device has it: the strip.
    const strip = $('out-strip');
    strip.hidden = !(here && mode !== 'jam');
    $('out-strip-resume').hidden = strip.hidden || player.state !== 'locked';
    if (!strip.hidden) {
      const s = player.state;
      const wait = s === 'buffering' || s === 'lost' || s === 'locked';
      $('out-strip-led').className = `out-led ${wait ? 'wait' : 'on'}`;
      $('out-strip-text').textContent =
        s === 'buffering' ? 'Starting on this phone…'
        : s === 'lost' ? `Stream lost · paused at ${(l && getTape() && barBeat(l.heard, getTape().grid)) || 'the same spot'}`
        : s === 'locked' ? (player.waitingTap ? 'Still on this phone' : 'Paused when the screen locked')
        : ghostNow() ? `Moving to bar ${barBeat(ghostNow().pos, getTape().grid) || ''}…`
        : l && l.playing ? 'Playing on this phone' : 'Ready on this phone';
      $('out-strip-right').textContent = s === 'buffering' ? 'buffering' : s === 'lost' ? 'reconnecting'
        : s === 'locked' ? '' : ghostNow() ? `in ${delay}` : `${delay} behind`;
    }
  }

  // This device was listening on the page before: join again.
  rejoin(player);

  return { render, player, streamingHere: () => player.active && !!live && live.output_mode !== 'jam' };
}
