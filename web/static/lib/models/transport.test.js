// The transport (lib/models/transport.js), with a stubbed Pi, a clock the
// tests move, timers that only run when told, and a fake changes socket.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, HOLD_MS, STALE_MS, POLL_MS } from './transport.js';

const SR = 48000;
const BAR = 2.5 * SR;
const tapeJSON = (over = {}) => ({
  id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR,
  grid: { frames: 16 * BAR, bars: 16 }, loop: { in: 4 * BAR, out: 8 * BAR, on: true }, tracks: [], ...over,
});
const stopped = (over = {}) => ({ playing: false, heard: 0, count_in: 0, output: 'demo', ...over });

let model = null;
afterEach(() => { model?.destroy(); model = null; });
const settle = () => new Promise((r) => setTimeout(r, 5));

// fakeWatch is changes.js's watchChanges: a socket the test speaks for.
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

// rig makes a transport on a Pi that answers /api/tapes/state with
// answer(url), and logs the commands sent to it. Timers are held in `later`
// and run by the test (run()).
function rig(answer, env = {}) {
  const r = { now: 1000, polls: [], sent: [], errors: [], later: [], w: fakeWatch(), hidden: false };
  r.fetch = async (url) => { r.polls.push(url); return { ok: true, json: async () => answer(url) }; };
  r.send = async (url, o = {}) => {
    if (o.method) { r.sent.push({ url, ...JSON.parse(o.body) }); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => answer(url) };
  };
  r.run = () => { const l = r.later.splice(0); for (const f of l) f(); };
  model = r.m = createTransport({
    fetch: (u, o) => r.fetch(u, o),
    send: (u, o) => r.send(u, o),
    now: () => r.now,
    hidden: () => r.hidden,
    setTimeout: (f) => { r.later.push(f); return r.later.length; },
    clearTimeout: () => {},
    watch: r.w.watch,
    onError: (m) => r.errors.push(m),
    ...env,
  });
  return r;
}

test('nothing is asked before a tape is loaded; load asks at once and opens the socket', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.setActive(true);
  r.m.refresh();
  await settle();
  assert.equal(r.polls.length, 0);
  assert.equal(r.w.open, 0);
  assert.equal(r.m.ready, false);
  r.m.load('t1');
  await settle();
  assert.deepEqual(r.polls, ['/api/tapes/state?id=t1']);
  assert.equal(r.w.open, 1);
  assert.equal(r.m.ready, true);
  assert.equal(r.m.tape.name, 'Tape 1');
});

test('run on between answers, round the loop at its Out', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: { playing: true, heard: 8 * BAR - 0.2 * SR, count_in: 0, output: 'demo' } }));
  r.m.load('t1');
  await settle();
  assert.equal(r.m.playing(), true);
  r.now += 100; // 0.1 s on: still short of Out
  assert.equal(Math.round(r.m.pos()), 8 * BAR - 0.1 * SR);
  r.now += 300; // 0.4 s on: 0.2 s past Out, so 0.2 s into the loop
  assert.equal(Math.round(r.m.pos()), 4 * BAR + 0.2 * SR);
});

test('a count-in and a mixdown\'s tail are playing; a quiet Pi is not', async () => {
  let live = stopped({ count_in: BAR });
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live }));
  r.m.load('t1');
  await settle();
  assert.equal(r.m.playing(), true, 'counting in');
  live = stopped({ mixdown: { tape: 't1', state: 'tail', from: 0, to: BAR } });
  r.m.setActive(true); // asks again at once
  await settle();
  assert.equal(r.m.playing(), true, 'the tail of a mixdown');
  r.now += STALE_MS + 500;
  assert.equal(r.m.playing(), false, 'no word from the Pi for 2 s');
});

test('a locate holds over an answer already on its way, then the Pi has it', async () => {
  let heard = 0;
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped({ heard }) }));
  r.m.load('t1');
  await settle();
  r.m.locate(10 * BAR);
  assert.equal(r.m.pos(), 10 * BAR);
  assert.deepEqual(r.sent.at(-1), { url: '/api/tapes/transport?id=t1', action: 'locate', pos: 10 * BAR });
  r.m.setActive(true); // an answer that still says 0
  await settle();
  assert.equal(r.m.pos(), 10 * BAR, 'held');
  r.now += HOLD_MS + 100;
  heard = 10 * BAR;
  r.m.setActive(true);
  await settle();
  assert.equal(r.m.pos(), 10 * BAR, 'and then the Pi agrees');
});

