import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYMAP, COMMANDS, TRACK_PADS, TRICK_PADS, padForKey, commandForKey, typingInto, bindKeyboard } from './keymap.js';
import { Surface } from './surface.js';

/** A target that behaves enough like the document for the adapter. */
function fakeTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener: (n, fn) => { (listeners.get(n) || listeners.set(n, new Set()).get(n)).add(fn); },
    removeEventListener: (n, fn) => listeners.get(n)?.delete(fn),
    send(n, ev = {}) {
      for (const fn of listeners.get(n) || []) fn({ preventDefault() {}, ...ev });
    },
    count: (n) => (listeners.get(n) || new Set()).size,
  };
}

test('every pad on the screen has a key, and every key a pad', () => {
  const mapped = new Set(Object.values(KEYMAP));
  for (const pad of [...TRACK_PADS, ...TRICK_PADS]) {
    assert.ok(mapped.has(pad), `${pad} has no key`);
  }
  // And nothing is mapped that the screen does not draw.
  const drawn = new Set([...TRACK_PADS, ...TRICK_PADS]);
  for (const pad of mapped) assert.ok(drawn.has(pad), `${pad} is mapped but not drawn`);
});

test('no key does two jobs', () => {
  const codes = [...Object.keys(KEYMAP), ...Object.keys(COMMANDS)];
  assert.equal(new Set(codes).size, codes.length);
  // And no pad shares a key with another pad.
  const pads = Object.values(KEYMAP);
  assert.equal(new Set(pads).size, pads.length);
});

test('keys are read by physical position, not by letter', () => {
  // Every mapped code is a `code` value (KeyQ, Digit1), never a `key` value
  // (q, 1) -- which is what keeps the layout under the same fingers on AZERTY.
  for (const code of Object.keys(KEYMAP)) {
    assert.match(code, /^(Key[A-Z]|Digit[0-9])$/, `${code} is not a physical code`);
  }
});

test('padForKey and commandForKey', () => {
  assert.equal(padForKey('KeyQ'), 'break');
  assert.equal(padForKey('Digit3'), 'track3');
  assert.equal(padForKey('KeyP'), null);
  assert.equal(commandForKey('Space'), 'transport');
  assert.equal(commandForKey('Escape'), 'exit');
  assert.equal(commandForKey('KeyQ'), null);
});

test('typing into a field is not playing', () => {
  assert.ok(typingInto({ tagName: 'INPUT' }));
  assert.ok(typingInto({ tagName: 'TEXTAREA' }));
  assert.ok(typingInto({ isContentEditable: true }));
  assert.ok(!typingInto({ tagName: 'DIV' }));
  assert.ok(!typingInto(null));
});

test('a key down presses and a key up releases', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  let time = 0;
  bindKeyboard(s, { target: t, win: null, now: () => time });

  t.send('keydown', { code: 'KeyQ', target: { tagName: 'BODY' } });
  assert.deepEqual(s.held(), ['break']);
  time = 50;
  t.send('keyup', { code: 'KeyQ', target: { tagName: 'BODY' } });
  assert.deepEqual(s.held(), []);
});

test('autorepeat is not a second press', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  const fires = [];
  s.on('fire', (d) => fires.push(d.pad));
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  const ev = { code: 'KeyQ', target: { tagName: 'BODY' } };
  t.send('keydown', ev);
  t.send('keydown', { ...ev, repeat: true });
  t.send('keydown', { ...ev, repeat: true });
  assert.deepEqual(fires, ['break']);
});

test('keys typed into a field never reach the instrument', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  t.send('keydown', { code: 'KeyQ', target: { tagName: 'INPUT' } });
  assert.deepEqual(s.held(), [], 'naming a take must not break the tape');
});

test('commands are delivered and do not become pads', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  const cmds = [];
  bindKeyboard(s, { target: t, win: null, now: () => 0, onCommand: (c) => cmds.push(c) });
  t.send('keydown', { code: 'Space', target: { tagName: 'BODY' } });
  t.send('keydown', { code: 'Escape', target: { tagName: 'BODY' } });
  assert.deepEqual(cmds, ['transport', 'exit']);
  assert.deepEqual(s.held(), []);
});

test('Space is prevented, so it never scrolls the page under the pads', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  let prevented = false;
  t.send('keydown', { code: 'Space', target: { tagName: 'BODY' }, preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
});

test('losing the window releases everything', () => {
  // The bug this exists for: alt-tab with break held and no keyup ever
  // arrives, so the tape stays broken with no key left to fix it.
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  const winListeners = new Map();
  const win = {
    addEventListener: (n, fn) => { (winListeners.get(n) || winListeners.set(n, new Set()).get(n)).add(fn); },
    removeEventListener: (n, fn) => winListeners.get(n)?.delete(fn),
    blur: () => { for (const fn of winListeners.get('blur') || []) fn(); },
  };
  bindKeyboard(s, { target: t, win, now: () => 0 });
  t.send('keydown', { code: 'KeyQ', target: { tagName: 'BODY' } });
  assert.deepEqual(s.held(), ['break']);
  win.blur();
  assert.deepEqual(s.held(), [], 'a held pad must not survive losing focus');
});

test('a hidden tab releases everything', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  t.send('keydown', { code: 'KeyQ', target: { tagName: 'BODY' } });
  t.hidden = true;
  t.send('visibilitychange');
  assert.deepEqual(s.held(), []);
});

test('unbinding removes every listener and lets go', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  const off = bindKeyboard(s, { target: t, win: null, now: () => 0 });
  t.send('keydown', { code: 'KeyQ', target: { tagName: 'BODY' } });
  off();
  assert.deepEqual(s.held(), [], 'leaving Play mode stops the sound');
  assert.equal(t.count('keydown'), 0);
  assert.equal(t.count('keyup'), 0);
  assert.equal(t.count('visibilitychange'), 0);
});
