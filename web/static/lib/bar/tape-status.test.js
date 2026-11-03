// The clock-out lamp and the output strip (tape-status.js): their words from
// the models, and the bar drawing them in any room, with no Studio mounted
// (1d, step 5b; docs/architecture/bar.md, *The lamp and the output strip*).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { outStrip, clockLamp } from './tape-status.js';
import { barPage } from './bar-harness.js';

const SR = 48000;
const BAR = 2.5 * SR;
const GRID = { frames: 16 * BAR, bars: 16 };
const TAPE = { id: 't1', name: 'Tape 1', sample_rate: SR, length: 16 * BAR, grid: GRID, loop: { in: 0, out: 0, on: false }, tracks: [] };

// A stream player as the strip reads it.
const stream = (state, { active = true, delayMs = 800, heard = null, waitingTap = false } = {}) => ({
  active, state, waitingTap, delayMs: () => delayMs, heard: () => heard,
});

test('the strip is hidden unless the tape plays on this device', () => {
  assert.deepEqual(outStrip({ stream: null, live: { output_mode: 'phone' }, tape: TAPE }), { hidden: true });
  assert.deepEqual(outStrip({ stream: stream('playing', { active: false }), live: { output_mode: 'phone' }, tape: TAPE }), { hidden: true });
  assert.deepEqual(outStrip({ stream: stream('playing'), live: { output_mode: 'jam' }, tape: TAPE }), { hidden: true });
  assert.deepEqual(outStrip({ stream: stream('playing'), live: null, tape: TAPE }), { hidden: true }, 'no word from the Pi: the jam room');
});

test('the strip says how it is going on this phone, and how far behind', () => {
  const live = { output_mode: 'phone', playing: true, heard: 3 * BAR };
  assert.deepEqual(outStrip({ stream: stream('playing'), live, tape: TAPE }),
    { hidden: false, resume: false, led: 'on', text: 'Playing on this phone', right: '0.8 s behind' });
  assert.equal(outStrip({ stream: stream('playing'), live: { ...live, playing: false }, tape: TAPE }).text, 'Ready on this phone');
  assert.deepEqual(outStrip({ stream: stream('buffering'), live, tape: TAPE }),
    { hidden: false, resume: false, led: 'wait', text: 'Starting on this phone…', right: 'buffering' });
  const lost = outStrip({ stream: stream('lost'), live, tape: TAPE });
  assert.equal(lost.text, 'Stream lost · paused at 4.1');
  assert.equal(lost.right, 'reconnecting');
  assert.equal(outStrip({ stream: stream('lost', { heard: { pos: 5 * BAR } }), live, tape: TAPE }).text, 'Stream lost · paused at 4.1', 'where the tape says it is heard, as the Studio has always said it');
  assert.equal(outStrip({ stream: stream('lost'), live, tape: { ...TAPE, grid: null } }).text, 'Stream lost · paused at the same spot');
  assert.deepEqual(outStrip({ stream: stream('locked'), live, tape: TAPE }),
    { hidden: false, resume: true, led: 'wait', text: 'Paused when the screen locked', right: '' });
  assert.equal(outStrip({ stream: stream('locked', { waitingTap: true }), live, tape: TAPE }).text, 'Still on this phone');
  assert.equal(outStrip({ stream: stream('playing'), live: { ...live, output_mode: 'both' }, tape: TAPE }).hidden, false, 'both: this phone too');
});

test('a locate this phone has not heard yet: the strip says where it is moving to, until then', () => {
  const live = { output_mode: 'phone', playing: true, heard: 0 };
  const ghost = { pos: 8 * BAR, until: 1000 };
  assert.deepEqual(outStrip({ stream: stream('playing'), live, tape: TAPE, ghost, now: 500 }),
    { hidden: false, resume: false, led: 'on', text: 'Moving to bar 9.1…', right: 'in 0.8 s' });
  assert.equal(outStrip({ stream: stream('playing'), live, tape: TAPE, ghost, now: 1000 }).text, 'Playing on this phone', 'heard by now');
  assert.equal(outStrip({ stream: stream('playing'), live, tape: { ...TAPE, grid: null }, ghost, now: 500 }).text, 'Playing on this phone', 'no bars to say it in');
  assert.equal(outStrip({ stream: stream('buffering'), live, tape: TAPE, ghost, now: 500 }).text, 'Starting on this phone…', 'the stream’s state comes first');
});

test('the lamp says who follows the tape’s clock, and is hidden with no clock sent', () => {
  assert.deepEqual(clockLamp(null, TAPE), { hidden: true });
  assert.deepEqual(clockLamp({ devices: ['MPC'], running: true, heard_bpm: 96 }, TAPE), { hidden: false, text: 'clock → MPC ● · hears 96 BPM', none: false });
  assert.deepEqual(clockLamp({ devices: ['MPC', 'TR-8'], running: false }, TAPE), { hidden: false, text: 'clock → MPC, TR-8', none: false });
  assert.deepEqual(clockLamp({ devices: [], running: false }, TAPE), { hidden: false, text: 'clock → no device plugged in', none: true });
  assert.deepEqual(clockLamp({ devices: [], running: false }, { ...TAPE, grid: null }), { hidden: false, text: 'clock: once the tape has a tempo', none: true });
});

// The bar draws them, in every room, from the tape's snapshot and the
// engine's stream: no Studio is mounted here.

