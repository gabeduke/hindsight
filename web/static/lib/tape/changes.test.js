import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisions, watchChanges, CHANGES_PATH } from './changes.js';

// The socket's reconnect and dead-socket rules are lib/socket.js's, tested
// through connectLive in lib/live.test.js. Here: what the page is told.
function rig() {
  const sockets = [];
  class WS {
    constructor(url) { this.url = url; sockets.push(this); }
    close() { this.closed = true; }
    say(m) { this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) }); }
  }
  const quiet = { addEventListener() {}, removeEventListener() {} };
  // Only the reconnect's wait is run, by hand (advance); the watch and the
  // wake tick never fire here.
  let t = 0, due = null;
  const clock = { advance(ms) { t += ms; if (due && due.at <= t) { const f = due.fn; due = null; f(); } } };
  const env = {
    WebSocket: WS, now: () => t,
    setTimeout: (fn, ms) => { due = { fn, at: t + ms }; return 1; }, clearTimeout() { due = null; },
    setInterval: () => 0, clearInterval() {},
    doc: { hidden: false, ...quiet }, win: quiet,
    location: { protocol: 'https:', host: 'pi.local' },
  };
  const nudges = [];
  const w = watchChanges((m) => nudges.push(m.rev), env);
  return { sockets, nudges, w, clock };
}

test('it watches /api/tapes/changes on the page\'s host', () => {
  const r = rig();
  assert.equal(CHANGES_PATH, '/api/tapes/changes');
  assert.equal(r.sockets[0].url, 'wss://pi.local/api/tapes/changes');
});

test('the first revision is taken as seen: the page polls as it opens the socket, and asks once, not twice', () => {
  const r = rig();
  r.sockets[0].say({ rev: 7, at_ms: 1 });
  assert.deepEqual(r.nudges, []);
});

test('a beat with the same revision says nothing; a new one nudges', () => {
  const r = rig();
  r.sockets[0].say({ rev: 7, at_ms: 1 });
  r.sockets[0].say({ rev: 7, at_ms: 1001 });
  r.sockets[0].say({ rev: 7, at_ms: 2001 });
  r.sockets[0].say({ rev: 9, at_ms: 2050 });
  assert.deepEqual(r.nudges, [9]);
});

test('a beat catches a nudge that was lost', () => {
  const r = rig();
  r.sockets[0].say({ rev: 3 });
  // rev 4's nudge never arrived; the next beat says 4.
  r.sockets[0].say({ rev: 4 });
  assert.deepEqual(r.nudges, [4]);
});

test('after a reconnect, a revision that moved while the socket was down is news', () => {
  const r = rig();
  r.sockets[0].say({ rev: 3 });
  r.sockets[0].onclose?.(); // lost; lib/socket.js makes another
  r.clock.advance(600);
  assert.equal(r.sockets.length, 2);
  r.sockets[1].say({ rev: 3 });
  assert.deepEqual(r.nudges, [], 'the same revision: nothing happened meanwhile');
  r.sockets[1].say({ rev: 5 });
  assert.deepEqual(r.nudges, [5]);
});

test('what isn\'t a revision is dropped', () => {
  const r = rig();
  r.sockets[0].say('not json');
  r.sockets[0].say({ t: 'hello' });
  r.sockets[0].say({ rev: '5' });
  assert.deepEqual(r.nudges, []);
});

test('a Pi that restarted, counting from nought again, still nudges', () => {
  const seen = revisions();
  assert.equal(revisions({ firstSeen: true })({ rev: 1 }), false, 'firstSeen takes the first as known');
  assert.equal(seen({ rev: 120 }), true);
  assert.equal(seen({ rev: 120 }), false);
  assert.equal(seen({ rev: 0 }), true);
});

test('close() lets the socket go', () => {
  const r = rig();
  r.w.close();
  assert.ok(r.sockets[0].closed);
});
