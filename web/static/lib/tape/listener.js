// web/static/lib/tape/listener.js
// The tape on this phone, across pages. Pages are separate documents, so a
// page change drops the stream; the Pi waits 6 s before it stops the tape.
// This device remembers that it was the listener, and the next page -- the
// tape, Takes or Capture -- joins the stream again at once. Its sound waits
// for a tap there: a browser only lets a tap start it.

const KEY = 'tape.listener';

/** rememberListener notes, for the next page, whether this device listens. */
export function rememberListener(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* private mode: the next page asks again */ }
}

export function wasListener() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/**
 * rejoin starts `player` again when this device was the listener and the
 * tape still plays on a phone with nobody else listening. The page this
 * device left can hold its socket a moment, so a listener is asked about
 * again for a while. Still taken after that, the note stays: another device
 * that had it lets it go, and this one finds it again; one that has it while
 * this one listens moves it ('moved', which forgets). The Pi saying the tape
 * is in the jam room, or that there is none, forgets it.
 */
export async function rejoin(player, { tries = 8, gap = 400 } = {}) {
  if (!wasListener()) return false;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, gap));
    // Started by a tap meanwhile (OUT on the tape page): this device listens.
    if (player.active) return true;
    let list, l;
    try {
      list = await (await fetch('/api/tapes', { cache: 'no-store' })).json();
      if (list.loaded) l = (await (await fetch(`/api/tapes/state?id=${encodeURIComponent(list.loaded)}`, { cache: 'no-store' })).json()).live;
    } catch {
      continue; // the Pi didn't answer: ask again
    }
    if (player.active) return true;
    if (!list.loaded || !l || !l.output_mode || l.output_mode === 'jam') {
      rememberListener(false);
      return false;
    }
    if (l.stream && l.stream.listeners > 0) continue;
    // A failed start stops the player, and with it the note.
    try { await player.start({ rejoin: true }); } catch { return false; }
    return true;
  }
  return false;
}
