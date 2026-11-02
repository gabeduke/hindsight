// The engine (lib/models/engine.js) as a model, with no bar drawn: its
// source verbs (setSource, loadTake, eject), snapshot() and onChange, on a
// stand-in page (lib/bar/bar-harness.js) with the Pi a stub. The bar that
// draws it is lib/bar/engine.test.js's.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { barPage, aTake } from '../bar/bar-harness.js';

const SR = 48000;
const BAR = 2.5 * SR;
const TAPE = { id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR, grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 0, out: 0, on: false }, tracks: [] };
const pi = (url) => {
  if (url.startsWith('/api/tapes/state?id=t1')) return { tape: TAPE, loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo', output_mode: 'jam' } };
  if (url === '/api/tapes') return { loaded: 't1', tapes: [] };
  if (url === '/api/status') return { ring_seconds: 120, buffered_seconds: 120, capture_healthy: true, channel_rms: [-20, -20] };
  if (url === '/api/envelope') return { bins: [] };
  return undefined;
};

let page = null;
afterEach(() => {
  page?.engine?.tape?.destroy();
  page?.engine?.transport?.destroy();
  page?.engine?.feed?.destroy();
  page = null;
});

async function open() {
  page = await barPage({ engine: true, drawn: false, tapes: { loaded: 't1' }, answer: pi });
  return page;
}

test('the engine holds the tape with no bar drawn, and its snapshot says so', async () => {
  const { engine, np } = await open();
  assert.equal(np, null, 'no NowPlaying');
  assert.equal(engine.bar.src, engine.tape);
  const s = engine.bar.snapshot();
  assert.equal(s.kind, 'tape');
  assert.equal(s.playing, false);
  assert.equal(engine.bar.canEject, false, 'nothing to give back the tape in place of');
});

test('loadTake puts the take in it, and onChange hears it at once', async () => {
  const { engine } = await open();
  let heard = 0;
  const off = engine.bar.onChange(() => heard++);
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  assert.ok(heard > 0, 'heard as it happened, not on a frame');
  assert.equal(engine.bar.src.kind, 'take');
  assert.equal(engine.bar.snapshot().kind, 'take');
  assert.equal(engine.bar.takeName, 'jam_a.wav');
  assert.equal(engine.bar.canEject, true);
  off();
  const before = heard;
  engine.bar.eject();
  assert.equal(heard, before, 'a way off is off');
});

test('eject gives the tape back by hand, and lets the take’s audio go', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  assert.equal(engine.audio.owns(take.audio), true, 'the engine owns the take’s audio while it holds it');
  engine.bar.eject();
  assert.equal(engine.bar.src, engine.tape);
  assert.equal(engine.bar.takeName, null);
  assert.equal(engine.bar.ejected, true);
  assert.equal(engine.audio.owns(take.audio), false);
  assert.equal(engine.bar.canEject, false);
});

test('setSource moves between the feed, the take and the tape', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  engine.bar.setSource('feed');
  assert.equal(engine.bar.sourceKind, 'feed');
  assert.equal(engine.feed, engine.bar.src, 'the feed made the first time it is chosen');
  assert.equal(engine.bar.canEject, true);
  engine.bar.setSource('take');
  assert.equal(engine.bar.sourceKind, 'take');
  assert.equal(engine.bar.takeName, 'jam_a.wav');
  engine.bar.setSource('tape', { byHand: true });
  assert.equal(engine.bar.sourceKind, 'tape');
  assert.equal(engine.bar.ejected, true);
});

test('audioFor makes the take’s Audio in the engine, and hands back the one it holds', async () => {
  const { engine } = await open();
  const t = { name: 'jam_b.wav', preview_name: 'jam_b.preview.wav' };
  const a = engine.audio.audioFor(t);
  assert.equal(a.preload, 'none');
  assert.match(a.src, /\/api\/download\?file=jam_b\.preview\.wav$/);
  const take = aTake('jam_c.wav');
  engine.bar.loadTake(take.t, take.player);
  assert.equal(engine.audio.audioFor(take.t), take.audio);
});
