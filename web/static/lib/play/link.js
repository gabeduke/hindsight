// web/static/lib/play/link.js
// The surface's line to the Pi: what makes the pads audible.
//
// A pad is sent the moment it's touched and the moment it's let go -- the
// surface's `arm` and `let` -- not on its grid line. The Pi quantises both
// on its own render head (internal/tape/trick.go), so a phone's Wi-Fi delay
// lands on the grid rather than late. Sending on the line instead would add
// that whole trip on top, and the press would land after the beat it was
// meant for.
//
// Back from the Pi come the lead -- how long a press takes to be heard at
// best -- which the surface draws as the dim-to-bright gap, and, for each
// press and release, when it will actually be heard, which moves the pad's
// bright moment to the truth (Surface.confirm).
//
// Every page on the socket hears every pad (the Pi's trick log is shared):
// an `at` for a pad this page isn't holding is another hand's -- a phone, a
// laptop, the controller in the Pi -- and lights the pad here too, bright
// only, because the dim state is the local touch's (onRemote). And MIDI
// LEARN for the Pi's controllers travels on the same socket (learn()).
//
// The punch-in FX carry an amount (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md):
// a press says where it starts -- a velocity, or where the pad was left --
// and a `set` moves it while held. The bend and the tape mods' previews go
// by their own press, set and release. Every amount that moves, from any
// hand, comes back as an `at` with `move`: it moves the amount drawn
// (onAmount), and lights nothing -- only a press's or a release's `at` does.
//
// Each press, set and release is timed to the ear on the Pi
// (internal/tape/latency.go, GET /api/latency): it carries when the hand
// touched it and when it was sent, on the Pi's clock, which the socket's
// round trips teach the page (piclock.js). Until the first trip is back,
// they go untimed.
//
// Like the keyboard and touch adapters, this knows nothing of the DOM; the
// socket is passed in, so it is tested against a fake one.

import { control } from './controls.js';
import { piClock } from './piclock.js';
import { say } from '../rooms/words.js';

/** How often the clock is asked: quickly at first, then every two seconds. */
const PING_FIRST_MS = 250;
const PING_MS = 2000;
const PINGS_FIRST = 4;

/** The Pi's name for each quantise setting. */
const QUANTA = { off: 'now', '16th': '16th', '8th': '8th', beat: 'beat', bar: 'bar' };

export function quantum(division) {
  return QUANTA[division] ?? '16th';
}

/**
 * refusal is a refused press in words for the player. In a mixdown it says
 * what's going on: the mixdown prints the tape and its mods, never what's
 * held, so a pad waits until it's done.
 */
export function refusal(pad, why = '') {
  const face = control(pad)?.face || pad;
  if (/mixdown/.test(why)) return say(`${face} waits: a mixdown is playing, and it prints the tape and its mods, never the FX or tricks`);
  return `${face}: ${why}`;
}

