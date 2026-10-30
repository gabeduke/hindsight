import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTakes, POLL_MS, STALE_MS, PUSH_QUIET_MS } from './takes.js';
import { createProtocol } from './protocol.js';

// The takes are read through the page's protocol client: the route is its.
const JAMS_PATH = '/api/jams';
const over = (fetch) => createProtocol({ fetch });

// A Pi that answers /api/jams with `takes` under an ETag that moves when
// they do, and a 304 when If-None-Match is the one it has; each ask is
// logged, and held until let go when `hold` is set.
function pi(takes = [{ name: 'jam_a.wav' }]) {
  const p = { takes, tag: 1, asks: [], hold: false, waiting: [] };
  p.set = (next) => { p.takes = next; p.tag++; };
  p.fetch = (url, opts = {}) => {
    assert.equal(url, JAMS_PATH);
    const inm = opts.headers?.['If-None-Match'] ?? null;
    p.asks.push(inm);
    const answer = () => {
      const etag = `"${p.tag}"`;
      if (inm === etag) return { status: 304, ok: false, headers: { get: () => etag } };
      const body = p.takes;
      return { status: 200, ok: true, headers: { get: (h) => (h === 'ETag' ? etag : null) }, json: async () => body };
    };
    if (!p.hold) return Promise.resolve(answer());
    return new Promise((r) => p.waiting.push(() => r(answer())));
  };
  p.release = () => { const w = p.waiting.splice(0); for (const f of w) f(); };
  return p;
}

function rig(takes) {
  const p = pi(takes);
  let t = 0;
  const m = createTakes({ protocol: over(p.fetch), now: () => t });
  const flush = () => new Promise((r) => setImmediate(r));
  return { p, m, flush, advance: (ms) => { t += ms; } };
}

test('get asks once, then answers the list it holds while it is fresh', async () => {
  const { p, m, advance } = rig();
  assert.equal(m.list(), null);
  assert.deepEqual(await m.get(), [{ name: 'jam_a.wav' }]);
  assert.equal(m.etag, '"1"');
  await m.get();
  assert.equal(p.asks.length, 1, 'a second get inside POLL_MS asks nothing');
  advance(POLL_MS);
  await m.get();
  assert.deepEqual(p.asks, [null, '"1"'], 'an old list is asked for again, with its ETag');
});

test('asks never overlap: callers while one is out share the next', async () => {
  const { p, m, flush } = rig();
  p.hold = true;
  const a = m.refresh();
  const b = m.refresh();
  const c = m.refresh();
  await flush();
  assert.equal(p.asks.length, 1);
  p.release();
  await a;
  await flush();
  assert.equal(p.asks.length, 2, 'the ones asked while it was out ask once more, together');
  p.release();
  const [lb, lc] = await Promise.all([b, c]);
  assert.equal(lb, lc);
  assert.equal(p.asks.length, 2);
});

test('a refresh in the moment between an ask ending and the queued one starting joins the queued one', async () => {
  const { p, m, flush } = rig();
  p.hold = true;
  const a = m.refresh();
  const b = m.refresh();
  p.release();
  await a; // the first has ended; the queued one has not started yet
  const c = m.refresh();
  await flush();
  assert.equal(p.waiting.length, 1, 'one ask out, never two beside each other');
  p.release();
  assert.equal(await b, await c);
  assert.equal(p.asks.length, 2);
});

test('a list\'s age is timed from the ask, so a room\'s 5 s tick asks every tick, however long the Pi took to answer', async () => {
  const p = pi();
  let t = 0;
  const m = createTakes({ protocol: over(async (u, o) => { const r = await p.fetch(u, o); t += 300; return r; }), now: () => t });
  await m.get();          // asked at 0, answered at 300
  t = POLL_MS;            // the next tick
  await m.get();
  assert.equal(p.asks.length, 2);
});

test('onChange hears a list that changed, not a 304', async () => {
  const { p, m } = rig();
  const heard = [];
  m.onChange((l) => heard.push(l.map((t) => t.name)));
  await m.refresh();
  await m.refresh();
  assert.deepEqual(heard, [['jam_a.wav']], 'the 304 says nothing');
  p.set([{ name: 'jam_b.wav' }, { name: 'jam_a.wav' }]);
  await m.refresh();
  assert.deepEqual(heard.at(-1), ['jam_b.wav', 'jam_a.wav']);
  await m.refresh({ force: true });
  assert.equal(p.asks.at(-1), null, 'force leaves If-None-Match off');
  assert.equal(heard.length, 3, 'and is heard though nothing changed');
});

