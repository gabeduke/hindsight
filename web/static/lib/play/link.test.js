import { test } from 'node:test';
import assert from 'node:assert/strict';

import { connect, quantum, playURL } from './link.js';
import { Surface, ARMED, ON } from './surface.js';

/** A socket the test plays the Pi through. */
function fakeSockets() {
  const made = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      made.push(this);
    }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; }
    // The Pi says something.
    hear(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  return { FakeWS, made };
}

const surface = (over = {}) => new Surface({ bpm: 120, originMs: 0, division: '16th', ...over });

test('a pad goes to the Pi the moment it is touched and let go', () => {
  const { FakeWS, made } = fakeSockets();
  const s = surface();
  connect(s, { url: 'ws://pi/api/tapes/play', WebSocketImpl: FakeWS });
  s.press('stop', 10);
  s.release('stop', 20); // before it ever fired: still sent now, not on a line
  assert.deepEqual(made[0].sent, [
    { t: 'press', pad: 'stop', q: '16th' },
    { t: 'release', pad: 'stop' },
  ]);
});

test('the press carries the quantise switch', () => {
  assert.equal(quantum('off'), 'now');
  assert.equal(quantum('8th'), '8th');
  assert.equal(quantum('bar'), 'bar');
  const { FakeWS, made } = fakeSockets();
  const s = surface({ division: 'beat' });
  connect(s, { WebSocketImpl: FakeWS, url: 'x' });
  s.press('chop', 0);
  assert.equal(made[0].sent[0].q, 'beat');
});

test('the Pi\'s lead becomes the gap the player sees', () => {
  const { FakeWS, made } = fakeSockets();
  const s = surface();
  connect(s, { WebSocketImpl: FakeWS, url: 'x' });
  made[0].hear({ t: 'hello', pads: [], lead_ms: 230 });
  assert.equal(s.lead, 230);
  made[0].hear({ t: 'lead', ms: 250 });
  assert.equal(s.lead, 250);
  const fires = [];
  s.on('arm', (d) => fires.push(d.fireAt));
  s.press('break', 0);
  assert.deepEqual(fires, [250], 'heard by 250 at the earliest: that line');
});

test('when the Pi says a pad is heard, it lights then', () => {
  const { FakeWS, made } = fakeSockets();
  const s = surface();
  let clock = 1000;
  connect(s, { WebSocketImpl: FakeWS, url: 'x', now: () => clock });
  s.press('reverse', 1010); // the surface guesses the line at 1125
  made[0].hear({ t: 'at', pad: 'reverse', on: true, in_ms: 180, pos: 0 });
  s.tick(1130);
  assert.equal(s.state('reverse'), ARMED, 'the Pi said 1180, not 1125');
  s.tick(1181);
  assert.equal(s.state('reverse'), ON);
});

test('a refused press is said, and the Pi going quiet is said', () => {
  const { FakeWS, made } = fakeSockets();
  const notes = [];
  const timers = [];
  connect(surface(), { WebSocketImpl: FakeWS, url: 'x', onNote: (n) => notes.push(n), setTimer: (f) => timers.push(f) });
  made[0].hear({ t: 'refused', pad: 'stop', why: 'a mixdown is playing' });
  assert.equal(notes.at(-1), 'stop: a mixdown is playing');
  made[0].drop();
  assert.match(notes.at(-1), /silent/);
  // It tries again, and a hello clears the note.
  timers[0]();
  assert.equal(made.length, 2);
  made[1].hear({ t: 'hello', lead_ms: 200 });
  assert.equal(notes.at(-1), '');
});

test('closing lets go of everything on the Pi and stops listening', () => {
  const { FakeWS, made } = fakeSockets();
  const s = surface();
  const link = connect(s, { WebSocketImpl: FakeWS, url: 'x' });
  s.press('break', 0);
  link.close();
  assert.deepEqual(made[0].sent.at(-1), { t: 'release_all' });
  const n = made[0].sent.length;
  s.press('stop', 10);
  assert.equal(made[0].sent.length, n, 'nothing more is sent once closed');
  made[0].drop();
  assert.equal(made.length, 1, 'and it does not reconnect');
});

test('the socket is on the page\'s own host, secure when the page is', () => {
  assert.equal(playURL({ protocol: 'http:', host: 'pi.local:5000' }), 'ws://pi.local:5000/api/tapes/play');
  assert.equal(playURL({ protocol: 'https:', host: 'dukemon.example' }), 'wss://dukemon.example/api/tapes/play');
});
