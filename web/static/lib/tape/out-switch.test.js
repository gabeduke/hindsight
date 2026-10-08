// The output button and the switch it makes, shared by Tape, Takes and
// Capture: its picture and name for each place, and a choice that starts the
// sound inside the tap and never leaves the jam room silent.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { outIcon, outName, outDelay, paintOutButtons, switchOutput } from './out-switch.js';

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

// fetch answers each PUT with ok, or with the error in `fail` for that mode.
function fakeFetch(fail = {}, log = []) {
  globalThis.fetch = async (url, init) => {
    const { mode } = JSON.parse(init.body);
    log.push(`put ${mode}`);
    puts.push(mode);
    if (fail[mode]) return { ok: false, status: 409, json: async () => ({ error: fail[mode] }) };
    return { ok: true, status: 200, json: async () => ({}) };
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

test('each place has its own picture: a speaker, headphones, or both', () => {
  assert.match(outIcon('jam'), /M3 9\.5/);
  assert.doesNotMatch(outIcon('jam'), /a8 8/);
  assert.match(outIcon('phone'), /a8 8/);
  assert.doesNotMatch(outIcon('phone'), /M3 9\.5/);
  assert.match(outIcon('both'), /M3 9\.5/);
  assert.match(outIcon('both'), /a8 8/);
  assert.match(outIcon('both'), /width="38"/);
  assert.equal(outIcon('anything'), outIcon('jam'));
});

test('names and delays read as the sheet says them', () => {
  assert.equal(outName('jam'), 'Jam room');
  assert.equal(outName('phone'), 'Phone');
  assert.equal(outName('both'), 'Both');
  assert.equal(outName(undefined), 'Jam room');
  assert.equal(outDelay(1234), '1.2 s');
  assert.equal(outDelay(0), '0.8 s');
  assert.equal(outDelay(undefined), '0.8 s');
});

test('the buttons show the place, and hide while the Pi has not said', () => {
  const button = () => {
    const slot = { innerHTML: '' }, text = { textContent: 'Jam room' };
    const attrs = {};
    return {
      hidden: true, dataset: {}, slot, text, attrs,
      querySelector: (sel) => (sel === '.out-ico-slot' ? slot : text),
      setAttribute: (k, v) => { attrs[k] = v; },
    };
  };
  const bs = [button(), button()];
  const doc = { querySelectorAll: () => bs };
  paintOutButtons('phone', doc);
  for (const b of bs) {
    assert.equal(b.hidden, false);
    assert.equal(b.text.textContent, 'Phone');
    assert.equal(b.attrs['aria-label'], 'Output: Phone');
    assert.match(b.slot.innerHTML, /a8 8/);
  }
  paintOutButtons(null, doc);
  assert.ok(bs.every((b) => b.hidden));
});

test('choosing a phone starts the sound before the Pi is asked, and remembers the listener', async () => {
  const log = [];
  fakeFetch({}, log);
  const player = fakePlayer({ log });
  const ok = await switchOutput('phone', { player, toast: () => assert.fail('no toast') });
  assert.equal(ok, true);
  assert.deepEqual(log, ['start', 'put phone']);
  assert.equal(localStorage.getItem('tape.listener'), '1');
});

test('a phone that never starts puts the tape back in the jam room', async () => {
  const log = [];
  fakeFetch({}, log);
  const player = fakePlayer({ startFails: true, log });
  const toasts = [];
  const ok = await switchOutput('phone', { player, toast: (m, k) => toasts.push([m, k]) });
  assert.equal(ok, false);
  assert.deepEqual(puts, ['phone', 'jam']);
  assert.ok(log.includes('stop'));
  assert.deepEqual(toasts, [['no sound', 'bad']]);
});

test('a refused switch says why and stops what it started', async () => {
  fakeFetch({ both: 'the tape is mixing down' });
  const player = fakePlayer();
  const toasts = [];
  const ok = await switchOutput('both', { player, toast: (m, k) => toasts.push([m, k]) });
  assert.equal(ok, false);
  assert.equal(player.active, false);
  assert.deepEqual(puts, ['both']);
  assert.deepEqual(toasts, [['the tape is mixing down', 'bad']]);
});

test('back to the jam room stops the sound here and forgets the listener', async () => {
  fakeFetch();
  localStorage.setItem('tape.listener', '1');
  const player = fakePlayer();
  player.active = true;
  const ok = await switchOutput('jam', { player, toast: () => assert.fail('no toast') });
  assert.equal(ok, true);
  assert.equal(player.active, false);
  assert.equal(localStorage.getItem('tape.listener'), null);
});
