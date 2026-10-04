import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Uploader, encodeChunk, newRecordingId } from './uploader.js';

// A fake Pi on the far side of a fake WebSocket. It keeps the chunks it
// received, in order, acks like the server, and can drop the connection.
class FakePi {
  constructor() {
    this.got = new Map(); // seq -> first sample, for checking order and gaps
    this.next = 0;
    this.early = new Map();
    this.sockets = [];
    this.stopAt = -1;
    this.starts = [];
    this.ended = null;
  }
  get WS() {
    const pi = this;
    return class {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.bufferedAmount = 0;
        pi.sockets.push(this);
        queueMicrotask(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.(); } });
      }
      send(data) {
        if (this.readyState !== 1) throw new Error('send on a closed socket');
        if (typeof data === 'string') return pi.onText(this, JSON.parse(data));
        pi.onChunk(this, data);
      }
      close() { this.drop(); }
      drop() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        queueMicrotask(() => this.onclose?.());
      }
      reply(obj) { if (this.readyState === 1) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(obj) })); }
    };
  }
  onText(ws, m) {
    if (m.type === 'start') {
      this.starts.push(m);
      if (this.ended) return ws.reply(this.ended);
      return ws.reply({ type: 'ready', next: this.next });
    }
    if (m.type === 'stop') { this.stopAt = m.chunks; this.maybeEnd(ws); }
  }
  onChunk(ws, buf) {
    const dv = new DataView(buf);
    const seq = dv.getUint32(0, true);
    const first = dv.getFloat32(4, true);
    if (seq >= this.next) this.early.set(seq, first);
    while (this.early.has(this.next)) { this.got.set(this.next, this.early.get(this.next)); this.early.delete(this.next); this.next++; }
    ws.reply({ type: 'ack', next: this.next });
    this.maybeEnd(ws);
  }
  maybeEnd(ws) {
    if (this.stopAt >= 0 && this.next >= this.stopAt && !this.ended) {
      this.ended = { type: 'saved', name: 'jam_x.wav', seconds: this.next / 10, partial: false, reason: 'stop' };
      ws.reply(this.ended);
    }
  }
  get live() { return this.sockets[this.sockets.length - 1]; }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const chunk = (i) => new Float32Array([i, -i, i, -i]);

function makeUploader(pi, extra = {}) {
  const timers = [];
  const clock = { t: 1000 };
  const up = new Uploader({
    url: 'ws://pi/api/phone', rate: 48000, id: 'test-recording-1',
    WebSocketImpl: pi.WS, schedule: (fn) => timers.push(fn), now: () => clock.t, ...extra,
  });
  up.clock = clock;
  up.runTimers = () => { for (const fn of timers.splice(0)) fn(); };
  return up;
}

test('chunks go up in order and Stop resolves with the take', async () => {
  const pi = new FakePi();
  const up = makeUploader(pi);
  up.start();
  await tick(); await tick();
  for (let i = 0; i < 5; i++) up.push(chunk(i));
  await tick();
  const res = await up.stop();
  assert.equal(res.name, 'jam_x.wav');
  assert.deepEqual([...pi.got.keys()], [0, 1, 2, 3, 4]);
  assert.equal(pi.starts[0].id, 'test-recording-1');
  assert.equal(pi.starts[0].rate, 48000);
  assert.equal(up.queue.length, 0);
});

test('a dropout resends everything not acked, and nothing is lost', async () => {
  const pi = new FakePi();
  const states = [];
  const up = makeUploader(pi, { onState: (s) => states.push(s) });
  up.start();
  await tick(); await tick();
  up.push(chunk(0)); up.push(chunk(1));
  await tick();
  // The connection dies with chunks 2 and 3 sent but never received.
  const dead = pi.live;
  dead.send = () => {};
  up.push(chunk(2)); up.push(chunk(3));
  dead.drop();
  await tick();
  assert.ok(states.includes('reconnecting'));
  up.push(chunk(4)); // recorded while offline: queued
  up.runTimers();    // the retry
  await tick(); await tick(); await tick();
  const res = await up.stop();
  assert.equal(res.name, 'jam_x.wav');
  assert.deepEqual([...pi.got.keys()], [0, 1, 2, 3, 4]);
  assert.equal(pi.starts.length, 2);
  assert.equal(pi.starts[1].id, pi.starts[0].id, 'the same recording, resumed');
});

