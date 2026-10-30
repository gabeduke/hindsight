// web/static/lib/tape/changes.js
// The Pi's word that the tape changed (docs/architecture/push.md).
//
// /api/tapes/changes sends {rev, at_ms}: the tape's revision, when the
// socket opens, the moment the tape changes, and once a second regardless.
// It is a nudge, not the state: a page that hears a new revision polls
// /api/tapes/state at once, through the poll it already has, instead of at
// its next tick. The poll stays as it was, as the fallback for a socket that
// is down. A beat whose revision differs from the last one heard catches a
// nudge that was lost; one that doesn't says nothing.
//
// The socket is kept open by lib/socket.js, with lib/live.js's reconnect
// and dead-socket rules: the beat is what keeps it from being taken for a
// dead one. A page holds one, the transport's (lib/models/transport.js),
// from the tape's mount to the page's end, whatever room is shown: a room
// switch neither closes it nor opens another (push.md, *One socket a
// page*).
//
// A press on the keyboard (docs/architecture/push.md, *The keyboard's press*)
// comes on it too, the moment it is made, under `press`: the banner's
// words, its role, what it lit and when its second began, by the Pi's
// clock. pressOf reads one; the bar shows it (lib/bar/press-note.js).
//
// Each message carries the take list's revision too, as takes_rev
// (docs/architecture/push.md, *The takes' revision*): onTakes hears every
// message that has one, beats included, and the page's takes model
// (lib/models/takes.js) says what is news and asks /api/jams.

import { connectSocket } from '../socket.js';

export const CHANGES_PATH = '/api/tapes/changes';

/** BANNER_MS is how long the keyboard's banner shows: surface.BannerFor. */
export const BANNER_MS = 1000;

/** ROLES are the colours a press is said in (internal/api/press.go). */
export const ROLES = Object.freeze(['play', 'stop', 'rec', 'verb', 'refused', 'mixer']);

/** LIT is what a press can light: ▶, ● and a track's head. */
export const LIT = Object.freeze(['play', 'rec', 'track']);

/**
 * pressOf is the press a message carries, as the page shows it, or null:
 * {words, role, lit, track, ms}, where ms is what is left of its second.
 * The second is timed by the Pi's clock, from the press to the message
 * leaving (both at_ms are the Pi's), so the note goes when the keyboard's
 * banner does, whatever this device's clock says. One whose second is over
 * says nothing. A role this page doesn't know is said as a verb.
 */
export function pressOf(m) {
  const p = m && m.press;
  if (!p || typeof p.words !== 'string' || !p.words) return null;
  const late = Number.isFinite(m.at_ms) && Number.isFinite(p.at_ms) ? Math.max(0, m.at_ms - p.at_ms) : 0;
  const ms = BANNER_MS - late;
  if (ms <= 0) return null;
  const track = Number.isInteger(p.track) && p.track > 0 ? p.track : 0;
  const lit = (Array.isArray(p.lit) ? p.lit : []).filter((l) => LIT.includes(l) && (l !== 'track' || track));
  return { words: p.words, role: ROLES.includes(p.role) ? p.role : 'verb', lit, track, ms };
}

/**
 * revisions answers, for each message, whether its revision is one not yet
 * heard. Any change is news, not only a higher number: a Pi that restarted
 * counts from nought again. With `firstSeen`, the first revision is taken
 * as known, not news.
 */
export function revisions({ firstSeen = false } = {}) {
  let last = null;
  let primed = firstSeen;
  return (m) => {
    if (!m || typeof m.rev !== 'number') return false;
    if (primed) { primed = false; last = m.rev; return false; }
    if (m.rev === last) return false;
    last = m.rev;
    return true;
  };
}

/**
 * watchChanges calls onNudge({rev, at_ms}) on each new revision,
 * onPress(press) (pressOf's) on each press on the keyboard, and onTakes(m)
 * on each message with a takes_rev, new or not (the beat is how the takes
 * model knows the push is there). The first
 * the socket says is taken as seen: whoever opens it polls as they do (the
 * transport, as it loads), and counting it as
 * news would ask the Pi twice. A change in the moment between that poll
 * and the socket's first word waits for the next poll, as it did before.
 * After a reconnect, a revision that moved while the socket was down is
 * news. Returns { close() }. The env is lib/socket.js's, for tests.
 */
export function watchChanges({ onNudge, onPress = null, onTakes = null }, env = {}) {
  const fresh = revisions({ firstSeen: true });
  return connectSocket(CHANGES_PATH, {
    onMessage: (m) => {
      const p = onPress ? pressOf(m) : null;
      if (p) onPress(p);
      if (onTakes && m && typeof m.takes_rev === 'number') onTakes(m);
      if (fresh(m)) onNudge(m);
    },
  }, env);
}