test('loaded somewhere else, it follows the tape the Pi has', async () => {
  const r = rig((url) => {
    if (url.startsWith('/api/tapes/state?id=t1')) return { tape: tapeJSON(), loaded: false };
    if (url === '/api/tapes') return { loaded: 't2', tapes: [] };
    return { tape: tapeJSON({ id: 't2', name: 'Tape 2' }), loaded: true, live: stopped() };
  });
  r.m.load('t1');
  await settle();
  await settle();
  assert.ok(r.polls.some((u) => u.startsWith('/api/tapes/state?id=t2')), JSON.stringify(r.polls));
  assert.equal(r.m.id, 't2');
  assert.equal(r.m.tape.name, 'Tape 2');
});

test('▶ then ■ before an answer says so stops it, and the Pi has the last word', async () => {
  const live = stopped();
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live }));
  r.m.load('t1');
  await settle();
  const sent = [];
  r.m.delegate({ play: () => sent.push('play'), stop: () => sent.push('stop') });
  // The bar's ▶ toggles from playing(): two presses inside one poll.
  const press = () => { if (r.m.playing()) r.m.stop(); else r.m.play(); };
  press();
  assert.equal(r.m.playing(), true, 'playing as soon as ▶ is pressed');
  press();
  assert.deepEqual(sent, ['play', 'stop'], 'the second press stops it, not a second play');
  assert.equal(r.m.playing(), false);
  // An answer that says it plays (the stop not yet carried out) is held off a moment...
  r.m.ingest({ live: { ...live, playing: true } });
  assert.equal(r.m.playing(), false, 'the press holds');
  // ...but not for ever: the Pi has the last word.
  r.now += HOLD_MS + 100;
  r.m.ingest({ live: { ...live, playing: true } });
  assert.equal(r.m.playing(), true);
});

test('its own commands go to the Pi, ask again shortly after, and a refusal is heard', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  r.later.length = 0;
  await r.m.play();
  await r.m.stop();
  r.m.setLoop(false);
  await settle();
  assert.deepEqual(r.sent, [
    { url: '/api/tapes/transport?id=t1', action: 'play' },
    { url: '/api/tapes/transport?id=t1', action: 'stop' },
    { url: '/api/tapes?id=t1', loop: { on: false } },
  ]);
  const before = r.polls.length;
  r.run();
  await settle();
  assert.ok(r.polls.length > before, 'each asks what the Pi made of it');
  r.send = async () => ({ ok: false, status: 409, json: async () => ({ error: 'no output' }) });
  await r.m.play();
  assert.equal(r.errors.length, 1);
});

test('it asks every POLL_MS in the bar, every tenth tick with a take in it, and nothing while out of view', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  assert.ok(POLL_MS > 0);
  const tickN = async (n) => { for (let i = 0; i < n; i++) { r.run(); await settle(); } };
  let before = r.polls.length;
  await tickN(3);
  assert.equal(r.polls.length, before + 3, 'in the bar: each tick');
  r.m.setActive(false);
  before = r.polls.length;
  await tickN(10);
  assert.equal(r.polls.length, before + 1, 'a take in the bar: one tick in ten');
  r.m.setActive(true);
  await settle();
  r.hidden = true;
  before = r.polls.length;
  await tickN(3);
  assert.equal(r.polls.length, before, 'out of view: nothing');
  r.hidden = false;
  r.m.wake();
  await settle();
  assert.equal(r.polls.length, before + 1, 'back in view: at once');
});

