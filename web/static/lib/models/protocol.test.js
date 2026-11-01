// The page's protocol client (lib/models/protocol.js): a read by noun, its
// version, and the one Refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtocol, Refusal, NOUNS, VERB_NAMES } from './protocol.js';

function pi(answer) {
  const asked = [];
  const fetch = async (url, init) => { asked.push({ url, init }); return answer(url, init); };
  return { asked, protocol: createProtocol({ fetch }) };
}
const json = (status, body, etag = null) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h === 'ETag' ? etag : null) },
  json: async () => body,
});

test('the takes are read from /api/jams, with their version (the ETag) asked as If-None-Match', async () => {
  const { asked, protocol } = pi((u, o) => (o.headers['If-None-Match'] === '"7"' ? json(304, null, '"7"') : json(200, [{ name: 'a.wav' }], '"7"')));
  assert.deepEqual(NOUNS, ['takes', 'tape', 'tapes']);
  assert.deepEqual(await protocol.read('takes'), { ok: true, status: 200, v: '"7"', body: [{ name: 'a.wav' }] });
  assert.equal(asked[0].url, '/api/jams');
  assert.deepEqual(asked[0].init, { headers: {}, cache: 'no-store' });
  assert.deepEqual(await protocol.read('takes', { v: '"7"' }), { ok: false, status: 304, v: '"7"', body: null });
  assert.deepEqual(asked[1].init.headers, { 'If-None-Match': '"7"' });
});

test('a failed read answers its status, and a noun it does not read is a mistake', async () => {
  const { protocol } = pi(() => json(500, { error: 'disk' }));
  assert.deepEqual(await protocol.read('takes'), { ok: false, status: 500, v: null, body: null });
  await assert.rejects(protocol.read('rig'), /reads no rig/);
});

test('the tape is read for its id, and given up on after 4 s', async () => {
  const asked = [];
  const protocol = createProtocol({ fetch: async (url, init, ms) => { asked.push([url, ms]); return json(200, { loaded: true }); } });
  assert.deepEqual((await protocol.read('tape', { id: 'a b' })).body, { loaded: true });
  await protocol.read('tapes');
  assert.deepEqual(asked, [['/api/tapes/state?id=a%20b', 4000], ['/api/tapes', undefined]]);
});

test('the transport\'s verbs are sent to their routes, for the tape, and answer the Pi\'s body', async () => {
  const sent = [];
  const protocol = createProtocol({ send: async (url, init) => { sent.push([init.method, url, init.body && JSON.parse(init.body)]); return json(200, { status: 'queued' }); } });
  assert.deepEqual(VERB_NAMES, ['transport.play', 'transport.stop', 'transport.locate', 'transport.setLoop', 'transport.setOutput', 'transport.setTempo', 'transport.setBars', 'transport.tapLoop', 'transport.tapCancel']);
  assert.deepEqual(await protocol.verb('transport', 'locate', { pos: 10 }, { id: 't1' }), { status: 'queued' });
  await protocol.verb('transport', 'setOutput', { mode: 'phone' }, { id: 't1' });
  await protocol.verb('transport', 'tapCancel', {}, { id: 't1' });
  assert.deepEqual(sent, [
    ['POST', '/api/tapes/transport?id=t1', { action: 'locate', pos: 10 }],
    ['PUT', '/api/tapes/output', { mode: 'phone' }],
    ['DELETE', '/api/tapes/tap?id=t1', undefined],
  ]);
  await assert.rejects(protocol.verb('transport', 'fly'), /sends no transport.fly/);
});

test('a verb the Pi refuses throws its Refusal, and one it could not be asked throws offline', async () => {
  const no = createProtocol({ send: async () => json(409, { error: 'edits wait', reason: 'recording' }) });
  await assert.rejects(no.verb('transport', 'setTempo', { bpm: 90 }, { id: 't1' }), (e) => e instanceof Refusal && e.recording && e.code === 'recording' && e.message === 'edits wait' && e.status === 409);
  const gone = createProtocol({ send: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(gone.verb('transport', 'play', {}, { id: 't1' }), (e) => e instanceof Refusal && e.code === 'offline');
});

test('a Refusal says its code, never only its words', () => {
  const r = new Refusal({ message: 'arm a track first', code: 'not_armed', words: 'NO TRACK ARMED', status: 409 });
  assert.ok(r instanceof Error);
  assert.equal(r.name, 'Refusal');
  assert.deepEqual([r.message, r.code, r.words, r.status], ['arm a track first', 'not_armed', 'NO TRACK ARMED', 409]);
  assert.equal(new Refusal({ status: 409, reason: 'recording', recording: true }).code, 'recording', 'today’s reason is its code');
  assert.equal(new Refusal({ status: 500 }).code, 'http_500');
  assert.equal(new Refusal({ code: 'offline', message: 'Failed to fetch' }).code, 'offline');
});
