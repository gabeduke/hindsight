// Where the tape plays, in the Studio: the banner other devices show while a
// phone has it, and the output sheet's state, rendered over the engine's one
// StreamPlayer (engine.output). The strip across the top of the bar, while
// it plays on this phone, is the bar's, drawn in every room
// (lib/bar/tape-status.js).
import { paintOutSheet, outDelay } from './out-switch.js';

const $ = (id) => document.getElementById(id);

export function initOutput({ engine, getTape }) {
  let live = null;
  const player = engine.stream;
  $('out-jam')?.addEventListener('click', () => engine.output.setMode('jam'));

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
  }

  engine.tape?.on(() => render(live));

  return { render, player, streamingHere: () => !!(player && player.active && live && live.output_mode !== 'jam') };
}
