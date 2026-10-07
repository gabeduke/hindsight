import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectLive, STALE_MS } from './live.js';

// A clock the test moves by hand (the same as link.test.js's).
function fakeClock() {
  let t = 0, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimeout: (i) => timers.delete(i),
    setInterval: (fn, ms) => { timers.set(++id, { fn, at: t + ms, every: ms }); return id; },
    clearInterval: (i) => timers.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [i, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [i, x];
        if (!next) break;
        const [i, x] = next;
        t = x.at;
        if (x.every) x.at += x.every; else timers.delete(i);
        x.fn();
      }
      t = end;
    },
    // The page was frozen: time passes, and a timer due meanwhile runs once
    // when the page is back, not once for every tick it missed.
    freeze(ms) { t += ms; for (const x of timers.values()) x.at = Math.max(x.at, t); },
  };
}

function rig() {
  const clock = fakeClock();
  const sockets = [];
  class WS {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.closed = false; sockets.push(this); }
    close() { this.closed = true; this.readyState = 3; }
    // What the network does.
    open() { this.readyState = 1; this.onopen?.(); }
    frame(f = { bins: [] }) { this.onmessage?.({ data: JSON.stringify(f) }); }
    die() { this.readyState = 3; this.onclose?.(); }
  }
  const listeners = {};
  const on = (prefix) => (t, f) => { (listeners[`${prefix}:${t}`] ??= new Set()).add(f); };
  const off = (prefix) => (t, f) => listeners[`${prefix}:${t}`]?.delete(f);
  const doc = { hidden: false, addEventListener: on('doc'), removeEventListener: off('doc') };
  const win = { addEventListener: on('win'), removeEventListener: off('win') };
  const emit = (k) => { for (const f of [...(listeners[k] ?? [])]) f({}); };
  const log = { frames: [], opens: 0, closes: 0 };
  const env = { ...clock, WebSocket: WS, doc, win, location: { protocol: 'http:', host: 'pi.local' } };
  const live = connectLive({
    onFrame: (f) => log.frames.push(f),
    onOpen: () => { log.opens++; },
    onClose: () => { log.closes++; },
  }, env);
  return { clock, sockets, emit, log, live };
}

test('connects to /api/live on the page\'s host', () => {
  const r = rig();
  assert.equal(r.sockets.length, 1);
  assert.equal(r.sockets[0].url, 'ws://pi.local/api/live');
});

test('a closed socket is reopened after 0.5 s, then backs off to at most 5 s', () => {
  const r = rig();
  r.sockets[0].open();
  r.sockets[0].die();
  assert.equal(r.sockets.length, 1);
  r.clock.advance(499);
  assert.equal(r.sockets.length, 1);
  r.clock.advance(2);
  assert.equal(r.sockets.length, 2);
  // Failing every time: the waits grow, and stop growing at 5 s.
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    const n = r.sockets.length;
    r.sockets[n - 1].die();
    let waited = 0;
    while (r.sockets.length === n) { r.clock.advance(100); waited += 100; }
    gaps.push(waited);
  }
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), `non-decreasing: ${gaps}`);
  assert.equal(Math.max(...gaps), 5000);
});

test('an open resets the backoff', () => {
  const r = rig();
  for (let i = 0; i < 4; i++) { r.sockets.at(-1).die(); r.clock.advance(6000); }
  r.sockets.at(-1).open();
  r.sockets.at(-1).die();
  const n = r.sockets.length;
  r.clock.advance(501);
  assert.equal(r.sockets.length, n + 1);
});

test('frames reach the page', () => {
  const r = rig();
  r.sockets[0].open();
  r.sockets[0].frame({ bins: [1] });
  assert.deepEqual(r.log.frames, [{ bins: [1] }]);
});

test('a socket that says OPEN but goes silent is replaced', () => {
  const r = rig();
  r.sockets[0].open();
  r.sockets[0].frame();
  r.clock.advance(STALE_MS - 500); // quiet, but not long enough to say
  assert.equal(r.sockets.length, 1);
  r.clock.advance(2000);
  assert.equal(r.sockets.length, 2);
  assert.ok(r.sockets[0].closed, 'the dead socket is let go of');
  assert.equal(r.log.closes, 1, 'the page is told it was lost');
});

test('a socket that carries frames is left alone', () => {
  const r = rig();
  r.sockets[0].open();
  for (let i = 0; i < 30; i++) { r.clock.advance(1000); r.sockets[0].frame(); }
  assert.equal(r.sockets.length, 1);
});

test('a socket that never opens is replaced', () => {
  const r = rig();
  r.clock.advance(STALE_MS + 2000);
  assert.ok(r.sockets.length >= 2);
});

test('after a sleep with no events, the next tick replaces the dead socket', () => {
  const r = rig();
  r.sockets[0].open();
  r.sockets[0].frame();
  r.clock.freeze(10 * 60 * 1000); // timers frozen, socket silently dead
  r.clock.advance(1000);
  assert.equal(r.sockets.length, 2);
});

test('coming back into view replaces a socket that is not carrying frames, at once', () => {
  const r = rig();
  r.sockets[0].open();
  r.sockets[0].frame();
  r.clock.advance(2000);
  r.emit('doc:visibilitychange');
  assert.equal(r.sockets.length, 2, 'no waiting for the stale timeout');
});

test('coming back into view leaves a socket that has just carried a frame', () => {
  const r = rig();
  r.sockets[0].open();
  r.clock.advance(100);
  r.sockets[0].frame();
  r.emit('doc:visibilitychange');
  r.emit('win:pageshow');
  assert.equal(r.sockets.length, 1);
});

test('coming back online replaces a socket waiting out a long backoff', () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { r.sockets.at(-1).die(); r.clock.advance(6000); }
  const n = r.sockets.length;
  r.sockets.at(-1).die();
  r.emit('win:online');
  assert.equal(r.sockets.length, n + 1);
});

test('events from a replaced socket do not start a second connection', () => {
  const r = rig();
  const old = r.sockets[0];
  old.open();
  r.clock.advance(STALE_MS + 1500);
  assert.equal(r.sockets.length, 2);
  r.sockets[1].open();
  old.die(); // its late close, after it was replaced
  old.frame();
  for (let i = 0; i < 5; i++) { r.clock.advance(1000); r.sockets[1].frame(); }
  assert.equal(r.sockets.length, 2);
  assert.equal(r.log.frames.length, 5, 'only the new socket\'s frames');
});

test('close() stops everything', () => {
  const r = rig();
  r.sockets[0].open();
  r.live.close();
  assert.ok(r.sockets[0].closed);
  r.emit('doc:visibilitychange');
  r.clock.advance(60000);
  assert.equal(r.sockets.length, 1);
});
