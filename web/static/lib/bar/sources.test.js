// The bar's two sources on Takes and Capture: a take (its list row's audio)
// and the tape (polled from the Pi), with a fake audio element, a stubbed
// fetch and a clock the tests move.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { takeSource, playheadOf } from './take-source.js';
import { tapeSource } from './tape-source.js';

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

test('the tape: ▶ then ■ before a poll says so stops it, and the Pi has the last word', async () => {
  const sent = [];
  let live = { playing: false, heard: 0, count_in: 0, output: 'demo' };
  stubs(() => ({ tape: tapeJSON(), loaded: true, live }));
  const s = stopper = tapeSource('t1');
  await settle();
  s.delegate({ play: () => sent.push('play'), stop: () => sent.push('stop') });
  // The bar's ▶ toggles from playing(): two presses inside one poll.
  const press = () => { if (s.playing()) s.pause(); else s.play(); };
  press();
  assert.equal(s.playing(), true, 'playing as soon as ▶ is pressed');
  press();
  assert.deepEqual(sent, ['play', 'stop'], 'the second press stops it, not a second play');
  assert.equal(s.playing(), false);
  // A poll that says it plays (the stop not yet carried out) is held off a moment...
  s.ingest({ live: { ...live, playing: true } });
  assert.equal(s.playing(), false, 'the press holds');
  // ...but not for ever: the Pi has the last word.
  now += 1100;
  s.ingest({ live: { ...live, playing: true } });
  assert.equal(s.playing(), true);
});

// docs/architecture/push.md: the Pi's word that the tape changed
// polls the bar's tape at once, while the bar polls it itself.
function fakeWatch() {
  const w = { open: 0, nudge: null, press: null, takes: null };
  w.watch = ({ onNudge, onPress, onTakes }) => {
    w.open++;
    w.nudge = onNudge;
    w.press = onPress;
    w.takes = onTakes;
    return { close() { w.open--; w.nudge = null; w.press = null; w.takes = null; } };
  };
  return w;
}

test('the tape: a nudge from the Pi polls at once, not at the next tick', async () => {
  let polls = 0;
  stubs(() => { polls++; return { tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } }; });
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  const before = polls;
  assert.equal(w.open, 1, 'the bar watches while it polls the tape itself');
  w.nudge({ rev: 2 });
  await settle();
  assert.equal(polls, before + 1, 'polled on the nudge, well inside the 500 ms tick');
  s.destroy();
  assert.equal(w.open, 0, 'destroy lets the socket go');
});

test('the tape: handed to the Studio, the bar stops watching; handed back, it watches and polls; with a take in the bar, it hears only presses', async () => {
  let polls = 0;
  stubs(() => { polls++; return { tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } }; });
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  s.delegate({ poll() {} });
  assert.equal(w.open, 0, 'the Studio\'s own socket feeds it while it is shown');
  const before = polls;
  s.delegate(null);
  assert.equal(w.open, 1, 'back in the bar\'s hands, it watches again');
  await settle();
  assert.equal(polls, before + 1, 'and asks the Pi at once, for what changed meanwhile');
  s.setActive(false);
  assert.equal(w.open, 1, 'the bar holding a take still hears the keyboard\'s presses');
  const before2 = polls;
  w.nudge({ rev: 9 });
  await settle();
  assert.equal(polls, before2, 'but a nudge polls nothing until the tape is back');
});

test('the tape: a nudge while a poll is out asks once more after it, never two at once', async () => {
  let out = 0, most = 0, polls = 0;
  let answer = null;
  const body = { tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } };
  stubs(() => body);
  // A Pi slow to answer: each poll waits for the test to let it go.
  globalThis.fetch = () => {
    polls++; out++; most = Math.max(most, out);
    return new Promise((r) => { answer = () => { out--; r({ ok: true, json: async () => body }); }; });
  };
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  assert.equal(polls, 1, 'the first poll is out');
  w.nudge({ rev: 2 });
  w.nudge({ rev: 3 });
  await settle();
  assert.equal(polls, 1, 'no second fetch beside it');
  answer();
  await settle();
  assert.equal(polls, 2, 'once more when it is answered');
  answer();
  await settle();
  assert.equal(polls, 2, 'and only once');
  assert.equal(most, 1);
  s.destroy();
});

test('the tape: a press on the keyboard is heard on the bar\'s socket, or handed on from the Studio\'s', async () => {
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } }));
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  const heard = [];
  const off = s.onPress((p) => heard.push(p.words));
  w.press({ words: 'PLAY', role: 'play', lit: ['play'], track: 0, ms: 1000 });
  s.delegate({ poll() {} });
  s.heardPress({ words: 'STOP', role: 'stop', lit: ['play'], track: 0, ms: 1000 });
  off();
  s.heardPress({ words: 'KEPT 30 S', role: 'rec', lit: ['rec'], track: 0, ms: 1000 });
  assert.deepEqual(heard, ['PLAY', 'STOP']);
  s.destroy();
});

test('the tape: the take list\'s revision is heard on the bar\'s socket, or handed on from the Studio\'s, with a take in the bar too', async () => {
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } }));
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  const heard = [];
  const off = s.onTakes((m) => heard.push(m.takes_rev));
  w.takes({ rev: 1, takes_rev: 4 });
  s.setActive(false);
  w.takes({ rev: 1, takes_rev: 5 });
  s.setActive(true);
  s.delegate({ poll() {} });
  assert.equal(w.takes, null, 'handed to the Studio, the bar\'s socket is shut');
  s.heardTakes({ rev: 2, takes_rev: 6 });
  off();
  s.heardTakes({ rev: 2, takes_rev: 7 });
  assert.deepEqual(heard, [4, 5, 6]);
  s.destroy();
});

test('the tape: with a take in the bar, a press on the keyboard is still heard', async () => {
  stubs(() => ({ tape: tapeJSON(), loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo' } }));
  const w = fakeWatch();
  const s = stopper = tapeSource('t1', { watch: w.watch });
  await settle();
  const heard = [];
  s.onPress((p) => heard.push(p.words));
  s.setActive(false);
  w.press({ words: 'PLAY', role: 'play', lit: ['play'], track: 0, ms: 1000 });
  assert.deepEqual(heard, ['PLAY']);
  s.destroy();
});
