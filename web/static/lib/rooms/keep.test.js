import { test } from 'node:test';
import assert from 'node:assert/strict';

import { keepTake, takeBack, flagNow } from './keep.js';

const answer = (status, body) => async (url, init) => {
  answer.last = { url, init };
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test('KEEP is Capture’s request: the last N seconds, as a take', async () => {
  const body = await keepTake(30, answer(200, { name: 'jam_1.wav', seconds: 30 }));
  assert.deepEqual(body, { name: 'jam_1.wav', seconds: 30 });
  assert.equal(answer.last.url, '/api/trigger?seconds=30');
  assert.equal(answer.last.init.method, 'POST');
  await keepTake(0, answer(200, { name: 'x' }));
  assert.equal(answer.last.url, '/api/trigger?seconds=0', '0 keeps the whole ring');
});

test('a full disk says so', async () => {
  await assert.rejects(keepTake(30, answer(507, { error: 'no space left' })), { message: 'Disk full — no space left' });
});

test('any other refusal says what the Pi said', async () => {
  await assert.rejects(keepTake(30, answer(503, { error: 'not recording' })), { message: 'Could not keep it: not recording' });
  await assert.rejects(keepTake(30, answer(500, null)), { message: 'Could not keep it: HTTP 500' });
});

test('no Pi at all is a message, not a crash', async () => {
  await assert.rejects(keepTake(30, async () => { throw new Error('Failed to fetch'); }), { message: 'Could not keep it: Failed to fetch' });
});

test('Undo puts the take in the trash', async () => {
  await takeBack('jam 1.wav', answer(200, {}));
  assert.equal(answer.last.url, '/api/delete?file=jam%201.wav');
  assert.equal(answer.last.init.method, 'DELETE');
  await assert.rejects(takeBack('x', answer(404, { error: 'no such take' })), { message: 'no such take' });
});

test('Flag now marks this moment, as Capture’s key does', async () => {
  await flagNow(answer(200, {}));
  assert.equal(answer.last.url, '/api/flag');
  assert.equal(answer.last.init.method, 'POST');
  await assert.rejects(flagNow(answer(409, { error: 'nothing buffered' })), { message: 'nothing buffered' });
  await assert.rejects(flagNow(answer(500, null)), { message: 'could not add the note' });
  await assert.rejects(flagNow(async () => { throw new Error('offline'); }), { message: 'could not add the note' });
});
