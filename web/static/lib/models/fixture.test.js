// A protocol client with no Pi (lib/models/fixture.js), and the models made
// over it from the saved answers in testdata/protocol/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, fixtureModels, MODELS } from './fixture.js';
import { Refusal } from './protocol.js';

const saved = (path) => JSON.parse(readFileSync(new URL(`../../../../testdata/protocol/${path}`, import.meta.url), 'utf8'));

test('a read answers the snapshot and its version, a 304 for the version held, and a 404 for a noun it hasn’t', async () => {
  const fx = fixture({ takes: saved('takes/three.json') });
  const r = await fx.read('takes');
  assert.equal(r.ok, true);
  assert.equal(r.body.length, 3);
  assert.match(r.v, /^"fx-takes-\d+"$/);
  assert.deepEqual(await fx.read('takes', { v: r.v }), { ok: false, status: 304, v: r.v, body: null });
  assert.deepEqual(await fx.read('rig'), { ok: false, status: 404, v: null, body: null });
  r.body[0].name = 'changed by a caller';
  assert.notEqual((await fx.read('takes')).body[0].name, 'changed by a caller', 'what it answers is a copy');
});

test('a verb is recorded, and answered or refused as scripted', async () => {
  const fx = fixture({}, { refuse: { play: 'no_audio_out', 'tape.setLoop': { code: 'recording', message: 'Waiting for rec to finish', reason: 'recording', recording: true } }, answers: { stop: { ok: 1 } } });
  assert.deepEqual(await fx.verb('transport', 'stop'), { ok: 1 });
  await assert.rejects(fx.verb('transport', 'play'), (e) => e instanceof Refusal && e.code === 'no_audio_out');
  await assert.rejects(fx.verb('tape', 'setLoop', { on: true }), (e) => e.recording && e.code === 'recording');
  assert.deepEqual(fx.calls.map((c) => `${c.noun}.${c.name}`), ['transport.stop', 'transport.play', 'tape.setLoop']);
});

test('set moves a snapshot and its version, and the socket says so', async () => {
  const fx = fixture({ takes: [], tape: saved('tape/stopped.json') });
  const heard = [];
  const sock = fx.watch({ onTakes: (m) => heard.push(['takes', m.takes_rev]), onNudge: (m) => heard.push(['tape', m.rev]), onPress: (p) => heard.push(['press', p.words]) });
  const before = (await fx.read('takes')).v;
  fx.set('takes', saved('takes/three.json'));
  fx.set('tape', saved('tape/no-tempo.json'));
  fx.press({ words: 'PLAY' });
  assert.notEqual((await fx.read('takes')).v, before);
  assert.deepEqual(heard.map(([k]) => k), ['takes', 'tape', 'press']);
  sock.close();
  fx.set('takes', []);
  assert.equal(heard.length, 3, 'a closed socket hears nothing');
});

test('the takes model, made over a fixture, holds its list and hears it move', async () => {
  const fx = fixture({ takes: saved('takes/three.json') });
  const { models, ready, stop } = fixtureModels(fx, ['takes']);
  await ready;
  assert.equal(models.takes.snapshot().list.length, 3);
  const was = models.takes.snapshot();
  fx.set('takes', saved('takes/three.json').slice(1));
  await new Promise((r) => setTimeout(r, 5));
  assert.notEqual(models.takes.snapshot(), was);
  assert.equal(models.takes.snapshot().list.length, 2);
  stop();
});

test('the transport, made over a fixture, holds the tape, and its presses are recorded or refused', async () => {
  const fx = fixture({ tape: saved('tape/stopped.json') }, { refuse: { play: { code: 'no_audio_out', message: 'no output device' } } });
  const errors = [];
  const { models, ready, stop } = fixtureModels(fx, ['transport'], { onError: (m) => errors.push(m) });
  await ready;
  const s = models.transport.snapshot();
  assert.equal(s.tape.name, 'Tape 1');
  assert.equal(s.live.output_mode, 'jam');
  assert.deepEqual(models.transport.tempo().bars, 4);
  models.transport.play();
  models.transport.stop();
  models.transport.locate(1000);
  models.transport.setLoop(false);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(fx.calls.map((c) => [c.noun, c.name, c.body]), [
    ['transport', 'play', {}], ['transport', 'stop', {}], ['transport', 'locate', { pos: 1000 }], ['tape', 'setLoop', { on: false }],
  ]);
  assert.deepEqual(errors, ['no output device'], 'the refused ▶ says why, as the bar does');
  stop();
  assert.deepEqual(MODELS, ['takes', 'transport']);
  assert.throws(() => fixtureModels(fx, ['rig']), /no fixture model for rig/);
});
