// web/static/lib/models/transport.js
// The transport: the loaded tape's ▶ ■, where it is, its loop and its tempo,
// as a page holds them (docs/architecture/bar.md, *The transport*;
// docs/plan/the-ecosystem.md, *Models per noun*).
//
// One per page, made by the bar's engine (lib/bar/engine.js), which hands it
// to the bar's tape source (lib/bar/tape-source.js) to draw, and lends it to
// the Studio (lib/tape/page.js) while the Studio is shown. It has no DOM: it
// knows the tape and its `live` state as the Pi last answered
// /api/tapes/state, runs the playhead on between answers, and sends ▶, ■,
// a locate and the loop.
//
// When it asks:
//   - every POLL_MS while it is in the bar (setActive) and the page is in
//     view; every AWAY_EVERY'th tick out of the bar, so where it plays stays
//     true for the header's output button;
//   - at once when the changes socket (lib/tape/changes.js) says the tape
//     moved: a nudge, not the state (decision 0013). The socket is the
//     page's one, open from load() to destroy() whoever holds the
//     transport, so a room switch never closes it or opens another (a
//     WebSocket over TLS costs a handshake, and the gap is deaf); with a
//     take in the bar its nudges wait for the tape to be back, and it hands
//     on the keyboard's presses and the take list's revision (onPress,
//     onTakes);
//   - at once, forced, when the page comes back into view (wake);
//   - shortly after each command it sends, and when asked (refresh).
// One poll at a time (lib/tape/poll-gate.js): a nudge while one is out asks
// once more when it ends, never beside it.
//
// While the Studio is shown it borrows the transport (delegate): the
// Studio's own 200 ms poll feeds it (ingest), its ▶ ■, locate and loop go
// through the Studio's hands, and a nudge goes to the Studio's (nudge), so
// the Studio's state and the bar's are one. Handed back (delegate(null)),
// it asks the Pi at once.

import { refusal } from '../tape/refusal.js';
import { watchChanges } from '../tape/changes.js';
import { pollGate } from '../tape/poll-gate.js';
import { timedFetch } from '../link.js';
import { bpm as bpmOf } from '../tape/geometry.js';

/** POLL_MS is how often it asks while in the bar. */
export const POLL_MS = 500;
/** AHEAD_S is the furthest the playhead is run on past an answer. */
export const AHEAD_S = 0.5;
/** POLL_TIMEOUT_MS: a poll lost in a sleep gives up, so the gate opens again. */
export const POLL_TIMEOUT_MS = 4000;
/** STALE_MS: no answer for this long, and it is taken for stopped, not run on forever. */
export const STALE_MS = 2000;
/** HOLD_MS: a press or a locate is what shows, over answers already on their way, for this long. */
export const HOLD_MS = 1000;
/** AWAY_EVERY: out of the bar, every AWAY_EVERY'th tick (5 s). */
export const AWAY_EVERY = 10;
/** SETTLE_MS: how long after a command it asks what the Pi made of it. */
export const SETTLE_MS = 150;

/**
 * createTransport makes the page's transport. env is for tests: fetch
 * (a lib/link.js timedFetch with POLL_TIMEOUT_MS, and the commands'),
 * now() in ms (performance.now), hidden() (the page out of view),
 * setTimeout and clearTimeout, and watch (changes.js's watchChanges).
 * onError(message) hears of a command the Pi refused.
 *
 * It answers:
 *   load(id)      the tape loaded on the Pi: starts asking about it
 *   ready, id     a tape is in; its id
 *   snapshot()    {v, id, tape, live}: the tape and its live state as last
 *                 answered (a locate shown ahead of the answer), frozen,
 *                 the same object until one of them moves; v counts the
 *                 moves. A ▶ or ■ pressed and not yet answered is not in
 *                 it: that, and what runs on between answers, is
 *                 playing() and pos(), read on the ticker
 *   tape          the tape as last answered ({name, length, loop, grid, …}), or null
 *   live          its live state ({playing, heard, count_in, output_mode, …}), or null
 *   sampleRate, length
 *   playing()     ▶ as the tape page reads it: through a count-in and a
 *                 mixdown's tail; a press not yet answered; not on an
 *                 answer STALE_MS old
 *   pos()         where the Pi has it, run on at its rate while it plays,
 *                 round the loop at its Out
 *   counting(), mixdown(), mode(), streamDelayMs(), canPlay(), canStart()
 *   loop, loopSpec(), canLoop(), start(), step()
 *   tempo()       {bpm, bars, barFrames} from the tape's grid, or null
 *   play(), stop(), locate(frame), setLoop(on), refresh()
 *   setActive(on) in the bar, or a take in it instead
 *   wake()        the page is back in view
 *   delegate(hands), ingest({tape, live})
 *                 the Studio borrowing it ({play, stop, locate, setLoop,
 *                 poll, nudge}), and feeding it
 *   onPress(fn), onTakes(fn)
 *                 the socket's presses and take revisions, handed on
 *   onChange(fn)  fn() on every change to any of it; a way off
 *   changed()     tells the listeners (something drawn from it changed)
 *   destroy()
 */
