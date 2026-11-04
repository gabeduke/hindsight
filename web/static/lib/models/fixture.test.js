// A protocol client with no Pi (lib/models/fixture.js), and the models made
// over it from the saved answers in testdata/protocol/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, fixtureModels, MODELS } from './fixture.js';
import { Refusal } from './protocol.js';
import { barPage } from '../bar/bar-harness.js';

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
  const { models, ready, stop } = fixtureModels(fx, ['transport']);
  await ready;
  const s = models.transport.snapshot();
  assert.equal(s.tape.name, 'Tape 1');
  assert.equal(s.live.output_mode, 'jam');
  assert.deepEqual(models.transport.tempo().bars, 4);
  await assert.rejects(models.transport.play(), (e) => e.code === 'no_audio_out' && e.message === 'no output device', 'the refused ▶ says why, to whoever pressed it');
  await models.transport.stop();
  await models.transport.locate(1000);
  await models.transport.setLoop(false);
  await models.transport.setTempo(90);
  assert.deepEqual(fx.calls.map((c) => [c.noun, c.name, c.body]), [
    ['transport', 'play', {}], ['transport', 'stop', {}], ['transport', 'locate', { pos: 1000 }], ['transport', 'setLoop', { on: false }], ['transport', 'setTempo', { bpm: 90 }],
  ]);
  stop();
  assert.deepEqual(MODELS, ['takes', 'tape', 'transport', 'bar', 'recorder', 'layout']);
  assert.throws(() => fixtureModels(fx, ['rig']), /no fixture model for rig/);
});

// The Transport's models (docs/architecture/bar.md, *The Transport's extraction*, decision 8):
// the engine's bar, the phone's recorder and the page's layout, so its
// check mounts it on fixtures as the display's is.
test('the engine’s bar, made over a fixture, holds the loaded tape, and its presses go to the fixture', async () => {
  // The engine owns the bar's audio: it needs a page, the bar harness's.
  const page = await barPage({ drawn: false });
  const fx = fixture({ tape: saved('tape/stopped.json') });
  const { models, ready, stop } = fixtureModels(fx, ['bar']);
  try {
    await ready;
    const { bar } = models;
    assert.equal(typeof bar.snapshot, 'function');
    assert.equal(typeof bar.onChange, 'function');
    await new Promise((r) => setTimeout(r, 20));
    const s = bar.snapshot();
    assert.equal(s.kind, 'tape');
    assert.equal(s.title, 'Tape 1');
    assert.equal(s.playing, false);
    await bar.src.play();
    assert.ok(fx.calls.some((c) => c.noun === 'transport' && c.name === 'play'), 'the tape’s ▶, sent to the fixture');
  } finally {
    stop();
    page.bar.src?.destroy?.();
  }
});

test('the recorder, made over a fixture, is closed until the fixture says otherwise; its verbs are recorded or refused', async () => {
  const fx = fixture({}, { refuse: { 'recorder.quick': { code: 'no_mic', message: 'no microphone' } } });
  const { models, ready, stop } = fixtureModels(fx, ['recorder']);
  await ready;
  const { recorder } = models;
  const was = recorder.snapshot();
  assert.deepEqual(was, { mode: 'closed', seconds: 0 });
  assert.ok(Object.isFrozen(was));
  assert.equal(recorder.snapshot(), was, 'the same object until it moves');
  const heard = [];
  const off = recorder.onChange((s) => heard.push(s));
  fx.set('recorder', { mode: 'recording', seconds: 12.6 });
  assert.deepEqual(heard, [{ mode: 'recording', seconds: 12 }]);
  fx.set('recorder', { mode: 'recording', seconds: 12.9 });
  assert.equal(heard.length, 1, 'the whole seconds have not moved: nothing to hear');
  await recorder.open();
  await assert.rejects(recorder.quick(), (e) => e.code === 'no_mic');
  await recorder.stop();
  assert.deepEqual(fx.calls.map((c) => `${c.noun}.${c.name}`), ['recorder.open', 'recorder.quick', 'recorder.stop']);
  off();
  stop();
  fx.set('recorder', { mode: 'closed' });
  assert.equal(heard.length, 1, 'stopped, it hears nothing');
});

test('the layout, made over a fixture, is barLayout’s: it starts where the fixture says and moves by set()', async () => {
  const fx = fixture({ layout: { folded: true } });
  const { models, ready, stop } = fixtureModels(fx, ['layout']);
  await ready;
  const { layout } = models;
  assert.deepEqual(layout.snapshot(), { folded: true, open: false, docked: false });
  const heard = [];
  layout.onChange((after, before) => heard.push([after.folded, before.folded]));
  layout.set({ folded: false });
  assert.deepEqual(layout.snapshot(), { folded: false, open: false, docked: false });
  assert.deepEqual(heard, [[false, true]]);
  layout.set({ folded: false });
  assert.equal(heard.length, 1, 'nothing moved, nothing heard');
  layout.set({ open: true });
  assert.equal(layout.open, true);
  stop();
  const plain = fixtureModels(fixture({}), ['layout']).models.layout;
  assert.deepEqual(plain.snapshot(), { folded: false, open: false, docked: false }, 'none, by default');
});
