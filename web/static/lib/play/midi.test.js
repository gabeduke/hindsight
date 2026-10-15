import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Parser, decode, handler, support, attach, readBindings, BINDINGS_KEY } from './midi.js';
import { Surface } from './surface.js';

const parse = (bytes) => { const out = []; new Parser((m) => out.push(m)).feed(bytes); return out; };

test('running status: a status byte left out means the last one again', () => {
  assert.deepEqual(parse([0x90, 40, 100, 41, 90, 40, 0]), [[0x90, 40, 100], [0x90, 41, 90], [0x90, 40, 0]]);
});

test('realtime bytes between a message’s bytes, and SysEx, don’t break it', () => {
  assert.deepEqual(parse([0x90, 40, 0xF8, 100, 0xF0, 1, 2, 3, 0xF7, 0x80, 40, 0]), [[0xF8], [0x90, 40, 100], [0x80, 40, 0]]);
  // A program change has one data byte, and its status runs on too.
  assert.deepEqual(parse([0xC0, 3, 4]), [[0xC0, 3], [0xC0, 4]]);
  // System common ends running status: the bytes after it are not a note.
  assert.deepEqual(parse([0x90, 40, 100, 0xF2, 1, 2, 41, 90]), [[0x90, 40, 100]]);
});

test('a note-on with velocity 0 is a note-off', () => {
  assert.deepEqual(decode([0x90, 40, 0]), { type: 'off', ch: 1, note: 40, vel: 0 });
  assert.deepEqual(decode([0x99, 36, 64]), { type: 'on', ch: 10, note: 36, vel: 64 });
  assert.deepEqual(decode([0x80, 40, 30]), { type: 'off', ch: 1, note: 40, vel: 30 });
  assert.deepEqual(decode([0xB0, 64, 127]), { type: 'cc', ch: 1, cc: 64, value: 127 });
  assert.deepEqual(decode([0xFA]), { type: 'rt', rt: 'start' });
  assert.equal(decode([0xF8]), null, 'clock plays nothing');
});

test('note on and off press and release the pad they’re bound to', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const h = handler(s, { now: () => 0 });
  h.feed([0x90, 40, 100]);           // E2: BREAK
  assert.deepEqual(s.held(), ['break']);
  h.feed([0x90, 36, 90, 40, 0]);     // C2 on (track 1), then E2 off by running status and velocity 0
  assert.deepEqual(s.held(), ['track1']);
  h.feed([0x80, 36, 0]);
  assert.deepEqual(s.held(), []);
});

test('the sustain pedal latches, commands run on the press, the rooms’ verbs need the rooms', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const cmds = [];
  let rooms = false;
  const h = handler(s, { now: () => 0, onCommand: (id, d) => cmds.push([id, d]), has: (n) => n === 'rooms' && rooms });
  h.feed([0xB0, 64, 127, 0x90, 41, 100, 0x80, 41, 0]);
  assert.deepEqual(s.held(), ['reverse'], 'held by the pedal');
  h.feed([0xB0, 64, 0]);
  assert.deepEqual(s.held(), []);
  h.feed([0x90, 50, 100, 0x80, 50, 0]); // C3, CATCH: not without the rooms
  assert.deepEqual(cmds, []);
  rooms = true;
  h.feed([0x90, 50, 100, 0x80, 50, 0, 0xFC, 0xB0, 123, 0]);
  assert.deepEqual(cmds, [['catch', {}], ['transport', { rt: 'stop' }], ['panic', {}]]);
});

