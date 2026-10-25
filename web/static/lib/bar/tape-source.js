// web/static/lib/bar/tape-source.js
// The loaded tape in the now-playing bar on Takes and Capture. Its state is
// polled from the Pi while the page is visible, twice a second (the tape
// page asks five times a second), and the bar runs the playhead on between
// polls. ▶ ■, |◂, Loop and the scrubber drive its transport; Rec and Catch
// stay on the tape page. Played on this phone (`stream`, a StreamPlayer the
// bar joined again from the page before), the LCD says how that's going and
// ▶ is the tap its sound waits for.

import { tapeCounter } from '../objects/lcd.js';
import { tapeDisplay } from './display.js';
import { paintTapeOverview } from '../tape/overview.js';
import { refusal } from '../tape/refusal.js';

const POLL_MS = 500;
const AHEAD_S = 0.5; // the furthest the playhead is run on past a poll
const STALE_MS = 2000; // no answer for this long: shown stopped, not run on forever
const HOLD_MS = 1000; // a locate is shown where it was asked, over polls already on their way
const AWAY_EVERY = 10; // out of the bar, every 10th tick (5 s): the header's output button stays true

/**
 * tapeSource is the bar's source for the tape loaded on the Pi (`id`).
 * onError(message) hears of a press the Pi refused; stream() is the tape's
 * player on this phone, if there is one.
 */