test('a takes_rev not heard before asks the Pi; the same one, or none, does not', async () => {
  const { p, m, flush } = rig();
  await m.get();
  m.heard({ rev: 4, takes_rev: 7 });
  await flush();
  assert.equal(p.asks.length, 2, 'the first word asks once: the list may predate the socket');
  m.heard({ rev: 5, takes_rev: 7 });
  m.heard({ rev: 6 });
  m.heard(null);
  await flush();
  assert.equal(p.asks.length, 2);
  p.set([{ name: 'jam_b.wav' }]);
  m.heard({ rev: 6, takes_rev: 8 });
  await flush();
  assert.equal(p.asks.length, 3);
  assert.deepEqual(m.list(), [{ name: 'jam_b.wav' }]);
  m.heard({ takes_rev: 0 });
  await flush();
  assert.equal(p.asks.length, 4, 'a Pi that restarted counts from nought: news too');
});

test('get asks every POLL_MS with no push, and only once the list is STALE_MS old while the push is heard', async () => {
  const { p, m, advance, flush } = rig();
  await m.get();
  advance(POLL_MS); await m.get();
  assert.equal(p.asks.length, 2, 'no push: as the pages polled');

  // The socket says its takes_rev each second.
  m.heard({ takes_rev: 1 }); await flush();
  const base = p.asks.length;
  for (let s = 0; s < STALE_MS / 1000 - 1; s++) {
    advance(1000);
    m.heard({ takes_rev: 1 });
    if (s % 5 === 4) await m.get();
  }
  assert.equal(p.asks.length, base, 'nothing asked while the push vouches for the list');
  advance(1000); m.heard({ takes_rev: 1 }); await m.get();
  assert.equal(p.asks.length, base + 1, 'a stale list is asked for even so');

  // The socket goes quiet: back to POLL_MS.
  assert.ok(POLL_MS > PUSH_QUIET_MS);
  advance(POLL_MS); await m.get(); // quiet for more than PUSH_QUIET_MS
  assert.equal(p.asks.length, base + 2);
});

test('find asks once more for a take the list it holds has not got', async () => {
  const { p, m } = rig();
  await m.get();
  p.set([{ name: 'jam_new.wav' }, { name: 'jam_a.wav' }]);
  assert.deepEqual(await m.find('jam_a.wav'), { name: 'jam_a.wav' });
  assert.equal(p.asks.length, 1, 'one it has is answered as held');
  assert.deepEqual(await m.find('jam_new.wav'), { name: 'jam_new.wav' });
  assert.equal(p.asks.length, 2);
  assert.equal(await m.find('jam_gone.wav'), null);
});

test('a failed ask throws to its caller and leaves the list as it was', async () => {
  const { m } = rig();
  await m.get();
  const before = m.list();
  const bad = createTakes({ protocol: over(async () => ({ status: 500, ok: false })) });
  await assert.rejects(bad.refresh(), /HTTP 500/);
  assert.equal(bad.list(), null);
  assert.equal(m.list(), before);
});

test('snapshot is the list and its version, frozen, and the same object until either moves', async () => {
  const { p, m, advance } = rig();
  const empty = m.snapshot();
  assert.deepEqual(empty, { v: null, list: null }, 'nothing before the first answer');
  assert.ok(Object.isFrozen(empty));
  await m.get();
  const first = m.snapshot();
  assert.notEqual(first, empty);
  assert.deepEqual(first, { v: '"1"', list: [{ name: 'jam_a.wav' }] });
  assert.equal(first.list, m.list(), 'list() and etag are its old names');
  assert.equal(first.v, m.etag);
  advance(POLL_MS);
  await m.get();
  assert.equal(p.asks.at(-1), '"1"');
  assert.equal(m.snapshot(), first, 'a 304 leaves the very same snapshot');
  p.set([{ name: 'jam_b.wav' }]);
  await m.refresh();
  assert.notEqual(m.snapshot(), first);
  assert.deepEqual(m.snapshot(), { v: '"2"', list: [{ name: 'jam_b.wav' }] });
});