test('the FX: velocity at the press, the mod wheel and aftertouch while held, the wheel bends', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const arms = [];
  s.on('arm', (d) => arms.push([d.pad, d.v]));
  const got = [];
  const h = handler(s, {
    now: () => 0,
    onAmount: (id, v) => got.push(['amount', id, v]),
    onBend: (v) => got.push(['bend', v]),
    onMod: (id, v) => got.push(['mod', id, v]),
    onFormula: (n) => got.push(['formula', n]),
  });
  h.feed([0xD0, 127]);          // aftertouch with nothing held: nothing
  h.feed([0x90, 47, 127]);      // B2: FILTER, struck hard
  h.feed([0x90, 41, 64]);       // F2: REV -- a trick has no amount
  assert.deepEqual(s.held(), ['filter', 'reverse']);
  assert.deepEqual(arms, [['filter', 1], ['reverse', undefined]]);
  h.feed([0xB0, 1, 0]);         // the mod wheel: FILTER's amount
  h.feed([0xD0, 127]);          // channel aftertouch: the FX it holds
  h.feed([0xA0, 47, 0]);        // poly aftertouch on FILTER's key
  h.feed([0xA0, 41, 127]);      // on REV's: no amount to move
  h.feed([0xE0, 127, 127]);     // the wheel up, then down, then home
  h.feed([0xE0, 0, 0, 0xE0, 0, 64]);
  h.feed([0xB0, 23, 127]);      // DRIVE's knob
  h.feed([0xC0, 3]);            // program 3: WORN
  assert.deepEqual(got, [
    ['amount', 'filter', 0], ['amount', 'filter', 1], ['amount', 'filter', 0],
    ['bend', 1], ['bend', -1], ['bend', 0],
    ['mod', 'mod.drive', 1], ['formula', 3],
  ]);
});

test('unplugged with a pad down, it lets go', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const h = handler(s, { now: () => 0 });
  h.feed([0x90, 43, 100]);
  h.letGo();
  assert.deepEqual(s.held(), []);
});

test('its limits are said: no Web MIDI here, or not a secure page', () => {
  assert.equal(support({ secure: true, nav: {} }).ok, false);
  assert.match(support({ secure: true, nav: {} }).why, /Pi/);
  assert.match(support({ secure: false, nav: { requestMIDIAccess() {} } }).why, /https|localhost/);
  assert.equal(support({ secure: true, nav: { requestMIDIAccess() {} } }).ok, true);
});

// A stand-in MIDIAccess: inputs that can be sent bytes, plugged and pulled.
function fakeAccess(names) {
  const inputs = new Map(names.map((name, i) => [`in${i}`, { id: `in${i}`, name, type: 'input', state: 'connected', onmidimessage: null }]));
  const access = { inputs, onstatechange: null };
  return {
    access,
    send: (id, bytes) => inputs.get(id).onmidimessage?.({ data: Uint8Array.from(bytes) }),
    pull: (id) => { const p = inputs.get(id); p.state = 'disconnected'; access.onstatechange?.({ port: p }); },
  };
}
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('every input plays; pulling one lets go of what it held', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const f = fakeAccess(['SMK-37', 'Other']);
  let seen = [];
  const m = attach(f.access, s, { now: () => 0, onPorts: (n) => { seen = n; }, store: memory() });
  assert.deepEqual(seen, ['SMK-37', 'Other']);
  f.send('in0', [0x90, 40, 100]);
  f.send('in1', [0x90, 36, 100]);
  assert.deepEqual(s.held().sort(), ['break', 'track1']);
  f.pull('in0');
  assert.deepEqual(s.held(), ['track1']);
  assert.deepEqual(seen, ['Other']);
  m.close();
  assert.deepEqual(s.held(), []);
});

test('learn binds the next note from that controller, saved per port on this device', () => {
  const s = new Surface({ bpm: 120, division: 'off' });
  const f = fakeAccess(['SMK-37', 'Other']);
  const store = memory();
  const m = attach(f.access, s, { now: () => 0, store });
  let got = null;
  m.learn('SMK-37', 'stop', (b) => { got = b; });
  f.send('in1', [0x90, 60, 100]); // another controller: not this learn's
  assert.equal(got, null);
  f.send('in0', [0x90, 72, 100]); // C5
  assert.deepEqual(got, { note: 72, ch: 1 });
  assert.deepEqual(s.held().filter((p) => p === 'stop'), [], 'the note that taught it doesn’t also play');
  assert.deepEqual(readBindings(store)['SMK-37'].stop, [{ note: 72, ch: 1 }]);
  assert.ok(store.getItem(BINDINGS_KEY));
  f.send('in0', [0x80, 72, 0, 0x90, 72, 100]);
  assert.ok(s.held().includes('stop'));
  assert.equal(m.bindings('Other').stop[0].note, 43, 'the other controller keeps its own');
});
