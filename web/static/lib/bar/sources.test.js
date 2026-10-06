// The bar's two sources on Takes and Capture: a take (its list row's audio)
// and the tape (polled from the Pi), with a fake audio element, a stubbed
// fetch and a clock the tests move.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { takeSource } from './take-source.js';
import { tapeSource } from './tape-source.js';

const SR = 48000;

class FakeAudio {
  constructor() { this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.l = {}; }
  addEventListener(ev, fn, opts) {
    (this.l[ev] ??= []).push(fn);
    opts?.signal?.addEventListener('abort', () => { this.l[ev] = this.l[ev].filter((f) => f !== fn); });
  }
  emit(ev) { for (const f of this.l[ev] || []) f(); }
}

function aTake(trim = null) {
  const audio = new FakeAudio();
  const peaks = { buckets: 4, channels: 2, duration: 10, data: [new Float32Array(8), new Float32Array(8)] };
  const player = { audio, peaks, toggle() { audio.paused = !audio.paused; audio.emit(audio.paused ? 'pause' : 'play'); } };
  const t = { name: 'jam_x.wav', sample_rate: SR, duration_seconds: 10, bpm: null, trim };
  return { audio, player, t };
}

test('a take: Loop with a selection takes the playhead back to In at Out', () => {
  const { audio, player, t } = aTake({ start_frame: 2 * SR, end_frame: 4 * SR });
  const s = takeSource(t, player);
  s.setLoop(true);
  assert.equal(audio.loop, false, 'a selection is looped by tick, not by the audio');
  s.play();
  audio.currentTime = 3.999;
  s.tick();
  assert.equal(audio.currentTime, 2);
  audio.currentTime = 3;
  s.tick();
  assert.equal(audio.currentTime, 3, 'inside the selection it plays on');
});

test('a take: Loop without a selection is the audio\'s own, so it can\'t end', () => {
  const { audio, player, t } = aTake();
  const s = takeSource(t, player);
  s.setLoop(true);
  assert.equal(audio.loop, true);
  s.setLoop(false);
  assert.equal(audio.loop, false);
  s.setLoop(true);
  s.destroy();
  assert.equal(audio.loop, false, 'let go, the row\'s audio plays once again');
});

test('a take: its row letting the audio go tells the bar, until the source is let go', () => {
  const { audio, player, t } = aTake();
  let gone = 0;
  const s = takeSource(t, player, { onGone: () => gone++ });
  audio.emit('emptied');
  assert.equal(gone, 1);
  s.destroy();
  audio.emit('emptied');
  assert.equal(gone, 1);
});

test('a take: ▶ and ❚❚ press the row\'s own player only when they change something', () => {
  const { audio, player, t } = aTake();
  const s = takeSource(t, player);
  s.pause();
  assert.equal(audio.paused, true);
  s.play();
  assert.equal(audio.paused, false);
  s.play();
  assert.equal(audio.paused, false);
  assert.equal(s.lcd().status, 'play');
  assert.equal(s.start(), 0);
  assert.equal(s.startLabel(), 'Back to the start');
});

// --- the tape ---------------------------------------------------------------

const BAR = 2.5 * SR;
const tapeJSON = (over = {}) => ({
  id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR,
  grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 4 * BAR, out: 8 * BAR, on: true }, tracks: [], ...over,
});
let now = 1000;
const realNow = performance.now.bind(performance);
let stopper = null;
function stubs(answer) {
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  performance.now = () => now;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => answer(url) });
}
afterEach(() => { stopper?.destroy(); stopper = null; performance.now = realNow; delete globalThis.fetch; delete globalThis.document; });
const settle = () => new Promise((r) => setTimeout(r, 5));

test('the tape: run on between polls, round the loop at its Out', async () => {
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: true, heard: 8 * BAR - 0.2 * SR, count_in: 0, output: 'demo' } }));
  const s = stopper = tapeSource('t1');
  await settle();
  assert.equal(s.playing(), true);
  now += 100; // 0.1 s on: still short of Out
  assert.equal(Math.round(s.pos()), 8 * BAR - 0.1 * SR);
  now += 300; // 0.4 s on: 0.2 s past Out, so 0.2 s into the loop
  assert.equal(Math.round(s.pos()), 4 * BAR + 0.2 * SR);
});

test('the tape: a count-in and a mixdown\'s tail are playing; a quiet poll is not', async () => {
  let live = { playing: false, heard: 0, count_in: BAR, output: 'demo' };
  stubs(() => ({ tape: tapeJSON(), loaded: true, live }));
  const s = stopper = tapeSource('t1');
  await settle();
  assert.equal(s.playing(), true, 'counting in');
  live = { playing: false, heard: 0, count_in: 0, output: 'demo', mixdown: { tape: 't1', state: 'tail', from: 0, to: BAR } };
  s.setActive(true); // asks again at once
  await settle();
  assert.equal(s.playing(), true, 'the tail of a mixdown');
  now += 2500;
  assert.equal(s.playing(), false, 'no word from the Pi for 2 s');
});

test('the tape: a locate holds over a poll already on its way', async () => {
  let heard = 0;
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: false, heard, count_in: 0, output: 'demo' } }));
  const s = stopper = tapeSource('t1');
  await settle();
  s.seek(10 * BAR);
  assert.equal(s.pos(), 10 * BAR);
  s.setActive(true); // a poll that still says 0
  await settle();
  assert.equal(s.pos(), 10 * BAR, 'held');
  now += 1100;
  heard = 10 * BAR;
  s.setActive(true);
  await settle();
  assert.equal(s.pos(), 10 * BAR, 'and then the Pi agrees');
});

test('the tape: loaded somewhere else, the bar follows it', async () => {
  const asked = [];
  stubs((url) => {
    asked.push(url);
    if (url.startsWith('/api/tapes/state?id=t1')) return { tape: tapeJSON(), loaded: false };
    if (url === '/api/tapes') return { loaded: 't2', tapes: [] };
    return { tape: tapeJSON({ id: 't2', name: 'Tape 2' }), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } };
  });
  const s = stopper = tapeSource('t1');
  await settle();
  await settle();
  assert.ok(asked.some((u) => u.startsWith('/api/tapes/state?id=t2')), JSON.stringify(asked));
  assert.equal(s.title, 'Tape 2');
});

test('the tape on this phone: held back, the LCD asks for ▶, and ▶ wakes it without stopping the tape', async () => {
  const sent = [];
  let playing = true;
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing, heard: 0, count_in: 0, output: 'stream', output_mode: 'phone' } }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => { if (o?.method) sent.push(JSON.parse(o.body)); return realFetch(url, o); };
  const player = { active: true, state: 'locked', waitingTap: true, resumed: 0, resume() { this.resumed++; } };
  const s = stopper = tapeSource('t1', { stream: () => player });
  await settle();
  assert.equal(s.waiting(), true);
  assert.equal(s.lcd().note, 'tap ▶ to play here');
  assert.equal(s.press(), true);
  assert.equal(player.resumed, 1);
  assert.deepEqual(sent, [], 'playing already: the tap only wakes the sound');
  playing = false;
  s.setActive(true);
  await settle();
  s.press();
  assert.deepEqual(sent, [{ action: 'play' }], 'stopped: the tap plays it too');
  player.state = 'buffering';
  assert.equal(s.waiting(), false);
  assert.equal(s.press(), false, 'heard here: ▶ is ▶ again');
  assert.equal(s.lcd().note, 'reconnecting…');
  player.state = 'playing';
  player.waitingTap = false;
  assert.equal(s.lcd().note, '');
});
