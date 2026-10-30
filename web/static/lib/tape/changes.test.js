import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisions, watchChanges, pressOf, CHANGES_PATH, BANNER_MS } from './changes.js';

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
  const nudges = [], presses = [], takes = [];
  const w = watchChanges({ onNudge: (m) => nudges.push(m.rev), onPress: (p) => presses.push(p), onTakes: (m) => takes.push(m.takes_rev) }, env);
  return { sockets, nudges, presses, takes, w, clock };
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

test('every message with a takes_rev is handed to onTakes, beats and the first included: the takes model says what is news', () => {
  const r = rig();
  r.sockets[0].say({ rev: 7, takes_rev: 2 });
  r.sockets[0].say({ rev: 7, takes_rev: 2 });
  r.sockets[0].say({ rev: 8, takes_rev: 3 });
  r.sockets[0].say({ rev: 9 }); // a Pi from before the takes' revision
  assert.deepEqual(r.takes, [2, 2, 3]);
  assert.deepEqual(r.nudges, [8, 9], 'and the tape\'s nudges are as they were');
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

test('a press on the keyboard is heard with what is left of its second, by the Pi\'s clock', () => {
  const r = rig();
  r.sockets[0].say({ rev: 7, at_ms: 1 });
  r.sockets[0].say({ rev: 8, at_ms: 5040, press: { words: 'PLAY', role: 'play', lit: ['play'], at_ms: 5000 } });
  assert.deepEqual(r.presses, [{ words: 'PLAY', role: 'play', lit: ['play'], track: 0, ms: BANNER_MS - 40 }]);
  assert.deepEqual(r.nudges, [8], 'the revision it moved is a nudge as well');
});

test('a press with the revision unchanged is heard, and nudges nothing', () => {
  const r = rig();
  r.sockets[0].say({ rev: 7, at_ms: 1 });
  r.sockets[0].say({ rev: 7, at_ms: 10, press: { words: 'NO TRACK ARMED', role: 'refused', lit: [], at_ms: 10 } });
  assert.equal(r.presses.length, 1);
  assert.equal(r.presses[0].role, 'refused');
  assert.deepEqual(r.nudges, []);
});

test('pressOf: a second already over says nothing; what it lit is what the page can light', () => {
  assert.equal(pressOf({ rev: 1, at_ms: 3000, press: { words: 'KEPT 30 S', role: 'rec', lit: ['rec'], at_ms: 1900 } }), null);
  assert.equal(pressOf({ rev: 1, at_ms: 1 }), null);
  assert.equal(pressOf({ rev: 1, press: { words: '' } }), null);
  assert.deepEqual(
    pressOf({ rev: 1, at_ms: 100, press: { words: 'DROPPED ON T2', role: 'verb', lit: ['track', 'lamp'], track: 2, at_ms: 100 } }),
    { words: 'DROPPED ON T2', role: 'verb', lit: ['track'], track: 2, ms: BANNER_MS },
  );
  assert.deepEqual(pressOf({ press: { words: 'X', role: 'new', lit: ['track'] } }).lit, [], 'a track lit with no track is nothing');
  assert.equal(pressOf({ press: { words: 'X', role: 'new' } }).role, 'verb');
});
