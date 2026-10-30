// web/static/lib/bar/tape-source.js
// The loaded tape in the now-playing bar: the bar's view of the page's
// transport (lib/models/transport.js), which polls the Pi, hears its push,
// runs the playhead on and sends ▶ ■, |◂, Loop and the scrubber's locate;
// Rec and Catch stay on the tape page. This draws it: the LCD, the display,
// the overview, the levels. Played on this phone (`stream`, a StreamPlayer
// the bar joined again from the page before), the LCD says how that's going,
// where it is is what this phone hears, and ▶ is the tap its sound waits for.

import { tapeCounter } from '../objects/lcd.js';
import { tapeDisplay } from './display.js';
import { paintTapeOverview } from '../tape/overview.js';

/**
 * tapeSource is the bar's source for `transport` (createTransport's, loaded
 * with the Pi's tape). stream() is the tape's player on this phone, if there
 * is one.
 */
export function tapeSource(transport, { stream = () => null } = {}) {
  const tr = transport;
  let levels = null;
  // Back in view: the transport asks the Pi at once (it has no document).
  const onVisible = () => tr.wake();
  document.addEventListener('visibilitychange', onVisible);

  // On this phone: its sound held back until a tap, or on its way.
  const here = () => { const p = stream(); return p && p.active ? p : null; };
  // Where the tape is now: when streaming here, what this device hears; else
  // the transport's, run on at its rate while it plays.
  const pos = () => {
    if (!tr.live || !tr.tape) return 0;
    if (tr.live.output_mode !== 'jam') {
      const h = here()?.heard?.();
      if (h) return h.pos;
    }
    return tr.pos();
  };
  const waiting = () => here()?.state === 'locked';
  const streamNote = () => {
    const p = here();
    if (!p) return '';
    if (p.state === 'locked') return 'tap ▶ to play here';
    return p.state === 'lost' || (p.state === 'buffering' && p.waitingTap) ? 'reconnecting…' : '';
  };

  return {
    kind: 'tape',
    get ready() { return tr.ready; },
    get title() { return tr.tape ? tr.tape.name : 'the tape'; },
    href: '/tape.html',
    get sampleRate() { return tr.sampleRate; },
    get length() { return tr.length; },
    pos,
    // heardHere is where this device is hearing the tape: behind pos() when
    // it plays here, by the stream's buffer and the output's latency.
    heardHere: () => { const h = here()?.heard?.(); return h ? h.pos : pos(); },
    playing: () => tr.playing(),
    canPlay: () => tr.canPlay(),
    canStart: () => tr.canStart(),
    waiting,
    // ▶ while the sound waits for a tap: the tap wakes it, and starts the
    // tape if it's stopped -- it never stops what it's waking.
    press() {
      if (!waiting()) return false;
      here().resume();
      if (!tr.playing()) tr.play();
      return true;
    },
    play: () => tr.play(),
    pause: () => tr.stop(),
    seek: (frame) => tr.locate(frame),
    start: () => tr.start(),
    startLabel: () => (tr.loop && tr.canLoop() ? 'Back to the loop’s start' : 'Back to the top of the tape'),
    step: () => tr.step(),
    get loop() { return tr.loop; },
    loopSpec: () => tr.loopSpec(),
    canLoop: () => tr.canLoop(),
    setLoop: (on) => tr.setLoop(on),
    tick() {},
    // The bar holding a take instead: the transport asks only now and then.
    setActive: (on) => tr.setActive(on),
    lcd: () => {
      const t = tr.tape, live = tr.live;
      const c = t ? tapeCounter(t, live ? { ...live, heard: pos() } : null, tr.mixdown()) : { big: '', small: '', note: '', status: 'stop', unit: '' };
      const n = streamNote();
      return n ? { ...c, note: n } : c;
    },
    // The display's tempo, source and where it plays (display.js).
    display: () => tapeDisplay(tr.tape, tr.live && tr.live.output_mode),
    get levels() { return levels; },
    setLevels(colors, atFn) {
      levels = colors && atFn ? { colors, at: atFn } : null;
    },
    paint(ctx, W, H, col) {
      if (!tr.tape) { ctx.clearRect(0, 0, W, H); return; }
      paintTapeOverview(ctx, W, H, tr.tape, tr.live ? pos() : null, { col });
    },
    /** on hears every change to what the bar shows of the tape, and answers its off. */
    on: (fn) => tr.onChange(fn),
    /** changed: something the LCD shows changed (the stream's state). */
    changed: () => tr.changed(),
    destroy() {
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
