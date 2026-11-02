// The tape (lib/models/tape.js), with a stubbed Pi and timers that only run
// when told.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTape } from './tape.js';
import { createProtocol } from './protocol.js';

const tapeJSON = (over = {}) => ({
  id: 't1', name: 'Tape 1', sample_rate: 48000, length: 480000,
  grid: { frames: 480000, bars: 4 }, loop: { in: 0, out: 0, on: false }, tracks: [{ n: 1, clips: [{ id: 'c1' }] }], ...over,
});

let model = null;
afterEach(() => { model?.destroy(); model = null; });
const settle = () => new Promise((r) => setTimeout(r, 5));

// rig makes a tape on a Pi that answers each read with answer(url), and logs
// the verbs sent to it. Timers are held in `later` and run by the test.
function rig(answer, env = {}) {
  const r = { polls: [], sent: [], later: [], hidden: false, links: [] };
  r.fetch = async (url) => {
    r.polls.push(url);
    const b = answer(url);
    if (b instanceof Error) throw b;
    return { ok: b.status ? false : true, status: b.status || 200, json: async () => b };
  };
  r.send = async (url, o = {}) => {
    r.sent.push([o.method, url, o.body ? JSON.parse(o.body) : undefined]);
    return { ok: true, json: async () => (r.answer ? r.answer(url) : {}) };
  };
  r.run = () => { const l = r.later.splice(0); for (const f of l) f(); };
  model = r.m = createTape({
    protocol: createProtocol({ fetch: (u, o) => r.fetch(u, o), send: (u, o) => r.send(u, o), watch: () => ({ close() {} }) }),
    link: { ok: (w) => r.links.push(['ok', w]), fail: (w) => r.links.push(['fail', w]) },
    hidden: () => r.hidden,
    setTimeout: (f, ms) => { r.later.push(f); r.ms = ms; return r.later.length; },
    clearTimeout: () => {},
    ...env,
  });
  return r;
}

test('nothing is asked before load; load asks at once, and each answer is a new frozen snapshot', async () => {
  const r = rig(() => ({ loaded: true, tape: tapeJSON(), live: { heard: 0 } }));
  const heard = [];
  r.m.onChange((s) => heard.push(s));
  await r.m.refresh();
  assert.deepEqual(r.polls, []);
  assert.deepEqual(r.m.snapshot(), { v: 0, id: null, tape: null, live: null });
  r.m.load('t1');
  await settle();
  assert.deepEqual(r.polls, ['/api/tapes/state?id=t1']);
  const s = r.m.snapshot();
  assert.equal(s.tape.name, 'Tape 1');
  assert.equal(s.id, 't1');
  assert.ok(Object.isFrozen(s));
  assert.equal(r.m.snapshot(), s, 'the same object until the next answer');
  assert.deepEqual(heard, [s]);
  assert.deepEqual(r.links, [['ok', 'tape']]);
});

test('it asks at the quickest any reader wants, and nothing while out of view', async () => {
  const r = rig(() => ({ loaded: true, tape: tapeJSON(), live: null }));
  r.m.load('t1');
  await settle();
  r.m.every('bar', 500);
  assert.equal(r.ms, 500);
  r.m.every('studio', 200);
  assert.equal(r.ms, 200, 'the Studio shown: 200 ms');
  r.m.every('studio', null);
  assert.equal(r.ms, 500, 'hidden again: the bar\'s');
  const before = r.polls.length;
  r.run();
  await settle();
  assert.equal(r.polls.length, before + 1, 'one ask a tick: a tick of a rate since changed is dropped');
  r.hidden = true;
  r.run();
  await settle();
  assert.equal(r.polls.length, before + 1, 'out of view: nothing');
});

test('a change drops a poll it overtakes, and shows the tape its answer carries', async () => {
  let release;
  const r = rig(() => ({ loaded: true, tape: tapeJSON(), live: null }));
  r.m.load('t1');
  await settle();
  // A poll goes out; the change is sent and answered before it lands.
  r.fetch = (url) => new Promise((ok) => { r.polls.push(url); release = () => ok({ ok: true, status: 200, json: async () => ({ loaded: true, tape: tapeJSON({ name: 'old' }), live: null }) }); });
  const p = r.m.refresh();
  await settle();
  const b = await r.m.change(async () => ({ tape: tapeJSON({ name: 'new' }), live: null }));
  assert.equal(b.tape.name, 'new');
  assert.equal(r.m.snapshot().tape.name, 'new');
  release();
  await p;
  assert.equal(r.m.snapshot().tape.name, 'new', 'the poll from before the change is dropped');
  await assert.rejects(r.m.change(async () => { throw new Error('no'); }), /no/);
});

test('its verbs go to the Pi for the loaded tape, and a refusal is thrown', async () => {
  const r = rig(() => ({ loaded: true, tape: tapeJSON(), live: null }));
  r.m.load('t1');
  await settle();
  await r.m.record({ track: 1 });
  await r.m.punchOut();
  await r.m.cancelRecord();
  await r.m.catch({ pass: 1, track: 1 });
  r.answer = () => ({ loaded: true, tape: tapeJSON({ click: true }) });
  await r.m.setClick(true);
  assert.equal(r.m.snapshot().tape.click, true, 'the answer\'s tape is shown at once');
  assert.deepEqual(r.sent.map(([m, u]) => `${m} ${u}`), [
    'POST /api/tapes/record?id=t1', 'DELETE /api/tapes/record?id=t1', 'DELETE /api/tapes/record?id=t1&cancel=1',
    'POST /api/tapes/catch?id=t1', 'PATCH /api/tapes?id=t1',
  ]);
  r.send = async () => ({ ok: false, status: 409, json: async () => ({ error: 'nothing armed' }) });
  await assert.rejects(r.m.record({}), (e) => e.name === 'Refusal' && e.status === 409);
});

test('a tempo is suggested only for an empty tape with no grid', async () => {
  let tape = tapeJSON({ grid: null, tracks: [{ n: 1, clips: [] }] });
  const r = rig(() => ({ loaded: true, tape, live: null }));
  r.m.load('t1');
  await settle();
  await r.m.refresh();
  tape = tapeJSON(); // gridded: the ask after the answer that says so stops
  await r.m.refresh();
  await r.m.refresh();
  assert.deepEqual(r.polls, ['/api/tapes/state?id=t1', '/api/tapes/state?id=t1&suggest=1', '/api/tapes/state?id=t1&suggest=1', '/api/tapes/state?id=t1']);
});

test('another device loaded another tape: it follows, and no answer at all is the link failing', async () => {
  let loaded = 't1';
  const r = rig((url) => {
    if (url === '/api/tapes') return { loaded };
    const id = new URL(url, 'http://pi').searchParams.get('id');
    return { loaded: id === loaded, tape: tapeJSON({ id }), live: null };
  });
  r.m.load('t1');
  await settle();
  loaded = 't2';
  await r.m.refresh();
  assert.equal(r.m.id(), 't2');
  assert.equal(r.m.snapshot().tape.id, 't2');
  r.fetch = async () => { throw new TypeError('offline'); };
  await r.m.refresh();
  assert.deepEqual(r.links.at(-1), ['fail', 'tape']);
});