let page = null;
afterEach(() => {
  page?.tape?.destroy();
  page?.engine?.transport?.destroy();
  page?.engine?.feed?.destroy();
  page = null;
});

async function open(live) {
  const pi = (url) => {
    if (url.startsWith('/api/tapes/state?id=t1')) return { tape: TAPE, loaded: true, live: { playing: false, heard: 0, count_in: 0, output: 'demo', output_mode: 'jam', ...live } };
    if (url === '/api/tapes') return { loaded: 't1', tapes: [] };
    return undefined;
  };
  page = await barPage({ engine: true, tape: true, tapes: { loaded: 't1' }, answer: pi });
  if (!page.tape.snapshot().tape) await new Promise((done) => { const off = page.tape.onChange((s) => { if (s.tape) { off(); done(); } }); });
  page.frames();
  return page;
}

test('the bar draws the clock-out lamp from the tape’s clock, with no Studio', async () => {
  const { $ } = await open({ clock: { devices: ['MPC'], running: true, heard_bpm: 96 } });
  assert.equal($('np-clock-out').hidden, false);
  assert.equal($('np-clock-out').textContent, 'clock → MPC ● · hears 96 BPM');
  assert.equal($('np-clock-out').classList.contains('none'), false);
});

test('the bar draws SYNC from the tape’s snapshot, with no Studio: lit while the tape plays lined up in the jam room (step 5c)', async () => {
  const { $ } = await open({ playing: true, aligned: 'exact' });
  const sync = $('np-sync');
  assert.equal(sync.hidden, false);
  assert.equal(sync.getAttribute('data-state'), 'ok');
  assert.match(sync.getAttribute('aria-label'), /^Sync: lined up to the sample/);
});

test('SYNC goes out while the tape is stopped', async () => {
  const { $ } = await open({ playing: false, aligned: 'none' });
  assert.equal($('np-sync').hidden, true);
});

test('SYNC goes out while the tape plays on a phone: nothing to line up', async () => {
  const { $ } = await open({ playing: true, aligned: 'none', output_mode: 'phone' });
  assert.equal($('np-sync').hidden, true);
  assert.equal($('np-sync').getAttribute('data-state'), 'off');
});

test('the bar draws the output strip while the tape plays on this phone, with no Studio, and its tap wakes the sound', async () => {
  const { $, engine } = await open({ output_mode: 'phone', playing: true });
  assert.equal($('np-out-strip').hidden, true, 'not heard here yet');
  const p = engine.stream;
  let state = 'playing', resumed = 0;
  Object.defineProperty(p, 'active', { get: () => true, configurable: true });
  Object.defineProperty(p, 'state', { get: () => state, configurable: true });
  p.delayMs = () => 800;
  p.heard = () => null;
  p.resume = () => { resumed++; };
  engine.transport.changed();
  assert.equal($('np-out-strip').hidden, false);
  assert.equal($('np-out-strip-text').textContent, 'Playing on this phone');
  assert.equal($('np-out-strip-right').textContent, '0.8 s behind');
  assert.equal($('np-out-strip-led').getAttribute('class'), 'out-led on');
  assert.equal($('np-out-strip-resume').hidden, true);
  state = 'locked';
  engine.transport.changed();
  assert.equal($('np-out-strip-text').textContent, 'Paused when the screen locked');
  assert.equal($('np-out-strip-resume').hidden, false);
  $('np-out-strip-resume').dispatchEvent({ type: 'click' });
  assert.equal(resumed, 1);
});

test('with a take in the bar, the strip still follows this phone’s sound as it changes', async () => {
  const { $, engine } = await open({ output_mode: 'phone', playing: true });
  const { aTake } = await import('./bar-harness.js');
  const take = aTake('jam_a.wav');
  engine.bar.loadTake(take.t, take.player);
  assert.equal(engine.bar.sourceKind, 'take');
  let state = 'playing';
  Object.defineProperty(engine.stream, 'active', { get: () => true, configurable: true });
  Object.defineProperty(engine.stream, 'state', { get: () => state, configurable: true });
  engine.stream.delayMs = () => 800;
  // The stream says its state changed as StreamPlayer's onState does: the
  // engine's tape source is told (tapeStream), not the bar.
  engine.tape.changed();
  assert.equal($('np-out-strip-text').textContent, 'Playing on this phone');
  state = 'buffering';
  engine.tape.changed();
  assert.equal($('np-out-strip-text').textContent, 'Starting on this phone…', 'repainted with the take still in the bar');
});

test('the strip says where a locate the Studio sent is moving to, from the hands it lends the bar', async () => {
  const { $, engine, np } = await open({ output_mode: 'phone', playing: true });
  Object.defineProperty(engine.stream, 'active', { get: () => true, configurable: true });
  Object.defineProperty(engine.stream, 'state', { get: () => 'playing', configurable: true });
  engine.stream.delayMs = () => 800;
  const off = np.tapeKeys.lend({ layers: null, armed: () => [], inputOf: () => '', playsHere: () => true, body: () => null, said() {}, hover() {}, ghost: () => ({ pos: 8 * BAR, until: performance.now() + 60000 }) });
  engine.transport.changed();
  assert.equal($('np-out-strip-text').textContent, 'Moving to bar 9.1…');
  off();
  engine.transport.changed();
  assert.equal($('np-out-strip-text').textContent, 'Playing on this phone', 'the hands taken back: no ghost');
});