test('Stop while offline is sent once the Pi is back', async () => {
  const pi = new FakePi();
  const up = makeUploader(pi);
  up.start();
  await tick(); await tick();
  up.push(chunk(0));
  await tick();
  pi.live.drop();
  await tick();
  up.push(chunk(1));
  const done = up.stop();
  up.runTimers();
  await tick(); await tick(); await tick();
  const res = await done;
  assert.equal(res.name, 'jam_x.wav');
  assert.deepEqual([...pi.got.keys()], [0, 1]);
});

test('the Pi ending the recording itself is reported', async () => {
  const pi = new FakePi();
  let ended = null;
  const up = makeUploader(pi, { onEnd: (r) => { ended = r; } });
  up.start();
  await tick(); await tick();
  up.push(chunk(0));
  await tick();
  pi.live.reply({ type: 'saved', name: 'jam_y.wav', seconds: 1, partial: false, reason: 'disk' });
  await tick();
  assert.equal(ended.reason, 'disk');
  up.push(chunk(1)); // ignored: the recording is over
  assert.equal(up.queue.length, 0);
  assert.equal(up.seq, 1);
});

test('a refused start fails without retrying', async () => {
  const pi = new FakePi();
  pi.onText = (ws, m) => { if (m.type === 'start') ws.reply({ type: 'error', error: 'the Pi\'s disk is nearly full' }); };
  const up = makeUploader(pi);
  up.start();
  const res = await up.whenEnded();
  assert.match(res.error, /disk/);
  up.runTimers();
  assert.equal(pi.sockets.length, 1);
});

test('encodeChunk is a uint32 LE number then LE float32 samples', () => {
  const buf = encodeChunk(258, new Float32Array([0.5, -1]));
  const dv = new DataView(buf);
  assert.equal(buf.byteLength, 12);
  assert.equal(dv.getUint32(0, true), 258);
  assert.equal(dv.getFloat32(4, true), 0.5);
  assert.equal(dv.getFloat32(8, true), -1);
});

test('recording ids match what the Pi accepts', () => {
  const id = newRecordingId();
  assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(id, newRecordingId());
});

test('start names the oldest chunk still held, so a Pi that restarted can carry on', async () => {
  const pi = new FakePi();
  const up = makeUploader(pi);
  up.start();
  await tick(); await tick();
  for (let i = 0; i < 3; i++) up.push(chunk(i));
  await tick();
  assert.equal(pi.starts[0].first, 0);
  // The Pi restarts: it forgets everything, and the phone still holds 3 and 4.
  const dead = pi.live;
  dead.send = () => {};
  up.push(chunk(3)); up.push(chunk(4));
  dead.drop();
  const fresh = new FakePi();
  fresh.next = 0;
  // The new Pi starts a take at the chunk the phone names.
  fresh.onText = function (ws, m) {
    if (m.type === 'start') { this.starts.push(m); this.next = m.first; return ws.reply({ type: 'ready', next: m.first }); }
    if (m.type === 'stop') { this.stopAt = m.chunks; this.maybeEnd(ws); }
  };
  up.WS = fresh.WS;
  await tick();
  up.runTimers();
  await tick(); await tick(); await tick();
  assert.equal(fresh.starts[0].first, 3);
  const res = await up.stop();
  assert.equal(res.name, 'jam_x.wav');
  assert.deepEqual([...fresh.got.keys()], [3, 4]);
});

test('a connection that goes quiet with audio outstanding is replaced', async () => {
  const pi = new FakePi();
  const up = makeUploader(pi);
  up.start();
  await tick(); await tick();
  const quiet = pi.live;
  quiet.send = () => {}; // half-open: sends vanish, nothing comes back
  up.push(chunk(0));
  up.clock.t += 11000;
  up.runTimers(); // the watchdog
  await tick();
  up.runTimers(); // the reconnect
  await tick(); await tick(); await tick();
  assert.equal(pi.sockets.length, 2, 'a new connection');
  assert.ok(pi.got.has(0), 'chunk 0 resent on it');
});
