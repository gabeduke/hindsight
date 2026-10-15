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
// Like the keyboard and touch adapters, this knows nothing of the DOM; the
// socket is passed in, so it is tested against a fake one.

/** The Pi's name for each quantise setting. */
const QUANTA = { off: 'now', '16th': '16th', '8th': '8th', beat: 'beat', bar: 'bar' };

export function quantum(division) {
  return QUANTA[division] ?? '16th';
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
 * Pi out of reach.
 */
export function connect(surface, {
  url = playURL(),
  WebSocketImpl = globalThis.WebSocket,
  now = () => performance.now(),
  onNote = () => {},
  retryMs = 1000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let ws = null;
  let closed = false;
  let retry = null;

  const send = (m) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  };

  const offArm = surface.on('arm', ({ pad }) => send({ t: 'press', pad, q: quantum(surface.division) }));
  const offLet = surface.on('let', ({ pad }) => send({ t: 'release', pad }));

  function handle(m) {
    switch (m.t) {
      case 'hello':
        surface.setGrid({ lead: m.lead_ms ?? 0 });
        onNote('');
        break;
      case 'lead':
        surface.setGrid({ lead: m.ms ?? 0 });
        break;
      case 'at':
        if (Number.isFinite(m.in_ms)) surface.confirm(m.pad, !!m.on, now() + m.in_ms);
        break;
      case 'refused':
        onNote(`${m.pad}: ${m.why}`);
        break;
      default:
    }
  }

  function open() {
    if (closed || !WebSocketImpl) return;
    ws = new WebSocketImpl(url);
    ws.onmessage = (e) => {
      try { handle(JSON.parse(e.data)); } catch { /* not ours */ }
    };
    ws.onclose = () => {
      if (closed) return;
      // Out of reach: the pads still light, and say they aren't sounding.
      // Anything held is let go on the Pi by its own timeout.
      onNote('Not connected to the tape — the pads are silent');
      retry = setTimer(open, retryMs);
    };
  }
  open();

  return {
    close() {
      closed = true;
      clearTimer(retry);
      send({ t: 'release_all' });
      offArm();
      offLet();
      try { ws?.close(); } catch { /* already gone */ }
    },
  };
}
