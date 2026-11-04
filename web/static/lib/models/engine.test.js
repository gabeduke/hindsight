// The engine (lib/models/engine.js) as a model, with no bar drawn: its
// source verbs (setSource, loadTake, eject), snapshot() and onChange, on a
// stand-in page (lib/bar/bar-harness.js) with the Pi a stub. The bar that
// draws it is lib/bar/engine.test.js's.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { barPage, aTake } from '../bar/bar-harness.js';
import { noteHere } from './engine.js';

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
  // The Transport is handed the bar, not the engine: the bar says the
  // engine's tape and this device's stream of it.
  assert.ok(engine.tape && engine.bar.tapeSource === engine.tape, 'the bar’s tapeSource is the engine’s tape');
  assert.ok(engine.stream && engine.bar.stream === engine.stream, 'the bar’s stream is the engine’s');
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

// The bar's verbs and its snapshot (1d, step 5b): what NowPlaying presses
// and draws, in place of the source itself.

test('snapshot is frozen, the same object until something moves, and v moves with it', async () => {
  const { engine } = await open();
  const a = engine.bar.snapshot('THIS TABLET');
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.lcd));
  assert.ok(Object.isFrozen(a.display));
  assert.equal(engine.bar.snapshot('THIS TABLET'), a, 'nothing moved: the same object');
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  const b = engine.bar.snapshot('THIS TABLET');
  assert.notEqual(b, a);
  assert.ok(b.v > a.v);
  assert.notEqual(b.id, a.id, 'another source, another id');
  assert.equal(engine.bar.snapshot('THIS TABLET').id, b.id);
});

test('snapshot says what the bar draws: the LCD, the display for here, the flags, Open’s href and |◂’s words', async () => {
  const { engine } = await open();
  const tape = engine.bar.snapshot('THIS TABLET');
  assert.equal(tape.kind, 'tape');
  assert.equal(tape.href, '/tape.html');
  assert.equal(tape.title, 'Tape 1');
  assert.equal(tape.startLabel, 'Back to the top of the tape');
  assert.equal(tape.canEject, false);
  assert.equal(tape.display.source.short, engine.tape.display().source.short);
  const take = aTake('jam_a.wav', { seconds: 120 });
  engine.bar.loadTake(take.t, take.player);
  take.audio.currentTime = 83;
  engine.bar.kick();
  const s = engine.bar.snapshot('THIS TABLET');
  assert.equal(s.kind, 'take');
  assert.equal(s.href, '/wave.html?file=jam_a.wav');
  assert.equal(s.frame, 83 * SR);
  assert.equal(s.length, 120 * SR);
  assert.equal(s.lcd.big, engine.bar.src.lcd().big);
  assert.equal(s.pos, s.lcd.big);
  assert.equal(s.display.out, 'THIS TABLET', 'a take plays here');
  assert.equal(engine.bar.snapshot(null).display, null, 'no here, no display');
  assert.deepEqual([s.canPlay, s.canLoop, s.canStart, s.canEject, s.loop, s.playing, s.waiting], [true, true, true, true, false, false, false]);
  assert.equal(s.startLabel, 'Back to the start');
  assert.equal(typeof s.levels.at, 'function', 'the reels’ levels');
});

test('with nothing in the bar the snapshot says so, and no verb throws', async () => {
  page = await barPage({ engine: true, drawn: false, tapes: null, answer: pi });
  const { engine } = page;
  const s = engine.bar.snapshot('THIS TABLET');
  assert.equal(s.kind, null);
  assert.equal(s.canPlay, false);
  for (const verb of ['playPause', 'toStart', 'back5', 'toEnd']) engine.bar[verb]();
  engine.bar.seekFraction(0.5);
  engine.bar.step(1);
  engine.bar.setLoop(true);
  assert.equal(engine.bar.paintStrip({}, 10, 10, () => '', 1), false);
});