test('the tempo is the grid\'s; a tape with none has none, and its step is a second', async () => {
  let tape = tapeJSON();
  const r = rig(() => ({ tape, loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  assert.deepEqual(r.m.tempo(), { bpm: 96, bars: 16, barFrames: BAR });
  assert.equal(r.m.step(), BAR);
  tape = tapeJSON({ grid: null });
  r.m.refresh();
  await settle();
  assert.equal(r.m.tempo(), null);
  assert.equal(r.m.step(), SR);
});

// docs/architecture/push.md: the Pi's word that the tape changed asks at once.
test('a nudge from the Pi asks at once, not at the next tick', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  const before = r.polls.length;
  r.w.nudge({ rev: 2 });
  await settle();
  assert.equal(r.polls.length, before + 1);
  r.m.destroy();
  assert.equal(r.w.open, 0, 'destroy lets the socket go');
});

test('one socket for the page: lent to the Studio it stays open and a nudge is the Studio\'s; handed back, it asks; with a take in the bar, a nudge waits', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  assert.equal(r.w.open, 1);
  const studio = [];
  r.m.delegate({ poll() {}, nudge: (m) => studio.push(m.rev) });
  assert.equal(r.w.open, 1, 'lent to the Studio, the socket stays: no second one, no gap');
  let before = r.polls.length;
  r.w.nudge({ rev: 4 });
  await settle();
  assert.deepEqual(studio, [4], 'the Studio acts on the nudge');
  assert.equal(r.polls.length, before, 'and the transport asks nothing of its own');
  r.m.delegate(null);
  assert.equal(r.w.open, 1, 'handed back: still the one socket');
  await settle();
  assert.equal(r.polls.length, before + 1, 'and it asks the Pi at once, for what changed meanwhile');
  r.w.nudge({ rev: 5 });
  await settle();
  assert.deepEqual(studio, [4], 'the Studio hears no more once it has handed it back');
  r.m.setActive(false);
  before = r.polls.length;
  r.w.nudge({ rev: 9 });
  await settle();
  assert.equal(r.polls.length, before, 'a take in the bar: a nudge asks nothing until the tape is back');
  assert.equal(r.w.open, 1);
  r.m.destroy();
  assert.equal(r.w.open, 0, 'destroy closes it');
});

test('a nudge while a poll is out asks once more after it, never two at once', async () => {
  let out = 0, most = 0;
  let answer = null;
  const body = { tape: tapeJSON(), loaded: true, live: stopped() };
  const r = rig(() => body);
  // A Pi slow to answer: each poll waits for the test to let it go.
  r.fetch = (url) => {
    r.polls.push(url); out++; most = Math.max(most, out);
    return new Promise((res) => { answer = () => { out--; res({ ok: true, json: async () => body }); }; });
  };
  r.m.load('t1');
  await settle();
  assert.equal(r.polls.length, 1, 'the first poll is out');
  r.w.nudge({ rev: 2 });
  r.w.nudge({ rev: 3 });
  await settle();
  assert.equal(r.polls.length, 1, 'no second fetch beside it');
  answer();
  await settle();
  assert.equal(r.polls.length, 2, 'once more when it is answered');
  answer();
  await settle();
  assert.equal(r.polls.length, 2, 'and only once');
  assert.equal(most, 1);
});

test('a press on the keyboard and the take list\'s revision are heard on the one socket, lent or not, with a take in the bar too', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.load('t1');
  await settle();
  const presses = [], takes = [];
  const offPress = r.m.onPress((p) => presses.push(p.words));
  const offTakes = r.m.onTakes((m) => takes.push(m.takes_rev));
  r.w.press({ words: 'PLAY', role: 'play', lit: ['play'], track: 0, ms: 1000 });
  r.w.takes({ rev: 1, takes_rev: 4 });
  r.m.setActive(false);
  r.w.press({ words: 'REC', role: 'rec', lit: ['rec'], track: 0, ms: 1000 });
  r.w.takes({ rev: 1, takes_rev: 5 });
  r.m.setActive(true);
  r.m.delegate({ poll() {} });
  r.w.press({ words: 'STOP', role: 'stop', lit: ['play'], track: 0, ms: 1000 });
  r.w.takes({ rev: 2, takes_rev: 6 });
  offPress();
  offTakes();
  r.w.press({ words: 'KEPT 30 S', role: 'rec', lit: ['rec'], track: 0, ms: 1000 });
  r.w.takes({ rev: 2, takes_rev: 7 });
  assert.deepEqual(presses, ['PLAY', 'REC', 'STOP']);
  assert.deepEqual(takes, [4, 5, 6]);
});

test('a tape the Studio ingests before load does not keep load from asking', async () => {
  const r = rig(() => ({ tape: tapeJSON(), loaded: true, live: stopped() }));
  r.m.ingest({ tape: tapeJSON(), live: stopped() });
  r.m.load('t1');
  await settle();
  assert.equal(r.polls.length, 1);
  assert.equal(r.w.open, 1);
});
