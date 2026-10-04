import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagRequest, asFlags, newFlagId } from './flags.js';

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
  const sent = JSON.parse(f.calls[0].init.body);
  assert.match(sent.id, /^r[0-9a-f]{8}$/);
  assert.deepEqual({ ...sent, id: undefined }, { id: undefined, frame: 10, label: 'drop' });
});

test('add sends the id it is given', async () => {
  const f = fakeFetch();
  await flagRequest('jam.wav', 'add', { id: 'r0000abcd', frame: 1 }, f);
  assert.equal(JSON.parse(f.calls[0].init.body).id, 'r0000abcd');
});

test('newFlagId makes distinct server-shaped ids', () => {
  const ids = new Set(Array.from({ length: 200 }, newFlagId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^r[0-9a-f]{8}$/);
});

test('requests for one take go out in order, each after the last answered', async () => {
  const log = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const f = async (url, init) => {
    log.push(`start ${init.method}`);
    if (init.method === 'POST') await slow;
    log.push(`end ${init.method}`);
    return { ok: true, status: 200, json: async () => ({ flags: [] }) };
  };
  const a = flagRequest('jam.wav', 'add', { id: 'r00000001', frame: 1 }, f);
  const b = flagRequest('jam.wav', 'edit', { id: 'r00000001', label: 'x' }, f);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, ['start POST']);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(log, ['start POST', 'end POST', 'start PATCH', 'end PATCH']);
});

test('a failed request does not block the next one', async () => {
  let n = 0;
  const f = async () => {
    n++;
    if (n === 1) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
    return { ok: true, status: 200, json: async () => ({ flags: [] }) };
  };
  await assert.rejects(flagRequest('jam.wav', 'remove', { id: 'r1' }, f), /boom/);
  await flagRequest('jam.wav', 'remove', { id: 'r2' }, f);
  assert.equal(n, 2);
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
