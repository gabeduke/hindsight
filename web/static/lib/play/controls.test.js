import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONTROLS, HELD, AMOUNT, LATCHED, COMMAND, MODIFIER, control, live, keyTables, keyLabel,
  BUFFER_KEYS, STUDIO_KEYS, TRACK_PADS, TRICK_PADS, VERBS, noteName, bindingLabel, defaultBindings,
  matches, actionFor, learned, bind, legendFor,
} from './controls.js';
import { KEYMAP, COMMANDS } from './keymap.js';
import { BUFFER_KEYS as BUFFER_TABLE } from '../buffer/keys.js';

const rooms = (n) => n === 'rooms';

test('every action has an id once, a kind, and a key or a MIDI default', () => {
  const ids = CONTROLS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CONTROLS) {
    assert.ok([HELD, AMOUNT, LATCHED, COMMAND, MODIFIER].includes(c.kind), `${c.id}: ${c.kind}`);
    const keys = [...(c.play || []), ...(c.edit || [])];
    assert.ok(keys.length || (c.midi && c.midi.length), `${c.id} has no way to play it`);
  }
});

test('the keyboard’s tables and the buffer’s keys come from this list, and nowhere else', () => {
  // KEYMAP: each play key of a live held pad, and nothing besides.
  const want = {};
  const cmds = {};
  for (const c of CONTROLS) {
    if (!live(c, () => true)) continue;
    for (const k of c.play || []) (c.kind === HELD ? want : cmds)[k] = c.id;
  }
  assert.deepEqual(KEYMAP, want);
  assert.deepEqual(COMMANDS, cmds);
  // The buffer's table is the list's edit keys for the buffer.
  assert.equal(BUFFER_TABLE, BUFFER_KEYS);
  assert.deepEqual(BUFFER_KEYS.map((k) => `${k.shift ? '⇧' : ''}${k.code}:${k.action}:${k.when}`).sort(), [
    'Backspace:toss:open', 'BracketLeft:in-back:open', 'BracketRight:in-on:open', 'Delete:toss:open',
    'Enter:drop:held', 'KeyG:grab:studio', 'KeyK:keep:open', 'NumpadEnter:drop:held',
    '⇧BracketLeft:out-back:open', '⇧BracketRight:out-on:open',
  ]);
  assert.deepEqual(STUDIO_KEYS, [{ code: 'KeyC', action: 'catch' }, { code: 'KeyK', action: 'keep' }, { code: 'KeyM', action: 'click' }]);
});

test('no key does two jobs, in either table', () => {
  for (const side of ['play', 'edit']) {
    const seen = new Map();
    for (const c of CONTROLS) {
      for (const k of c[side] || []) {
        // K and ↵ are both the buffer's and the Studio's while editing: the
        // buffer's K while it's open, KEEP of the feed otherwise -- one verb.
        assert.ok(!seen.has(k) || seen.get(k) === c.id, `${side} ${k}: ${seen.get(k)} and ${c.id}`);
        seen.set(k, c.id);
      }
    }
  }
});

