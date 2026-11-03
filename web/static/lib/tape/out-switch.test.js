// The Output sheet's switch, shared by the rooms (OUT on the bar's display
// opens it): each place's name, and a choice that starts the sound inside
// the tap and never leaves the jam room silent.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { outName, outDelay, switchOutput, outputSheet } from './out-switch.js';
import { Refusal } from '../models/protocol.js';

let store, puts;
beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  puts = [];
});

// transport is the page's (lib/models/transport.js): its setOutput answers
// ok, or throws the Refusal in `fail` for that mode.
let transport;
function fakeTransport(fail = {}, log = []) {
  transport = {
    async setOutput(mode) {
      log.push(`put ${mode}`);
      puts.push(mode);
      if (fail[mode]) throw new Refusal({ status: 409, message: fail[mode] });
      return {};
    },
  };
}

function fakePlayer({ startFails = false, log = [] } = {}) {
  return {
    active: false,
    start() { log.push('start'); this.active = true; return startFails ? Promise.reject(new Error('no sound')) : Promise.resolve(); },
    stop() { log.push('stop'); this.active = false; },
    resume() { log.push('resume'); },
  };
}

// Each place's picture is tested with the icons, in lib/ui/icons.test.js.

test('names and delays read as the sheet says them', () => {
  assert.equal(outName('jam'), 'Jam room');
  assert.equal(outName('phone'), 'Phone');
  assert.equal(outName('both'), 'Both');
  assert.equal(outName(undefined), 'Jam room');
  assert.equal(outDelay(1234), '1.2 s');
  assert.equal(outDelay(0), '0.8 s');
  assert.equal(outDelay(undefined), '0.8 s');
});

test('choosing a phone starts the sound before the Pi is asked, and remembers the listener', async () => {
  const log = [];
  fakeTransport({}, log);
  const player = fakePlayer({ log });
  const ok = await switchOutput('phone', { player, transport, toast: () => assert.fail('no toast') });
  assert.equal(ok, true);
  assert.deepEqual(log, ['start', 'put phone']);
  assert.equal(localStorage.getItem('tape.listener'), '1');
});

test('a phone that never starts puts the tape back in the jam room', async () => {
  const log = [];
  fakeTransport({}, log);
  const player = fakePlayer({ startFails: true, log });
  const toasts = [];
  const ok = await switchOutput('phone', { player, transport, toast: (m, k) => toasts.push([m, k]) });
  assert.equal(ok, false);
  assert.deepEqual(puts, ['phone', 'jam']);
  assert.ok(log.includes('stop'));
  assert.deepEqual(toasts, [['no sound', 'bad']]);
});

test('a refused switch says why and stops what it started', async () => {
  fakeTransport({ both: 'the tape is mixing down' });
  const player = fakePlayer();
  const toasts = [];
  const ok = await switchOutput('both', { player, transport, toast: (m, k) => toasts.push([m, k]) });
  assert.equal(ok, false);
  assert.equal(player.active, false);
  assert.deepEqual(puts, ['both']);
  assert.deepEqual(toasts, [['the tape is mixing down', 'bad']]);
});

test('back to the jam room stops the sound here and forgets the listener', async () => {
  fakeTransport();
  localStorage.setItem('tape.listener', '1');
  const player = fakePlayer();
  player.active = true;
  const ok = await switchOutput('jam', { player, transport, toast: () => assert.fail('no toast') });
  assert.equal(ok, true);
  assert.equal(player.active, false);
  assert.equal(localStorage.getItem('tape.listener'), null);
});

test('outputSheet: the first open marks the mode and the delay at once, and every transport change after', () => {
  // Step 5c-1: the shell wires the Output sheet the first time it opens;
  // it must not show an unmarked sheet until the Pi's answer moves something.
  const changes = [];
  const transport = { mode: () => 'phone', streamDelayMs: () => 1200, refresh() {}, onChange: (fn) => changes.push(fn) };
  const engine = { tape: { title: 'T' }, transport, stream: { active: false }, output: { setMode() {} } };
  const painted = [];
  let opened = 0;
  const open = outputSheet(engine, { wire: () => ({ open: () => { opened++; } }), paint: (mode, delay) => painted.push([mode, delay]) });
  assert.deepEqual(painted, []);
  open();
  assert.deepEqual(painted, [['phone', '1.2 s']], 'marked as it first opens');
  assert.equal(opened, 1);
  transport.mode = () => 'jam';
  for (const fn of changes) fn();
  assert.deepEqual(painted.at(-1), ['jam', '1.2 s'], 'and on each change');
  open();
  assert.equal(changes.length, 1, 'wired once');
  assert.equal(outputSheet({ tape: null, transport }, { wire: () => assert.fail('no tape: nothing to send') })(), undefined);
});
