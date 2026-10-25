// Where the tape plays, in the Studio: the status strip across the top of the
// bar and the banner other devices show while a phone has it, rendered over
// the engine's one StreamPlayer (engine.output).
import { barBeat } from './geometry.js';
import { paintOutSheet, outDelay } from './out-switch.js';

const $ = (id) => document.getElementById(id);

export function initOutput({ engine, getTape, getGhost = () => null }) {
  let live = null;
  const player = engine.stream;
  // A suspended context needs a tap to run again: the strip's, or ▶
  // (tapeSource.press() in NowPlaying).
  $('out-strip-resume')?.addEventListener('click', () => player?.resume());
  $('out-jam')?.addEventListener('click', () => engine.output.setMode('jam'));

  const ghostNow = () => { const g = getGhost(); return g && performance.now() < g.until && getTape() && getTape().grid ? g : null; };

  function render(l) {
    live = l;
    const mode = (l && l.output_mode) || 'jam';
    const st = (l && l.stream) || {};
    const here = !!(player && player.active);
    const delay = outDelay(here ? player.delayMs() : st.delay_ms);
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

  engine.tape?.on(() => render(live));

  return { render, player, streamingHere: () => !!(player && player.active && live && live.output_mode !== 'jam') };
}
