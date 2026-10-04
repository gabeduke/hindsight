import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagRequest, asFlags } from './flags.js';

function fakeFetch(answer = { flags: [] }, status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    return { ok: status < 400, status, json: async () => answer };
  };
  f.calls = calls;
  return f;
}

test('add posts the frame and label', async () => {
  const f = fakeFetch({ flag: { id: 'r1', frame: 10 }, flags: [] });
  await flagRequest('jam a.wav', 'add', { frame: 10, label: 'drop' }, f);
  assert.equal(f.calls[0].url, '/api/take/flags?file=jam%20a.wav');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { frame: 10, label: 'drop' });
});

test('edit names the flag and sends only what changed', async () => {
  const f = fakeFetch();
  await flagRequest('jam.wav', 'edit', { id: 'r1', label: 'x' }, f);
  assert.equal(f.calls[0].url, '/api/take/flags?file=jam.wav&id=r1');
  assert.equal(f.calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { label: 'x' });
});

test('remove deletes by id with no body', async () => {
  const f = fakeFetch();
  await flagRequest('jam.wav', 'remove', { id: 'f480' }, f);
  assert.equal(f.calls[0].url, '/api/take/flags?file=jam.wav&id=f480');
  assert.equal(f.calls[0].init.method, 'DELETE');
  assert.equal(f.calls[0].init.body, undefined);
});

test('a failure throws the server message', async () => {
  const f = fakeFetch({ error: 'flag frame is past the end of the take' }, 400);
  await assert.rejects(flagRequest('jam.wav', 'add', { frame: 1e9 }, f), /past the end/);
});

test('asFlags fills in missing labels', () => {
  assert.deepEqual(asFlags([{ id: 'r1', frame: 5 }]), [{ id: 'r1', frame: 5, label: '' }]);
  assert.deepEqual(asFlags(null), []);
});
