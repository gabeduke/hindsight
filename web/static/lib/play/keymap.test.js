import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KEYMAP, COMMANDS, TRACK_PADS, TRICK_PADS, padForKey, commandForKey, typingInto, bindKeyboard } from './keymap.js';
import { FX_PADS } from './controls.js';
import { Surface } from './surface.js';

/** A target that behaves enough like the document for the adapter. */
function fakeTarget() {
  const listeners = new Map();
  const capture = new Map();
  return {
    hidden: false,
    addEventListener: (n, fn, opts) => {
      (listeners.get(n) || listeners.set(n, new Set()).get(n)).add(fn);
      capture.set(n, opts === true || !!opts?.capture);
    },
    removeEventListener: (n, fn) => listeners.get(n)?.delete(fn),
    send(n, ev = {}) {
      for (const fn of listeners.get(n) || []) fn({ preventDefault() {}, stopPropagation() {}, ...ev });
    },
    captures: (n) => !!capture.get(n),
    count: (n) => (listeners.get(n) || new Set()).size,
  };
}

test('every pad on the screen has a key, and every key a pad', () => {
  const mapped = new Set(Object.values(KEYMAP));
  for (const pad of [...TRACK_PADS, ...TRICK_PADS, ...FX_PADS]) {
    assert.ok(mapped.has(pad), `${pad} has no key`);
  }
  // And nothing is mapped that the screen does not draw.
  const drawn = new Set([...TRACK_PADS, ...TRICK_PADS, ...FX_PADS]);
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
  assert.equal(commandForKey('Escape'), 'panic');
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
  assert.deepEqual(cmds, ['transport', 'panic']);
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

test('while bound, Play mode owns the keyboard: no key reaches the page', () => {
  // The tape page's own keys live on the same document: R is ● Rec and 1-4
  // arm a track. Under a jam, Stop would arm a punch. So the adapter listens
  // in the capture phase, ahead of the page, and stops every key -- the ones
  // it plays, and the ones it doesn't.
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  assert.ok(t.captures('keydown') && t.captures('keyup'), 'listens ahead of the page');
  const stopped = [];
  for (const [n, code, extra] of [['keydown', 'KeyR'], ['keydown', 'Digit1'], ['keydown', 'KeyR', { repeat: true }],
    ['keydown', 'KeyK'], ['keydown', 'Space'], ['keyup', 'KeyR'], ['keyup', 'KeyK']]) {
    let stop = false;
    t.send(n, { code, target: { tagName: 'BODY' }, stopPropagation: () => { stop = true; }, ...extra });
    stopped.push(stop);
  }
  assert.deepEqual(stopped, [true, true, true, true, true, true, true]);

  // A field keeps its keys, and so does whatever is listening to it.
  let stop = false;
  t.send('keydown', { code: 'KeyR', target: { tagName: 'INPUT' }, stopPropagation: () => { stop = true; } });
  assert.equal(stop, false);
});

test('folded, the keys are the page’s: R records and 1 arms track 1; unfolded, R is STOP and 1 drops track 1 out', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  let unfolded = false;
  bindKeyboard(s, { target: t, win: null, now: () => 0, owns: () => unfolded });
  const send = (code) => {
    let stopped = false;
    t.send('keydown', { code, target: { tagName: 'BODY' }, stopPropagation: () => { stopped = true; } });
    return stopped;
  };
  // Folded: nothing pressed, and nothing stopped, so the tape page's own
  // listener -- ● Rec on R, arm on 1 -- hears the key.
  assert.equal(send('KeyR'), false);
  assert.equal(send('Digit1'), false);
  assert.deepEqual(s.held(), []);
  // Unfolded: the strip's.
  unfolded = true;
  assert.equal(send('KeyR'), true);
  assert.equal(send('Digit1'), true);
  assert.deepEqual(s.held().sort(), ['stop', 'track1']);
});

test('a key let up after the keys went back to the page still lets its pad go', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  let owned = true;
  bindKeyboard(s, { target: t, win: null, now: () => 0, owns: () => owned });
  t.send('keydown', { code: 'KeyQ', target: { tagName: 'BODY' } });
  assert.deepEqual(s.held(), ['break']);
  owned = false; // a tap on the lanes, with Q still down
  t.send('keyup', { code: 'KeyQ', target: { tagName: 'BODY' } });
  assert.deepEqual(s.held(), [], 'BREAK must not stick because the keys moved');
});

