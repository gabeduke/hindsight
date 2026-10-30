// The bar's two sources on Takes and Capture: a take (its list row's audio)
// and the tape (polled from the Pi), with a fake audio element, a stubbed
// fetch and a clock the tests move.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { takeSource, playheadOf } from './take-source.js';
import { tapeSource as barTapeSource } from './tape-source.js';
import { createTransport } from '../models/transport.js';

const SR = 48000;

class FakeAudio {
  constructor() { this.currentTime = 0; this.paused = true; this.ended = false; this.loop = false; this.l = {}; }
  addEventListener(ev, fn, opts) {
    (this.l[ev] ??= []).push(fn);
    opts?.signal?.addEventListener('abort', () => { this.l[ev] = this.l[ev].filter((f) => f !== fn); });
  }
  emit(ev) { for (const f of this.l[ev] || []) f(); }
  pause() { this.paused = true; this.emit('pause'); }
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

// The bar swaps a take for another (or the tape back in) and lets the old source
// go; nothing may be left sounding that the bar no longer shows (F5a review).
test('a take: a source let go never keeps sounding', () => {
  const { audio, player, t } = aTake();
  const s = takeSource(t, player);
  s.play();
  assert.equal(audio.paused, false);
  s.destroy();
  assert.equal(audio.paused, true, 'its audio was paused with it');
  // One that was not playing is left as it was (no pause event for nothing).
  const quiet = aTake();
  let paused = 0;
  quiet.audio.pause = () => { paused++; };
  takeSource(quiet.t, quiet.player).destroy();
  assert.equal(paused, 0);
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
// The bar's tape source draws the page's transport (lib/models/transport.js,
// whose own tests have its polling, push, holds and commands); what is the
// source's own is the stream on this phone and what the LCD says.

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
const noSocket = () => ({ close() {} });
// tapeSource over a transport loaded with tape t1, as the engine makes them.
function tapeSource(id, opts = {}) {
  const transport = createTransport({ watch: noSocket });
  transport.load(id);
  const s = barTapeSource(transport, opts);
  const own = s.destroy;
  return Object.assign(s, { transport, destroy() { own(); transport.destroy(); } });
}
afterEach(() => { stopper?.destroy(); stopper = null; performance.now = realNow; delete globalThis.fetch; delete globalThis.document; });
const settle = () => new Promise((r) => setTimeout(r, 5));

test('the tape: the bar\'s source runs on with the transport, round the loop at its Out, and says where |◂ goes', async () => {
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: true, heard: 8 * BAR - 0.2 * SR, count_in: 0, output: 'demo' } }));
  const s = stopper = tapeSource('t1');
  await settle();
  assert.equal(s.playing(), true);
  assert.equal(s.title, 'Tape 1');
  now += 400; // 0.2 s past Out, so 0.2 s into the loop
  assert.equal(Math.round(s.pos()), 4 * BAR + 0.2 * SR);
  assert.equal(s.start(), 4 * BAR);
  assert.equal(s.startLabel(), 'Back to the loop’s start');
  assert.equal(s.lcd().status, 'play');
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

test('the bar’s take says where it is, in seconds; with no take in the bar, null', () => {
  const { audio, player, t } = aTake();
  const held = { name: t.name, audio, src: takeSource(t, player) };
  assert.equal(playheadOf(held), 0, 'a take held at its start');
  audio.currentTime = 7.25;
  assert.equal(playheadOf(held), 7.25, 'it follows the audio the spine and the bar share');
  assert.equal(playheadOf(null), null, 'nothing in the bar');
  audio.currentTime = NaN;
  assert.equal(playheadOf(held), null, 'an audio element with no time yet');
});

test('a take with a selection plays it: Play starts at In, and reaching Out stops it', () => {
  const { audio, player, t } = aTake({ start_frame: 1 * SR, end_frame: 2 * SR });
  const s = takeSource(t, player);
  s.play();
  assert.equal(audio.currentTime, 1, 'from the start, Play begins at In');
  assert.equal(audio.paused, false);
  audio.currentTime = 2;
  s.tick();
  assert.equal(audio.paused, true, 'Out stops it');
  assert.equal(audio.currentTime, 1, 'and rests at In, ready to play again');
});

test('a take without a selection plays on past where a selection would end', () => {
  const { audio, player, t } = aTake();
  const s = takeSource(t, player);
  s.play();
  audio.currentTime = 9;
  s.tick();
  assert.equal(audio.paused, false);
});