test('the pads are the ones the Pi plays, by the same names', () => {
  const go = readFileSync(new URL('../../../../internal/tape/trick.go', import.meta.url), 'utf8');
  const names = [...go.matchAll(/^\s*Pad\w+\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  for (const id of [...TRACK_PADS, ...TRICK_PADS]) assert.ok(names.includes(id), `${id} is not a pad on the Pi`);
  assert.deepEqual(TRACK_PADS, ['track1', 'track2', 'track3', 'track4']);
  assert.deepEqual(TRICK_PADS, ['break', 'reverse', 'chop', 'stop', 'half', 'double']);
  assert.deepEqual(VERBS, ['catch', 'grab', 'drop', 'keep']);
});

test('the defaults start at note 36 and count up: tracks, tricks, FX, then the verbs', () => {
  const order = ['track1', 'track2', 'track3', 'track4', 'break', 'reverse', 'chop', 'stop', 'half', 'double',
    'roll', 'filter', 'echo', 'crush', 'catch', 'grab', 'drop', 'keep'];
  order.forEach((id, i) => assert.equal(control(id).midi[0].note, 36 + i, id));
  const d = defaultBindings();
  assert.deepEqual(d.latch, [{ cc: 64 }]);
  assert.deepEqual(d.filter, [{ note: 47 }, { cc: 1, as: 'amount' }]);
  assert.deepEqual(d['mod.wow'], [{ cc: 21, as: 'amount' }]);
  assert.deepEqual(d.bend, [{ bend: true }]);
  d.track1[0].note = 99;
  assert.equal(control('track1').midi[0].note, 36, 'a copy, not the list itself');
});

test('the verbs and the click’s M are the rooms’; P4 and the crate pads aren’t live yet', () => {
  assert.equal(live(control('catch'), () => false), false);
  assert.equal(live(control('catch'), rooms), true);
  assert.equal(live(control('break'), () => false), true);
  for (const id of ['roll', 'filter', 'echo', 'crush', 'bend', 'mod.wow', 'crate.1']) assert.equal(live(control(id), () => true), false, id);
  assert.equal(keyTables(() => false).commands.KeyK, undefined, 'K stays the page’s click with the rooms off');
  assert.equal(keyTables(rooms).commands.KeyK, 'keep');
});

test('names: keys and notes', () => {
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit1'), '1');
  assert.equal(keyLabel('Shift+BracketLeft'), '⇧[');
  assert.equal(keyLabel('Enter'), '↵');
  assert.equal(noteName(36), 'C2');
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C♯4');
  assert.equal(noteName(128), '');
  assert.equal(bindingLabel({ cc: 64 }), 'CC 64');
  assert.equal(bindingLabel(null), '–');
});

test('a message finds its action; a channel narrows it; amounts are P4’s', () => {
  const b = defaultBindings();
  assert.deepEqual(actionFor(b, { type: 'on', ch: 1, note: 40 })?.id, 'break');
  assert.deepEqual(actionFor(b, { type: 'off', ch: 1, note: 40 })?.id, 'break');
  assert.equal(actionFor(b, { type: 'cc', ch: 1, cc: 64 })?.id, 'latch');
  assert.equal(actionFor(b, { type: 'cc', ch: 1, cc: 1 }), null, 'the mod wheel is FILTER’s amount, not a press');
  assert.equal(actionFor(b, { type: 'cc', ch: 1, cc: 1 }, { amounts: true })?.id, 'filter');
  assert.equal(actionFor(b, { type: 'rt', rt: 'start' })?.id, 'transport');
  const ch10 = { track1: [{ note: 36, ch: 10 }] };
  assert.equal(actionFor(ch10, { type: 'on', ch: 1, note: 36 }), null);
  assert.equal(actionFor(ch10, { type: 'on', ch: 10, note: 36 })?.id, 'track1');
  assert.equal(matches({ note: 36 }, { type: 'cc', cc: 36 }), false);
});

test('learning writes one binding and takes it off any other action', () => {
  const b0 = defaultBindings();
  const got = learned({ type: 'on', ch: 2, note: 40 });
  assert.deepEqual(got, { note: 40, ch: 2 });
  assert.equal(learned({ type: 'off', note: 40 }), null, 'a note-off teaches nothing');
  const b = bind(b0, 'stop', got);
  assert.deepEqual(b.stop, [{ note: 40, ch: 2 }]);
  assert.deepEqual(b.break, [], 'E2 played BREAK; now it plays STOP only');
  const f = bind(b0, 'filter', { cc: 74 });
  assert.deepEqual(f.filter, [{ cc: 74 }, { cc: 1, as: 'amount' }], 'its amount stays');
});

test('a pad’s legend follows where it’s played from', () => {
  const b = bind(defaultBindings(), 'track2', { note: 48 });
  assert.equal(legendFor('break', 'keys', { has: () => false }), 'Q');
  assert.equal(legendFor('catch', 'keys', { has: () => false }), '', 'no key without the rooms');
  assert.equal(legendFor('catch', 'keys', { has: rooms }), 'C');
  assert.equal(legendFor('break', 'touch'), '');
  assert.equal(legendFor('track1', 'midi', { bindings: b }), 'C2');
  assert.equal(legendFor('track2', 'midi', { bindings: b }), 'C3');
  assert.equal(legendFor('echo', 'midi', { bindings: b }), '–', 'C3 moved to track 2');
});