test('playPause is ▶: it plays what the bar holds, and stops it, each a touch', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  const t0 = engine.bar.touches;
  engine.bar.playPause();
  assert.equal(take.audio.paused, false);
  assert.equal(engine.bar.snapshot().playing, true, 'the snapshot after the press says it');
  engine.bar.playPause();
  assert.equal(take.audio.paused, true);
  assert.equal(engine.bar.touches, t0 + 2);
});

test('playPause in the Studio gives the tape back once it has stopped a take (tapeUnlessPlaying)', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  engine.bar.playPause();
  globalThis.location.pathname = '/tape.html';
  engine.bar.playPause();
  assert.equal(engine.bar.sourceKind, 'tape');
});

test('playPause asks the source first: the tape’s sound waiting for a tap is woken, not stopped', async () => {
  const { engine } = await open();
  let woke = 0;
  engine.tape.press = () => { woke++; return true; };
  engine.tape.play = () => assert.fail('the tap wakes it; it does not play it again');
  engine.bar.playPause();
  assert.equal(woke, 1);
});

test('playPause and setLoop do nothing while ▶ and ⟲ are unlit, whoever presses them (Space and L in the Studio, step 5c)', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  const src = engine.bar.src;
  src.canPlay = () => false;
  src.canLoop = () => false;
  const t0 = engine.bar.touches;
  engine.bar.playPause();
  assert.equal(take.audio.paused, true, '▶ unlit plays nothing');
  engine.bar.setLoop(true);
  assert.equal(engine.bar.snapshot().loop, false, '⟲ unlit loops nothing');
  assert.equal(engine.bar.touches, t0, 'and neither is a touch');
});

test('the seeks: a fraction, a step, back five seconds, the end, the start', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav', { seconds: 100 });
  engine.bar.loadTake(take.t, take.player);
  engine.bar.seekFraction(0.5);
  assert.equal(take.audio.currentTime, 50);
  engine.bar.step(1);
  assert.equal(take.audio.currentTime, 51, 'a take’s step is a second');
  engine.bar.step(-2);
  assert.equal(take.audio.currentTime, 49);
  engine.bar.back5();
  assert.equal(take.audio.currentTime, 44);
  engine.bar.toEnd();
  assert.equal(take.audio.currentTime, (100 * SR - 1) / SR);
  const t0 = engine.bar.touches;
  engine.bar.toStart();
  assert.equal(take.audio.currentTime, 0);
  assert.equal(engine.bar.touches, t0 + 1, '|◂ is a touch');
  take.audio.currentTime = 3;
  engine.bar.back5();
  assert.equal(take.audio.currentTime, 0, 'never before the start');
});

test('setLoop is ⟲: on and off, and the snapshot follows', async () => {
  const { engine } = await open();
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  engine.bar.setLoop(true);
  assert.equal(engine.bar.snapshot().loop, true);
  assert.equal(take.audio.loop, true, 'a take with no selection loops its audio');
  engine.bar.setLoop(false);
  assert.equal(engine.bar.snapshot().loop, false);
});

test('paintStrip hands the strip’s context to what the bar holds', async () => {
  const { engine } = await open();
  const got = [];
  engine.tape.paint = (...a) => got.push(a);
  const col = () => '#000';
  assert.equal(engine.bar.paintStrip('ctx', 300, 40, col, 2), true);
  assert.deepEqual(got, [['ctx', 300, 40, col, 2]]);
});

test('noteHere takes the frame first, then keeps it, then goes: in that order, and not at all with no take', () => {
  const order = [];
  const frame = { take: 'a b.wav', frame: 100, sr: 48000, playing: true, at: 1 };
  const got = noteHere({ frameNow: () => { order.push('frame'); return frame; }, stash: (f) => order.push(`stash ${f.frame}`), go: (u) => order.push(`go ${u}`) });
  assert.deepEqual(order, ['frame', 'stash 100', 'go /wave.html?file=a%20b.wav']);
  assert.equal(got, frame);
  const none = [];
  assert.equal(noteHere({ frameNow: () => null, stash: () => none.push('stash'), go: () => none.push('go') }), null);
  assert.deepEqual(none, []);
});