export function tapeSource(loadedId, { onError, stream = () => null } = {}) {
  let id = loadedId;
  let t = null, live = null, at = 0, timer = 0, gen = 0, stopped = false, active = true, holdUntil = 0, ticks = 0;
  let want = null; // a press not yet in a poll: {playing, until}
  // A poll that came after the press and agrees with it ends the hold.
  const agreed = () => { if (want && !!(live && live.playing) === want.playing) want = null; };
  let del = null, levels = null;
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };

  async function poll() {
    const g = ++gen;
    try {
      const res = await fetch(`/api/tapes/state?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok || g !== gen || del) return;
      const s = await res.json();
      if (g !== gen || del) return;
      t = s.tape;
      // Another device loaded another tape: follow it.
      if (!s.loaded) { follow(); return; }
      // Just located: keep showing where it was asked until the Pi has it.
      if (performance.now() >= holdUntil) { live = s.live; at = performance.now(); agreed(); }
      fire();
    } catch { /* the next tick asks again */ }
  }
  async function follow() {
    try {
      const list = await (await fetch('/api/tapes', { cache: 'no-store' })).json();
      if (list.loaded && list.loaded !== id) { id = list.loaded; live = null; poll(); }
    } catch { /* the next tick asks again */ }
  }
  const tick = () => {
    if (stopped) return;
    // While it's in the bar and the page is in view (unless the Studio's own
    // 200 ms poll is feeding it); out of the bar, now and then, for where it plays.
    ticks++;
    if (!document.hidden && !del && (active || ticks % AWAY_EVERY === 0)) poll();
    timer = setTimeout(tick, POLL_MS);
  };
  const onVisible = () => { if (active && !del && !document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  tick();

  async function send(path, method, body) {
    try {
      const res = await fetch(`${path}?id=${encodeURIComponent(id)}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const why = refusal(res.status, await res.json().catch(() => ({})));
        onError?.(why.recording ? `${why.message}. ${why.detail}` : why.message);
      }
    } catch (e) {
      onError?.(e.message);
    }
    if (!del) setTimeout(poll, 150);
  }

  const sr = () => (t ? t.sample_rate : 48000);
  const fresh = () => performance.now() - at < STALE_MS;
  const counting = () => !!(live && live.count_in > 0);
  const mixdown = () => (live && live.mixdown && t && live.mixdown.tape === t.id ? live.mixdown : null);
  // Playing, as the tape page reads it: through a count-in, and through a
  // mixdown and its tail (■ cancels it). Not on a poll gone quiet.
  const playing = () => {
    // A ▶ or ■ just pressed is what's playing until the Pi says so, or for
    // HOLD_MS: a second press before the next poll toggles from it, not
    // from the poll before the first.
    if (want && performance.now() < want.until) return want.playing;
    want = null;
    const md = mixdown();
    return fresh() && (!!(live && (live.playing || counting())) || !!(md && (md.state === 'playing' || md.state === 'tail')));
  };
  // On this phone: its sound held back until a tap, or on its way.
  const here = () => { const p = stream(); return p && p.active ? p : null; };
  // Where the tape is now: when streaming here, what this device hears; else
  // the last poll's, run on at its rate while it plays -- round the loop at
  // its Out, as the tape does.
  const pos = () => {
    if (!live || !t) return 0;
    if (live.output_mode !== 'jam') {
      const h = here()?.heard?.();
      if (h) return h.pos;
    }
    let p = live.heard;
    if (live.playing && !counting() && fresh()) {
      p += Math.min(AHEAD_S, (performance.now() - at) / 1000) * sr();
      const { in: a, out: b, on } = t.loop;
      if (on && b > a && live.heard < b && p >= b) p = a + ((p - a) % (b - a));
    }
    return Math.min(p, t.length);
  };
  const loopable = () => !!(t && t.loop.out > t.loop.in);
  const waiting = () => here()?.state === 'locked';
  const streamNote = () => {
    const p = here();
    if (!p) return '';
    if (p.state === 'locked') return 'tap ▶ to play here';
    return p.state === 'lost' || (p.state === 'buffering' && p.waitingTap) ? 'reconnecting…' : '';
  };

  return {
    kind: 'tape',
    get ready() { return !!t; },
    get title() { return t ? t.name : 'the tape'; },
    href: '/tape.html',
    get sampleRate() { return sr(); },
    get length() { return t ? t.length : 1; },
    pos,
    // heardHere is where this device is hearing the tape: behind pos() when
    // it plays here, by the stream's buffer and the output's latency.
    heardHere: () => { const h = here()?.heard?.(); return h ? h.pos : pos(); },
    playing,
    // ▶ needs a device to play out of; the Pi refuses it otherwise.
    canPlay: () => !!(live && live.output),
    canStart: () => !!live,
    waiting,
    // ▶ while the sound waits for a tap: the tap wakes it, and starts the
    // tape if it's stopped -- it never stops what it's waking.
    press() {
      if (!waiting()) return false;
      here().resume();
      if (!playing()) this.play();
      return true;
    },
    play: () => {
      want = { playing: true, until: performance.now() + HOLD_MS };
      fire();
      return del?.play ? del.play() : send('/api/tapes/transport', 'POST', { action: 'play' });
    },
    pause: () => {
      want = { playing: false, until: performance.now() + HOLD_MS };
      fire();
      return del?.stop ? del.stop() : send('/api/tapes/transport', 'POST', { action: 'stop' });
    },
    seek(frame) {
      if (!t) return;
      const p = Math.max(0, Math.min(t.length, Math.round(frame)));
      if (del?.locate) {
        if (live) { live = { ...live, heard: p }; at = performance.now(); fire(); }
        return del.locate(p);
      }
      // Shown at once and held a moment; a poll already on its way with
      // the old place is dropped.
      gen++;
      holdUntil = performance.now() + HOLD_MS;
      if (live) { live = { ...live, heard: p }; at = performance.now(); fire(); }
      send('/api/tapes/transport', 'POST', { action: 'locate', pos: p });
    },
    // |◂: the loop's start while looping, else the top of the tape.
    start: () => (t && t.loop.on && loopable() ? t.loop.in : 0),
    startLabel: () => (t && t.loop.on && loopable() ? 'Back to the loop’s start' : 'Back to the top of the tape'),
    step: () => (t && t.grid ? t.grid.frames / t.grid.bars : sr()),
    get loop() { return !!(t && t.loop.on); },
    loopSpec: () => (t ? t.loop : null),
    canLoop: loopable,
    setLoop(on) {
      if (del?.setLoop) return del.setLoop(on);
      send('/api/tapes', 'PATCH', { loop: { on } });
    },
    tick() {},
    // The bar holding a take instead: no polling until it's back.
    setActive(on) { active = on; if (on && !del) poll(); },
    lcd: () => {
      const c = t ? tapeCounter(t, live ? { ...live, heard: pos() } : null, mixdown()) : { big: '', small: '', note: '', status: 'stop', unit: '' };
      const n = streamNote();
      return n ? { ...c, note: n } : c;
    },
    // The display's tempo, source and where it plays (display.js).
    display: () => tapeDisplay(t, live && live.output_mode),
    get levels() { return levels; },
    setLevels(colors, atFn) {
      levels = colors && atFn ? { colors, at: atFn } : null;
    },
    ingest({ tape: nextTape, live: nextLive } = {}) {
      if (nextTape) { t = nextTape; id = nextTape.id || id; }
      if (nextLive !== undefined) { live = nextLive; at = performance.now(); agreed(); }
      fire();
    },
    delegate(d = null) {
      del = d;
      if (d) gen++;
    },
    // Where it plays, for the header's output button: null before the Pi
    // says, or from one that doesn't.
    mode: () => (live && live.output_mode) || null,
    // How late a phone hears it, as the Pi measured it.
    streamDelayMs: () => (live && live.stream && live.stream.delay_ms) || 0,
    /** refresh asks the Pi now, after a change made elsewhere. */
    refresh: () => (del?.poll ? del.poll() : poll()),
    paint(ctx, W, H, col) {
      if (!t) { ctx.clearRect(0, 0, W, H); return; }
      paintTapeOverview(ctx, W, H, t, live ? pos() : null, { col });
    },
    /** on hears every change to what the bar shows of the tape, and answers its off. */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** changed: something the LCD shows changed (the stream's state). */
    changed: fire,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      listeners.clear();
    },
  };
}