test('the Studio’s verbs are keys only with the two rooms on', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  let rooms = false;
  const cmds = [];
  bindKeyboard(s, { target: t, win: null, now: () => 0, onCommand: (c) => cmds.push(c), has: (n) => n === 'rooms' && rooms });
  for (const code of ['KeyC', 'KeyG', 'KeyK', 'Enter']) t.send('keydown', { code, target: { tagName: 'BODY' } });
  assert.deepEqual(cmds, []);
  rooms = true;
  for (const code of ['KeyC', 'KeyG', 'KeyK', 'Enter']) t.send('keydown', { code, target: { tagName: 'BODY' } });
  assert.deepEqual(cmds, ['catch', 'grab', 'keep', 'drop']);
  assert.deepEqual(s.held(), []);
});

test('⇧ is the latch: a pad let go under it stays held until ⇧ lifts', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  const k = (n, code) => t.send(n, { code, target: { tagName: 'BODY' } });
  k('keydown', 'ShiftLeft');
  k('keydown', 'KeyW');
  k('keyup', 'KeyW');
  assert.deepEqual(s.held(), ['reverse'], 'latched');
  k('keyup', 'ShiftLeft');
  assert.deepEqual(s.held(), []);
});

test('T Y U I play the punch-in FX; the crate’s pads are taken, but play nothing yet', () => {
  assert.deepEqual(['KeyT', 'KeyY', 'KeyU', 'KeyI'].map((c) => padForKey(c)), ['roll', 'filter', 'echo', 'crush']);
  for (const code of ['Digit5', 'Digit0']) {
    assert.equal(padForKey(code), null, code);
    assert.equal(commandForKey(code), null, code);
  }
});

test('⌘ with a key is the page’s, even while the strip has the keys', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  bindKeyboard(s, { target: t, win: null, now: () => 0 });
  let stopped = false;
  t.send('keydown', { code: 'KeyZ', metaKey: true, target: { tagName: 'BODY' }, stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, false, '⌘Z undoes on the page');
  assert.deepEqual(s.held(), [], 'and is not ½×');
});

test('↵ is DROP, but a button Tab brought the focus to keeps it; a clicked one gives it up', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const t = fakeTarget();
  const cmds = [];
  bindKeyboard(s, { target: t, win: null, now: () => 0, onCommand: (c) => cmds.push(c), has: () => true });
  const button = (id = '') => {
    const b = { tagName: 'BUTTON', id };
    b.closest = (sel) => (sel === 'button:not(#play)' && id !== 'play' ? b : null);
    return b;
  };
  const loop = button();
  // Tab to Loop, then ↵: Loop's.
  t.send('keydown', { code: 'Tab', target: { tagName: 'BODY', closest: () => null } });
  t.send('focusin', { target: loop });
  t.send('keydown', { code: 'Enter', target: loop });
  assert.deepEqual(cmds, []);
  // Click a track's ●, then ↵: DROP.
  const rec = button();
  t.send('pointerdown', { target: rec });
  t.send('focusin', { target: rec });
  t.send('keydown', { code: 'Enter', target: rec });
  assert.deepEqual(cmds, ['drop']);
  // ▶, however it was focused, never keeps it.
  const play = button('play');
  t.send('keydown', { code: 'Tab', target: { tagName: 'BODY', closest: () => null } });
  t.send('focusin', { target: play });
  t.send('keydown', { code: 'Enter', target: play });
  assert.deepEqual(cmds, ['drop', 'drop']);
});

test('a focused knob keeps its keys: its arrows turn it, and T doesn’t play', () => {
  const slider = { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'slider' : null) };
  assert.equal(typingInto(slider), true);
  assert.equal(typingInto({ tagName: 'BUTTON', getAttribute: () => null }), false);
});
