// The page's protocol client (lib/models/protocol.js): a read by noun, its
// version, and the one Refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProtocol, Refusal, NOUNS } from './protocol.js';

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
  assert.deepEqual(NOUNS, ['takes']);
  assert.deepEqual(await protocol.read('takes'), { ok: true, status: 200, v: '"7"', body: [{ name: 'a.wav' }] });
  assert.equal(asked[0].url, '/api/jams');
  assert.deepEqual(asked[0].init, { headers: {}, cache: 'no-store' });
  assert.deepEqual(await protocol.read('takes', { v: '"7"' }), { ok: false, status: 304, v: '"7"', body: null });
  assert.deepEqual(asked[1].init.headers, { 'If-None-Match': '"7"' });
});

test('a failed read answers its status, and a noun it does not read is a mistake', async () => {
  const { protocol } = pi(() => json(500, { error: 'disk' }));
  assert.deepEqual(await protocol.read('takes'), { ok: false, status: 500, v: null, body: null });
  await assert.rejects(protocol.read('tape'), /reads no tape/);
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
