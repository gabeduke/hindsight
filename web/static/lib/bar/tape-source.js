// web/static/lib/bar/tape-source.js
// The loaded tape in the now-playing bar on Takes and Capture. Its state is
// polled from the Pi while the page is visible, twice a second (the tape
// page asks five times a second), and the bar runs the playhead on between
// polls. ▶ ■, |◂, Loop and the scrubber drive its transport; Rec and Catch
// stay on the tape page.

import { tapeCounter, tapeMarquee } from './lcd.js';
import { paintTapeOverview } from '../tape/overview.js';

const POLL_MS = 500;
const AHEAD_S = 0.5; // the furthest the playhead is run on past a poll
const OUT_NAMES = { jam: 'Jam room', phone: 'Phone', both: 'Both' };

/**
 * tapeSource is the bar's source for the tape loaded on the Pi (`id`).
 * onError(message) hears of a press the Pi refused.
 */
export function tapeSource(id, { onError } = {}) {
  let t = null, live = null, at = 0, timer = 0, gen = 0, stopped = false, active = true;
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };

  async function poll() {
    const g = ++gen;
    try {
      const res = await fetch(`/api/tapes/state?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok || g !== gen) return;
      const s = await res.json();
      if (g !== gen) return;
      t = s.tape;
      live = s.loaded ? s.live : null;
      at = performance.now();
      fire();
    } catch { /* the next tick asks again */ }
  }
  const tick = () => {
    if (stopped) return;
    // Only while it's in the bar and the page is in view.
    if (active && !document.hidden) poll();
    timer = setTimeout(tick, POLL_MS);
  };
  const onVisible = () => { if (active && !document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  tick();

  async function send(path, method, body) {
    try {
      const res = await fetch(`${path}?id=${encodeURIComponent(id)}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
        onError?.(msg);
      }
    } catch (e) {
      onError?.(e.message);
    }
    setTimeout(poll, 150);
  }

  const sr = () => (t ? t.sample_rate : 48000);
  const counting = () => !!(live && live.count_in > 0);
  const playing = () => !!(live && (live.playing || counting()));
  const mixdown = () => (live && live.mixdown && t && live.mixdown.tape === t.id ? live.mixdown : null);
  // Where the tape is now: the last poll's, run on at its rate while it plays.
  const pos = () => {
    if (!live || !t) return 0;
    let p = live.heard;
    if (live.playing && !counting()) p += Math.min(AHEAD_S, (performance.now() - at) / 1000) * sr();
    return Math.min(p, t.length);
  };
  const loopable = () => !!(t && t.loop.out > t.loop.in);

  return {
    kind: 'tape',
    get ready() { return !!t; },
    get title() { return t ? t.name : 'the tape'; },
    href: '/tape.html',
    get sampleRate() { return sr(); },
    get length() { return t ? t.length : 1; },
    pos,
    playing,
    // ▶ needs a device to play out of; the Pi refuses it otherwise.
    canPlay: () => !!(live && live.output),
    play: () => send('/api/tapes/transport', 'POST', { action: 'play' }),
    pause: () => send('/api/tapes/transport', 'POST', { action: 'stop' }),
    seek(frame) {
      if (!t) return;
      const p = Math.max(0, Math.min(t.length, Math.round(frame)));
      // Shown at once; the next poll confirms it.
      if (live) { live = { ...live, heard: p }; at = performance.now(); fire(); }
      send('/api/tapes/transport', 'POST', { action: 'locate', pos: p });
    },
    // |◂: the loop's start while looping, else the top of the tape.
    start: () => (t && t.loop.on && loopable() ? t.loop.in : 0),
    startLabel: () => (t && t.loop.on && loopable() ? 'Back to the loop’s start' : 'Back to the top of the tape'),
    step: () => (t && t.grid ? t.grid.frames / t.grid.bars : sr()),
    get loop() { return !!(t && t.loop.on); },
    canLoop: loopable,
    setLoop(on) { send('/api/tapes', 'PATCH', { loop: { on } }); },
    tick() {},
    // The bar holding a take instead: no polling until it's back.
    setActive(on) { active = on; if (on) poll(); },
    lcd: () => (t ? tapeCounter(t, live ? { ...live, heard: pos() } : null, mixdown()) : { big: '', small: '', note: '', status: 'stop', unit: '' }),
    marquee: () => (t ? tapeMarquee(t, live) : 'THE TAPE'),
    levels: null,
    out: () => OUT_NAMES[(live && live.output_mode) || 'jam'],
    paint(ctx, W, H, col) {
      if (!t) { ctx.clearRect(0, 0, W, H); return; }
      paintTapeOverview(ctx, W, H, t, live ? pos() : null, { col });
    },
    on(fn) { listeners.add(fn); },
    destroy() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      listeners.clear();
    },
  };
}
