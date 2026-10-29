// web/static/lib/tape/changes.js
// The Pi's word that the tape changed (docs/plan/pushing-tape-state.md).
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
// dead one. A view opens it on show and closes it on hide, as Capture does
// its meters' socket, so it is quiet in a room not shown.

import { connectSocket } from '../socket.js';

export const CHANGES_PATH = '/api/tapes/changes';

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
 * watchChanges calls onNudge({rev, at_ms}) on each new revision. The first
 * the socket says is taken as seen: whoever opens it polls as they do (the
 * Studio on show, the bar as it takes the tape back), and counting it as
 * news would ask the Pi twice. A change in the moment between that poll
 * and the socket's first word waits for the next poll, as it did before.
 * After a reconnect, a revision that moved while the socket was down is
 * news. Returns { close() }. The env is lib/socket.js's, for tests.
 */
export function watchChanges(onNudge, env = {}) {
  const fresh = revisions({ firstSeen: true });
  return connectSocket(CHANGES_PATH, { onMessage: (m) => { if (fresh(m)) onNudge(m); } }, env);
}
