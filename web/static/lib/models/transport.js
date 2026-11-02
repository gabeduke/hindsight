// web/static/lib/models/transport.js
// The transport: the loaded tape's ▶ ■, where it is, its loop and its tempo,
// as a page holds them (docs/architecture/bar.md, *The transport*;
// docs/plan/the-ecosystem.md, *Models per noun*).
//
// One per page, made by the bar's engine (lib/models/engine.js), which hands it
// to the bar's tape source (lib/models/tape-source.js) to draw, and lends it to
// the Studio (lib/tape/page.js) while the Studio is shown. It has no DOM and
// names no route: it reads the tape and its `live` state from the page's
// tape (tape.js), which polls for the page, runs the playhead on between
// answers, and sends its verbs through the page's protocol client
// (protocol.js; a fixture's in the tests): ▶, ■, a locate, the loop, where
// it plays, the tempo and a free loop's tap. Each verb answers the Pi's
// answer or throws its Refusal; whoever pressed says why.
//
// How often the tape is asked for it:
//   - every POLL_MS while it is in the bar (setActive) and the page is in
//     view; every AWAY_EVERY * POLL_MS out of the bar, so where it plays
//     stays true for the header's output button (the tape's every);
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
// Each verb is a change of the tape's (tape.change): a poll it overtakes is
// dropped.
//
// While the Studio is shown it borrows the transport (delegate): the Studio
// asks the tape every 200 ms, feeds the transport what it shows (ingest:
// the place this phone hears), and each verb is sent inside the Studio's
// hands (around: it shows what the answer says), so the Studio's state and
// the bar's are one. Handed back (delegate(null)), it asks the Pi at once.

import { bpm as bpmOf } from '../tape/geometry.js';
import { createProtocol } from './protocol.js';
import { createTape } from './tape.js';

/** POLL_MS is how often it asks while in the bar. */
export const POLL_MS = 500;
/** AHEAD_S is the furthest the playhead is run on past an answer. */
export const AHEAD_S = 0.5;
/** STALE_MS: no answer for this long, and it is taken for stopped, not run on forever. */
export const STALE_MS = 2000;
/** HOLD_MS: a press or a locate is what shows, over answers already on their way, for this long. */
export const HOLD_MS = 1000;
/** AWAY_EVERY: out of the bar, every AWAY_EVERY * POLL_MS (5 s). */
export const AWAY_EVERY = 10;
/** SETTLE_MS: how long after a command it asks what the Pi made of it. */
export const SETTLE_MS = 150;

/**
 * createTransport makes the page's transport. env: protocol (the page's
 * client, protocol.js; a fixture's in the tests and the components'
 * harness), tape (the page's, tape.js; one of its own over protocol when
 * none is given), and for tests now() in ms (performance.now), hidden()
 * (the page out of view), setTimeout and clearTimeout.
 *
 * It answers:
 *   load(id)      the tape loaded on the Pi: starts the tape asking about it
 *   snapshot()    {v, id, tape, live, pending}: the tape ({name, length,
 *                 sample_rate, loop, grid, …}) and its live state
 *                 ({playing, heard, count_in, output_mode, …}) as last
 *                 answered (a locate shown ahead of the answer), each null
 *                 before the first; pending, a ▶ (true) or ■ (false)
 *                 pressed and not yet answered, else null. Frozen, the
 *                 same object until one of them moves; v counts the moves.
 *                 What runs on between answers is playing() and pos(),
 *                 read on the ticker
 *   sampleRate()  the tape's, 48 kHz before it is in
 *   playing()     ▶ as the tape page reads it: through a count-in and a
 *                 mixdown's tail; a press not yet answered; not on an
 *                 answer STALE_MS old
 *   pos()         where the Pi has it, run on at its rate while it plays,
 *                 round the loop at its Out
 *   counting(), mixdown(), mode(), streamDelayMs(), canPlay(), canStart()
 *   looping(), loopSpec(), canLoop(), start(), step()
 *   tempo()       {bpm, bars, barFrames} from the tape's grid, or null
 * Its verbs, each a promise of the Pi's answer or a Refusal (protocol.js):
 *   play(), stop(), locate(frame)
 *                 ▶ ■ and a locate, shown at once (pending, and the place)
 *   setLoop(on)   the loop on or off
 *   setOutput(mode)
 *                 where it plays: 'jam', 'phone' or 'both'
 *   setTempo(bpm), setBars(n)
 *                 a re-grid (decision 0062): a new BPM over the same bars,
 *                 or the grid's frames counted as n bars
 *   tapLoop(body), tapCancel()
 *                 a free loop's tap onto the armed tracks ({tracks, …},
 *                 lib/tape/record-body.js), and starting it over
 * And:
 *   refresh()     asks the Pi now, after a change made elsewhere
 *   setActive(on) in the bar, or a take in it instead
 *   wake()        the page is back in view
 *   delegate(hands), ingest({tape, live})
 *                 the Studio borrowing it ({around(name, args, run)}), and
 *                 feeding it what it shows
 *   onPress(fn), onTakes(fn)
 *                 the socket's presses and take revisions, handed on
 *   onChange(fn)  fn() on every change to any of it; a way off
 *   changed()     tells the listeners (something drawn from it changed)
 *   destroy()
 */
