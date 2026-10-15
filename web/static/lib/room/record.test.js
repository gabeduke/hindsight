import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutPlan, markBody, mixProgress, cutTakeRecord, cutTapeRecord, takeCover, tapeCover } from './record.js';
import { stripeOf } from '../objects/cassette-geom.js';

const SR = 48000;
const take = (more = {}) => ({ name: 'jam_a.wav', label: 'late night riff', duration_seconds: 60, sample_rate: SR, ...more });

// A fake Pi: answers each request from a list of [match, response] in turn,
// and keeps what was asked.
function fakePi(script) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    const step = script.shift();
    assert.ok(step, `unexpected request ${init.method || 'GET'} ${url}`);
    const [match, status, body] = step;
    assert.ok(url.startsWith(match), `${url} should start ${match}`);
    return { ok: status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test('a take with no selection short of the whole is marked as it is', () => {
  assert.deepEqual(cutPlan(take()), { cut: null });
  assert.deepEqual(cutPlan(take({ trim: { start_frame: 0, end_frame: 60 * SR } })), { cut: null });
  assert.deepEqual(cutPlan(take({ trim: { start_frame: SR, end_frame: 9 * SR } })), { cut: { start_frame: SR, end_frame: 9 * SR } });
  assert.deepEqual(markBody(3), { record: { side: 'A', cover: 3 } });
});

test('a take’s cover is its stripe: its tag’s colour, or its name’s', () => {
  assert.equal(takeCover(take({ tag: 't1' }), [{ id: 't1', name: 'bento', color: 7 }]), 7);
  assert.equal(takeCover(take(), []), stripeOf('jam_a.wav'));
  assert.equal(tapeCover('abc'), stripeOf('abc'));
});

test('cutting a record from a whole take marks the take, and only that', async () => {
  const pi = fakePi([['/api/take?file=jam_a.wav', 200, { record: { side: 'A', cover: 2 } }]]);
  const r = await cutTakeRecord(take(), { fetchImpl: pi.fetchImpl });
  assert.deepEqual(r, { name: 'jam_a.wav', cut: false });
  assert.deepEqual(pi.calls.map((c) => [c.method, c.body]), [['PATCH', { record: { side: 'A', cover: stripeOf('jam_a.wav') } }]]);
});

test('cutting a record from a selection cuts it first, then marks the cut', async () => {
  const pi = fakePi([
    ['/api/cut?file=jam_a.wav', 200, { name: 'jam_b.wav' }],
    ['/api/take?file=jam_b.wav', 200, {}],
  ]);
  const r = await cutTakeRecord(take({ trim: { start_frame: SR, end_frame: 9 * SR } }), { fetchImpl: pi.fetchImpl });
  assert.deepEqual(r, { name: 'jam_b.wav', cut: true });
  assert.deepEqual(pi.calls[0].body, { start_frame: SR, end_frame: 9 * SR, label: 'late night riff' });
  assert.equal(pi.calls[1].method, 'PATCH');
});

test('a refused cut marks nothing, and says why', async () => {
  const pi = fakePi([['/api/cut?file=jam_a.wav', 507, { error: 'low disk: 0.10 GB free, need 1.00 GB' }]]);
  await assert.rejects(cutTakeRecord(take({ trim: { start_frame: SR, end_frame: 9 * SR } }), { fetchImpl: pi.fetchImpl }), /low disk/);
  assert.equal(pi.calls.length, 1, 'no PATCH after a refused cut');
});

test('a mixdown’s progress, for the turntable', () => {
  const md = { id: 1, state: 'playing', from: 1000, to: 11000 };
  assert.deepEqual(mixProgress(md, 6000), { state: 'playing', frac: 0.5, words: 'Cutting · 50%' });
  assert.equal(mixProgress(md, 0).frac, 0);
  assert.equal(mixProgress({ ...md, state: 'tail' }).words, 'Letting it ring out');
  assert.equal(mixProgress({ ...md, state: 'failed', error: 'it was stopped' }).words, 'it was stopped');
  assert.equal(mixProgress(null).state, 'none');
});

test('cutting a record from a tape asks the Pi to mark the take it saves, and follows it there', async () => {
  const md = { id: 7, tape: 'tp', from: 0, to: 4 * SR, tail: SR };
  const pi = fakePi([
    ['/api/tapes/mixdown?id=tp', 200, { mixdown: { ...md, state: 'playing' } }],
    ['/api/tapes/state?id=tp', 200, { loaded: true, live: { heard: 2 * SR, mixdown: { ...md, state: 'playing' } } }],
    ['/api/tapes/state?id=tp', 503, {}], // a missed look asks again
    ['/api/tapes/state?id=tp', 200, { loaded: true, live: { heard: 4 * SR, mixdown: { ...md, state: 'tail' } } }],
    ['/api/tapes/state?id=tp', 200, { loaded: true, live: { heard: 4 * SR, mixdown: { ...md, state: 'saving' } } }],
    ['/api/tapes/state?id=tp', 200, { loaded: true, live: { heard: 4 * SR, mixdown: { ...md, state: 'done', take: 'jam_mix.wav' } } }],
  ]);
  const seen = [];
  const r = await cutTapeRecord('tp', { fetchImpl: pi.fetchImpl, sleep: async () => {}, onProgress: (p) => seen.push(p.state) });
  assert.deepEqual(r, { name: 'jam_mix.wav' });
  assert.deepEqual(seen, ['playing', 'playing', 'tail', 'saving', 'done']);
  // The mark goes with the mixdown, so it doesn't wait on this page: a cut
  // left halfway through, by SIT DOWN, still lands on the Records shelf.
  assert.deepEqual(pi.calls[0].body, { all: true, record: { side: 'A', cover: stripeOf('tp') } });
  assert.ok(!pi.calls.some((c) => c.method === 'PATCH'), 'the page marks nothing itself');
});

test('a failed mixdown marks nothing, and says why', async () => {
  const md = { id: 8, tape: 'tp', from: 0, to: SR, tail: 0 };
  const pi = fakePi([
    ['/api/tapes/mixdown?id=tp', 200, { mixdown: { ...md, state: 'playing' } }],
    ['/api/tapes/state?id=tp', 200, { loaded: true, live: { heard: 10, mixdown: { ...md, state: 'failed', error: 'it was stopped before the end; nothing was saved' } } }],
  ]);
  await assert.rejects(cutTapeRecord('tp', { fetchImpl: pi.fetchImpl, sleep: async () => {} }), /stopped before the end/);
  assert.ok(!pi.calls.some((c) => c.method === 'PATCH'), 'nothing was marked');
});

test('a mixdown the Pi won’t start marks nothing', async () => {
  const pi = fakePi([['/api/tapes/mixdown?id=tp', 409, { error: 'a punch is recording' }]]);
  await assert.rejects(cutTapeRecord('tp', { fetchImpl: pi.fetchImpl, sleep: async () => {} }), /a punch is recording/);
  assert.equal(pi.calls.length, 1);
});

test('another tape loaded mid-mixdown marks nothing', async () => {
  const md = { id: 9, tape: 'tp', from: 0, to: SR, tail: 0 };
  const pi = fakePi([
    ['/api/tapes/mixdown?id=tp', 200, { mixdown: { ...md, state: 'playing' } }],
    ['/api/tapes/state?id=tp', 200, { loaded: false, tape: { id: 'tp' } }],
  ]);
  await assert.rejects(cutTapeRecord('tp', { fetchImpl: pi.fetchImpl, sleep: async () => {} }), /another tape/);
  assert.ok(!pi.calls.some((c) => c.method === 'PATCH'));
});