export function createTransport(env = {}) {
  const {
    fetch: fetchImpl = (u, o) => timedFetch(u, o, POLL_TIMEOUT_MS),
    send: sendImpl = (u, o) => globalThis.fetch(u, o),
    now = () => performance.now(),
    hidden = () => !!globalThis.document?.hidden,
    setTimeout: later = (f, ms) => setTimeout(f, ms),
    clearTimeout: cancel = (h) => clearTimeout(h),
    watch = watchChanges,
    onError = null,
  } = env;

  let id = null;
  let loaded = false; // load() has started it asking
  let t = null, live = null, at = 0, timer = 0, gen = 0, stopped = false, active = true, holdUntil = 0, ticks = 0;
  let want = null; // a press not yet in an answer: {playing, until}
  // An answer that came after the press and agrees with it ends the hold.
  const agreed = () => { if (want && !!(live && live.playing) === want.playing) want = null; };
  let del = null;
  let snap = null, moves = 0; // snapshot()'s
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };

  const gate = pollGate();
  const ask = () => (gate.nudge() ? poll() : undefined);
  async function poll(force = false) {
    if (!loaded) return;
    const mine = gate.begin(force === true);
    if (!mine) return;
    const g = ++gen;
    try {
      const res = await fetchImpl(`/api/tapes/state?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok || g !== gen || del) return;
      const s = await res.json();
      if (g !== gen || del) return;
      t = s.tape;
      // Another device loaded another tape: follow it.
      if (!s.loaded) { follow(); return; }
      // Just located: keep showing where it was asked until the Pi has it.
      if (now() >= holdUntil) { live = s.live; at = now(); agreed(); }
      fire();
    } catch { /* the next tick asks again */ } finally {
      if (gate.end(mine)) poll();
    }
  }
  async function follow() {
    try {
      const list = await (await sendImpl('/api/tapes', { cache: 'no-store' })).json();
      if (list.loaded && list.loaded !== id) { id = list.loaded; live = null; ask(); }
    } catch { /* the next tick asks again */ }
  }
  const tick = () => {
    if (stopped) return;
    ticks++;
    if (!hidden() && !del && (active || ticks % AWAY_EVERY === 0)) poll();
    timer = later(tick, POLL_MS);
  };

  // The changes socket: the page's one, from load() to destroy(). Lent to
  // the Studio, a nudge is the Studio's to act on; with a take in the bar it
  // waits for the tape to be back.
  let changes = null;
  const pressListeners = new Set();
  const heardPress = (p) => { for (const f of pressListeners) f(p); };
  const takesListeners = new Set();
  const heardTakes = (m) => { for (const f of takesListeners) f(m); };
  const nudged = (m) => {
    if (del) { del.nudge?.(m); return; }
    if (active && !hidden()) ask();
  };
  const syncChanges = () => {
    const on = loaded && !stopped;
    if (on && !changes) {
      changes = watch({ onNudge: nudged, onPress: heardPress, onTakes: heardTakes });
    } else if (!on && changes) { changes.close(); changes = null; }
  };

  async function send(path, method, body) {
    try {
      const res = await sendImpl(`${path}?id=${encodeURIComponent(id)}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const why = refusal(res.status, await res.json().catch(() => ({})));
        onError?.(why.recording ? `${why.message}. ${why.detail}` : why.message);
      }
    } catch (e) {
      onError?.(e.message);
    }
    if (!del) later(ask, SETTLE_MS);
  }

  const sr = () => (t ? t.sample_rate : 48000);
  const fresh = () => now() - at < STALE_MS;
  const counting = () => !!(live && live.count_in > 0);
  const mixdown = () => (live && live.mixdown && t && live.mixdown.tape === t.id ? live.mixdown : null);
  const playing = () => {
    // A ▶ or ■ just pressed is what's playing until the Pi says so, or for
    // HOLD_MS: a second press before the next answer toggles from it, not
    // from the answer before the first.
    if (want && now() < want.until) return want.playing;
    want = null;
    const md = mixdown();
    return fresh() && (!!(live && (live.playing || counting())) || !!(md && (md.state === 'playing' || md.state === 'tail')));
  };
  const pos = () => {
    if (!live || !t) return 0;
    let p = live.heard;
    if (live.playing && !counting() && fresh()) {
      p += Math.min(AHEAD_S, (now() - at) / 1000) * sr();
      const { in: a, out: b, on } = t.loop;
      if (on && b > a && live.heard < b && p >= b) p = a + ((p - a) % (b - a));
    }
    return Math.min(p, t.length);
  };
  const loopable = () => !!(t && t.loop.out > t.loop.in);

  return {
    load(loadedId) {
      if (!loadedId || loaded) return;
      loaded = true;
      id = loadedId;
      tick();
      syncChanges();
    },
    get ready() { return !!t; },
    get id() { return id; },
    get tape() { return t; },
    get live() { return live; },
    snapshot() {
      if (!snap || snap.id !== id || snap.tape !== t || snap.live !== live) snap = Object.freeze({ v: ++moves, id, tape: t, live });
      return snap;
    },
    get sampleRate() { return sr(); },
    get length() { return t ? t.length : 1; },
    playing,
    pos,
    counting,
    mixdown,
    // Where it plays: null before the Pi says, or from one that doesn't.
    mode: () => (live && live.output_mode) || null,
    // How late a phone hears it, as the Pi measured it.
    streamDelayMs: () => (live && live.stream && live.stream.delay_ms) || 0,
    // ▶ needs a device to play out of; the Pi refuses it otherwise.
    canPlay: () => !!(live && live.output),
    canStart: () => !!live,
    get loop() { return !!(t && t.loop.on); },
    loopSpec: () => (t ? t.loop : null),
    canLoop: loopable,
    // |◂: the loop's start while looping, else the top of the tape.
    start: () => (t && t.loop.on && loopable() ? t.loop.in : 0),
    // A bar, or a second with no tempo.
    step: () => (t && t.grid ? t.grid.frames / t.grid.bars : sr()),
    tempo: () => (t && t.grid ? { bpm: bpmOf(t.grid, sr()), bars: t.grid.bars, barFrames: t.grid.frames / t.grid.bars } : null),
    play() {
      want = { playing: true, until: now() + HOLD_MS };
      fire();
      return del?.play ? del.play() : send('/api/tapes/transport', 'POST', { action: 'play' });
    },
    stop() {
      want = { playing: false, until: now() + HOLD_MS };
      fire();
      return del?.stop ? del.stop() : send('/api/tapes/transport', 'POST', { action: 'stop' });
    },
    locate(frame) {
      if (!t) return;
      const p = Math.max(0, Math.min(t.length, Math.round(frame)));
      if (del?.locate) {
        if (live) { live = { ...live, heard: p }; at = now(); fire(); }
        return del.locate(p);
      }
      // Shown at once and held a moment; a poll already on its way with
      // the old place is dropped.
      gen++;
      holdUntil = now() + HOLD_MS;
      if (live) { live = { ...live, heard: p }; at = now(); fire(); }
      send('/api/tapes/transport', 'POST', { action: 'locate', pos: p });
    },
    setLoop(on) {
      if (del?.setLoop) return del.setLoop(on);
      send('/api/tapes', 'PATCH', { loop: { on } });
    },
    /** refresh asks the Pi now, after a change made elsewhere. */
    refresh: () => (del?.poll ? del.poll() : ask()),
    setActive(on) { active = on; if (on && !del) ask(); },
    wake() { if (active && !del && !hidden()) poll(true); },
    ingest({ tape: nextTape, live: nextLive } = {}) {
      if (nextTape) { t = nextTape; id = nextTape.id || id; }
      if (nextLive !== undefined) { live = nextLive; at = now(); agreed(); }
      fire();
    },
    delegate(d = null) {
      const was = del;
      del = d;
      if (d) gen++;
      if (was && !d && active && !hidden()) ask();
    },
    onPress(fn) { pressListeners.add(fn); return () => pressListeners.delete(fn); },
    onTakes(fn) { takesListeners.add(fn); return () => takesListeners.delete(fn); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    changed: fire,
    destroy() {
      stopped = true;
      syncChanges();
      cancel(timer);
      listeners.clear();
      pressListeners.clear();
      takesListeners.clear();
    },
  };
}
