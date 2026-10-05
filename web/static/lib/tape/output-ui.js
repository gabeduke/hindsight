// Where the tape plays: the OUT pill, the Output sheet, the status strip
// under the deck, and the banner other devices show while a phone has it.
import { StreamPlayer } from './stream-player.js';
import { barBeat } from './geometry.js';

const NAMES = { jam: 'Jam room', phone: 'Phone', both: 'Both' };
const REPLAY_MS = 30000; // play on after a loss shorter than this
const $ = (id) => document.getElementById(id);

export function initOutput({ api, toast, poll, transport, getTape, getGhost = () => null }) {
  const sheet = $('out-sheet');
  let live = null;
  let wasPlaying = false; // the tape was playing here when the stream was last fine
  const player = new StreamPlayer({
    onState: (s) => {
      if (s === 'moved') toast(`${(getTape() && getTape().name) || 'The tape'} moved to another device`, 'warn');
      render(live);
    },
    onTransport: (kind) => transport(kind),
    // The Pi stopped the tape when the stream dropped (2 s): play on from
    // there, but only after a short blip, and only if the tape (as the first
    // packet back stamps it) is still stopped. A late return mustn't start
    // whatever the room is doing now.
    onReconnect: ({ lostMs, playing }) => { if (wasPlaying && !playing && lostMs < REPLAY_MS) transport('play'); },
    getLoop: () => { const t = getTape(); return t && t.loop; },
    getTitle: () => (getTape() && getTape().name) || 'Tape',
  });
  // A suspended context needs a tap to run again.
  $('out-strip-resume').addEventListener('click', () => player.resume());

  async function setMode(mode) {
    // The audio starts inside the tap that chose it, before any await: a
    // phone's browser only lets a tap start sound.
    const starting = mode !== 'jam' && !player.active ? player.start() : null;
    // If the PUT fails first, a later start failure must not go unhandled.
    if (starting) starting.catch(() => {});
    let put = false;
    try {
      await api('/api/tapes/output', { method: 'PUT', body: { mode } });
      put = true;
      await starting;
      if (mode === 'jam') player.stop();
      setTimeout(poll, 100);
    } catch (e) {
      if (starting) player.stop();
      // The phone never started: don't leave the jam room silent.
      if (put && mode !== 'jam') {
        try { await api('/api/tapes/output', { method: 'PUT', body: { mode: 'jam' } }); } catch { /* best effort */ }
        poll();
      }
      toast(e.message, 'bad');
    }
  }

  $('tape-out').addEventListener('click', () => {
    const t = getTape();
    $('out-tape-name').textContent = (t && t.name) || 'this tape';
    sheet.showModal();
  });
  $('out-close').addEventListener('click', () => sheet.close());
  for (const b of sheet.querySelectorAll('.out-choice')) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('out-jam').addEventListener('click', () => setMode('jam'));

  const ghostNow = () => { const g = getGhost(); return g && performance.now() < g.until && getTape() && getTape().grid ? g : null; };

  function render(l) {
    live = l;
    if (player.state === 'playing') wasPlaying = !!(l && l.playing);
    const mode = (l && l.output_mode) || 'jam';
    const st = (l && l.stream) || {};
    const here = player.active;
    const delay = `${((here ? player.delayMs() : st.delay_ms) / 1000 || 0.8).toFixed(1)} s`;
    $('tape-out').hidden = !(l && l.output_mode);
    $('tape-out-text').textContent = NAMES[mode];
    for (const b of sheet.querySelectorAll('.out-choice')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    $('out-measured').hidden = mode === 'jam';
    $('out-delay').textContent = delay;
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
        : s === 'locked' ? 'Paused when the screen locked'
        : ghostNow() ? `Moving to bar ${barBeat(ghostNow().pos, getTape().grid) || ''}…`
        : l && l.playing ? 'Playing on this phone' : 'Ready on this phone';
      $('out-strip-right').textContent = s === 'buffering' ? 'buffering' : s === 'lost' ? 'reconnecting'
        : s === 'locked' ? '' : ghostNow() ? `in ${delay}` : `${delay} behind`;
    }
  }

  return { render, player, streamingHere: () => player.active && !!live && live.output_mode !== 'jam' };
}