export function createTransport(env = {}) {
  const {
    protocol = createProtocol(),
    now = () => performance.now(),
    hidden = () => !!globalThis.document?.hidden,
    setTimeout: later = (f, ms) => setTimeout(f, ms),
    clearTimeout: cancel = (h) => clearTimeout(h),
  } = env;
  const own = !env.tape;
  const tape = env.tape || createTape({ protocol, hidden, setTimeout: later, clearTimeout: cancel });

  let id = null;
  let loaded = false; // load() has started the tape asking
  let t = null, live = null, at = 0, stopped = false, active = true, holdUntil = 0;
  let want = null; // a press not yet in an answer: {playing, until}
  // An answer that came after the press and agrees with it ends the hold.
  const agreed = () => { if (want && !!(live && live.playing) === want.playing) want = null; };
  let del = null;
  let snap = null, moves = 0; // snapshot()'s
  const pendingNow = () => (want && now() < want.until ? want.playing : null);
  // A ▶ or ■ the Pi refused is no longer pending, unless a later press is:
  // the Pi's state shows at once.
  const refused = (mine) => (e) => { if (want === mine) { want = null; fire(); } throw e; };
  const listeners = new Set();
  const fire = () => { for (const f of listeners) f(); };

  // What the tape heard. Lent to the Studio, the Studio ingests what it
  // shows after this. Just located, it keeps showing where it was asked
  // until the Pi has it.
  const heard = (s) => {
    if (!s.tape) return;
    if (s.id !== id) live = null; // another tape: its place is its own
    id = s.id;
    t = s.tape;
    if (now() >= holdUntil) { live = s.live || null; at = now(); agreed(); }
    fire();
  };
  const offTape = tape.onChange(heard);
  const ask = () => tape.nudge();
  const rate = () => { if (loaded && !stopped) tape.every('bar', active ? POLL_MS : POLL_MS * AWAY_EVERY); };

  // The changes socket: the page's one, from load() to destroy(). Lent to
  // the Studio, a nudge is the Studio's to act on; with a take in the bar it
  // waits for the tape to be back.
  let changes = null;
  const pressListeners = new Set();
  const heardPress = (p) => { for (const f of pressListeners) f(p); };
  const takesListeners = new Set();
  const heardTakes = (m) => { for (const f of takesListeners) f(m); };
  const nudged = () => {
    if ((del || active) && !hidden()) ask();
  };
  const syncChanges = () => {
    const on = loaded && !stopped;
    if (on && !changes) {
      changes = protocol.watch({ onNudge: nudged, onPress: heardPress, onTakes: heardTakes });
    } else if (!on && changes) { changes.close(); changes = null; }
  };

  // send sends verb `name` for the loaded tape, a change of the tape's,
  // inside the Studio's hands while it has the transport, and asks what the
  // Pi made of it shortly after, answered or refused.
  async function send(name, args = {}) {
    const run = () => protocol.verb('transport', name, args, { id });
    const hands = del;
    try {
      return await tape.change(hands?.around ? () => hands.around(name, args, run) : run);
    } finally {
      later(ask, SETTLE_MS);
    }
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
      tape.load(loadedId);
      rate();
      syncChanges();
    },
    snapshot() {
      const pending = pendingNow();
      if (!snap || snap.id !== id || snap.tape !== t || snap.live !== live || snap.pending !== pending) snap = Object.freeze({ v: ++moves, id, tape: t, live, pending });
      return snap;
    },
    sampleRate: sr,
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
    looping: () => !!(t && t.loop.on),
    loopSpec: () => (t ? t.loop : null),
    canLoop: loopable,
    // |◂: the loop's start while looping, else the top of the tape.
    start: () => (t && t.loop.on && loopable() ? t.loop.in : 0),
    // A bar, or a second with no tempo.
    step: () => (t && t.grid ? t.grid.frames / t.grid.bars : sr()),
    tempo: () => (t && t.grid ? { bpm: bpmOf(t.grid, sr()), bars: t.grid.bars, barFrames: t.grid.frames / t.grid.bars } : null),
    play() {
      const mine = want = { playing: true, until: now() + HOLD_MS };
      fire();
      return send('play').catch(refused(mine));
    },
    stop() {
      const mine = want = { playing: false, until: now() + HOLD_MS };
      fire();
      return send('stop').catch(refused(mine));
    },
    locate(frame) {
      if (!t) return Promise.resolve(null);
      const p = Math.max(0, Math.min(t.length, Math.round(frame)));
      // Shown at once and held a moment (a poll already on its way with the
      // old place is dropped: the tape's change). Lent, the Studio shows it.
      if (!del) holdUntil = now() + HOLD_MS;
      if (live) { live = { ...live, heard: p }; at = now(); fire(); }
      return send('locate', { pos: p });
    },
    setLoop: (on) => send('setLoop', { on }),
    setOutput: (mode) => send('setOutput', { mode }),
    setTempo: (bpm) => send('setTempo', { bpm }),
    setBars: (bars) => send('setBars', { bars }),
    tapLoop: (body) => send('tapLoop', body),
    tapCancel: () => send('tapCancel'),
    /** refresh asks the Pi now, after a change made elsewhere. */
    refresh: () => ask(),
    setActive(on) { active = on; rate(); if (on && !del) ask(); },
    wake() { if (active && !del && !hidden()) tape.refresh(true); },
    ingest({ tape: nextTape, live: nextLive } = {}) {
      if (nextTape) { t = nextTape; id = nextTape.id || id; }
      if (nextLive !== undefined) { live = nextLive; at = now(); agreed(); }
      fire();
    },
    delegate(d = null) {
      const was = del;
      del = d;
      if (was && !d && active && !hidden()) ask();
    },
    onPress(fn) { pressListeners.add(fn); return () => pressListeners.delete(fn); },
    onTakes(fn) { takesListeners.add(fn); return () => takesListeners.delete(fn); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    changed: fire,
    destroy() {
      stopped = true;
      syncChanges();
      offTape();
      tape.every('bar', null);
      if (own) tape.destroy();
      listeners.clear();
      pressListeners.clear();
      takesListeners.clear();
    },
  };
}
