// WebSocket client for the live level stream, with backoff reconnect.
//
// The server pushes real min/max peak bins (~100/s) rather than a single RMS
// scalar, which is what makes an actual waveform drawable on the client.
//
// A tablet that sleeps drops its socket without a close event: the page wakes
// holding a socket that still says OPEN and will never carry another frame.
// So a socket is also replaced when nothing has arrived on it for STALE_MS
// (frames come ~100 times a second, so that is long silence), and at once
// when the page comes back (lib/link.js onResume).

import { onResume } from './link.js';

export const STALE_MS = 4000; // no frame this long: the socket is dead, replace it
export const FRESH_MS = 1000; // a frame this recent on resume: the socket is fine
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 5000;
const WATCH_MS = 1000;

export function connectLive({ onFrame, onOpen, onClose }, env = {}) {
  const WS = env.WebSocket ?? globalThis.WebSocket;
  const now = env.now ?? Date.now;
  const wait = env.setTimeout ?? setTimeout;
  const unwait = env.clearTimeout ?? clearTimeout;
  const every = env.setInterval ?? setInterval;
  const stopEvery = env.clearInterval ?? clearInterval;
  const loc = env.location ?? globalThis.location;

  let ws = null;
  let backoff = BACKOFF_MIN;
  let closed = false;
  let timer = null;
  let heardAt = 0; // when this socket last opened or carried a frame

  function url() {
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}/api/live`;
  }

  // drop lets go of a socket for good: its late events are ignored.
  function drop(sock) {
    if (!sock) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try { sock.close(); } catch { /* already gone */ }
  }

  function open() {
    if (closed) return;
    if (timer) { unwait(timer); timer = null; }
    let sock;
    try {
      sock = new WS(url());
    } catch {
      return schedule();
    }
    ws = sock;
    heardAt = now();

    sock.onopen = () => {
      if (ws !== sock) return;
      backoff = BACKOFF_MIN;
      heardAt = now();
      onOpen?.();
    };

    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      heardAt = now();
      let f;
      try {
        f = JSON.parse(ev.data);
      } catch {
        return;
      }
      onFrame?.(f);
    };

    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      onClose?.();
      schedule();
    };

    sock.onerror = () => {
      try { sock.close(); } catch { /* the close handler follows */ }
    };
  }

  function schedule() {
    if (closed || timer) return;
    timer = wait(() => {
      timer = null;
      open();
    }, backoff);
    backoff = Math.min(Math.round(backoff * 1.8), BACKOFF_MAX);
  }

  // replace swaps the socket for a new one now, telling the page the old one
  // is lost, as its own close would have.
  function replace() {
    if (closed) return;
    const old = ws;
    ws = null;
    drop(old);
    if (old) onClose?.();
    backoff = BACKOFF_MIN;
    open();
  }

  open();

  // A silent socket -- one that never opened, or stopped carrying frames --
  // is as good as closed.
  const watch = every(() => {
    if (closed || !ws) return;
    if (now() - heardAt > STALE_MS) replace();
  }, WATCH_MS);

  const stopResume = onResume(() => {
    if (closed) return;
    // heardAt is also when the socket was made: one just made is let be.
    const healthy = ws && now() - heardAt < FRESH_MS;
    if (!healthy) replace();
  }, env);

  return {
    close() {
      closed = true;
      stopResume();
      stopEvery(watch);
      if (timer) unwait(timer);
      drop(ws);
    },
  };
}