/** playURL is the socket's address on the page's own host. */
export function playURL(loc = globalThis.location) {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/tapes/play`;
}

/**
 * connect links a surface to the Pi and returns {close}. Closing lets go of
 * everything on the Pi -- the server does the same if the socket just drops,
 * but saying so is quicker than its ping noticing.
 *
 * onNote(text) hears what the player should be told: a press refused, the
 * Pi out of reach. onRemote(pad, on, atMs) hears another hand's pad sound
 * or stop, and when -- every stop, even of a pad this page holds too, so a
 * mark never outlives the sound; onHeld(pads) hears exactly what's held as
 * the socket (re)opens; onOpen() hears it open.
 */
export function connect(surface, {
  url = playURL(),
  WebSocketImpl = globalThis.WebSocket,
  now = () => performance.now(),
  onNote = () => {},
  onRemote = () => {},
  onHeld = () => {},
  onOpen = () => {},
  amountOf = () => undefined,
  onAmount = () => {},
  flush = () => {},
  onRefused = () => {},
  retryMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  clock = piClock,
} = {}) {
  let ws = null;
  let closed = false;
  let paused = false;
  let retry = null;
  let ping = null;
  let pings = 0;
  let learning = null; // {action, resolve, reject}: one MIDI LEARN at a time

  const send = (m) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  // timed adds the touch (page ms, if the hand said) and the send, on the
  // Pi's clock, once the page knows it.
  const timed = (m, touch) => {
    if (clock.ready) {
      if (Number.isFinite(touch)) m.touch = clock.toPi(touch);
      m.sent = clock.toPi(now());
    }
    return m;
  };
  const askClock = () => {
    if (closed || paused) return;
    send({ t: 'clock', c: now() });
    pings++;
    ping = setTimer(askClock, pings < PINGS_FIRST ? PING_FIRST_MS : PING_MS);
  };

  const offArm = surface.on('arm', ({ pad, v, at, touch }) => {
    const m = { t: 'press', pad, q: quantum(surface.division) };
    const x = Number.isFinite(v) ? v : amountOf(pad);
    if (Number.isFinite(x)) m.v = x;
    send(timed(m, touch ?? at));
  });
  // A pad's last amount, if one is waiting its turn, goes before its release.
  const offLet = surface.on('let', ({ pad, at, touch }) => { flush(pad); send(timed({ t: 'release', pad }, touch ?? at)); });

  function handle(m) {
    switch (m.t) {
      case 'hello':
        surface.setGrid({ lead: m.lead_ms ?? 0 });
        onNote('');
        // What's held on the Pi as this page arrives: exactly that.
        onHeld(m.held || []);
        break;
      case 'lead':
        surface.setGrid({ lead: m.ms ?? 0 });
        break;
      case 'at': {
        if (Number.isFinite(m.v)) onAmount(m.pad, m.v);
        if (m.move) break; // an amount moving: nothing pressed or let go
        const at = now() + (Number.isFinite(m.in_ms) ? m.in_ms : 0);
        const mine = surface.state(m.pad) !== 'idle';
        if (mine) surface.confirm(m.pad, !!m.on, at);
        // A pad sounding that this page holds is this hand's to draw; one
        // stopping is no one's any more.
        if (!mine || !m.on) onRemote(m.pad, !!m.on, at);
        break;
      }
      case 'clock':
        clock.take(m, now());
        break;
      case 'learned':
        if (learning && learning.action === m.action) { learning.resolve(m); learning = null; }
        break;
      case 'refused':
        if (m.learn != null) {
          if (learning) { learning.reject(new Error(m.why || 'nothing was played')); learning = null; }
          break;
        }
        onNote(refusal(m.pad, m.why));
        onRefused(m.pad);
        break;
      default:
    }
  }

  function open() {
    if (closed || paused || !WebSocketImpl) return;
    ws = new WebSocketImpl(url);
    ws.onopen = () => {
      // A new socket may be a Pi started again: learn its clock afresh.
      clock.reset();
      clearTimer(ping);
      pings = 0;
      askClock();
      onOpen();
    };
    ws.onmessage = (e) => {
      try { handle(JSON.parse(e.data)); } catch { /* not ours */ }
    };
    const sock = ws;
    ws.onclose = () => {
      if (learning) { learning.reject(new Error('the Pi went out of reach')); learning = null; }
      // A socket paused and replaced since: the new one's pings and its
      // retry are its own.
      if (ws !== sock) return;
      clearTimer(ping);
      if (closed || paused) return;
      // Out of reach: the pads still light, and say they aren't sounding.
      // Anything held is let go on the Pi by its own timeout.
      onNote('Not connected to the tape — the pads are silent');
      retry = setTimer(open, retryMs);
    };
  }
  open();

  return {
    /** set moves an amount: a held FX's, the bend's, or a mod's preview. */
    set(pad, v) { send(timed({ t: 'set', pad, v })); },
    /** press holds a pad by hand, not through the surface: the bend, at once. */
    press(pad, v) { send(timed({ t: 'press', pad, q: 'now', v })); },
    /** release lets go of the bend, or a mod's preview: its last amount first. */
    release(pad) { flush(pad); send(timed({ t: 'release', pad })); },
    /**
     * learn asks the Pi to bind the next note or CC from one of its
     * controllers (`port`, or any) to `action`. It resolves with
     * {action, port, midi} or rejects after the Pi's ten seconds.
     */
    learn(action, port = '') {
      learning?.reject(new Error('another pad was picked'));
      return new Promise((resolve, reject) => {
        learning = { action, resolve, reject };
        if (!ws || ws.readyState !== 1) { learning = null; reject(new Error('not connected to the Pi')); return; }
        send({ t: 'learn', action, port });
      });
    },
    cancelLearn() {
      if (!learning) return;
      learning.reject(new Error('cancelled'));
      learning = null;
      send({ t: 'learn_cancel' });
    },
    pause() {
      if (paused || closed) return;
      paused = true;
      clearTimer(retry);
      clearTimer(ping);
      send({ t: 'release_all' });
      const cur = ws;
      ws = null;
      try { cur?.close(); } catch { /* already gone */ }
    },
    resume() {
      if (!paused || closed) return;
      paused = false;
      open();
    },
    close() {
      closed = true;
      clearTimer(retry);
      clearTimer(ping);
      send({ t: 'release_all' });
      offArm();
      offLet();
      try { ws?.close(); } catch { /* already gone */ }
    },
  };
}
