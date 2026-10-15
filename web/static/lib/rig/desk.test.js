import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { desk, allSockets } from './desk.js';
import { sockets, cablesAt, warningsAt, title, levelWords } from './graph.js';

// The demo's rig, as GET /api/rig answered it: the Sidekick's profile, the
// demo's sequencer on MIDI, tracks 2 and 3 armed from CH1 and CH2, tracks 1
// and 4 playing on bus A, two labels, and the kit's clock plugged into the
// sequencer and waiting for a restart.
const g = JSON.parse(readFileSync(new URL('./testdata/sidekick.json', import.meta.url), 'utf8'));

test('the graph draws from its JSON alone: every socket once, the interface first', () => {
  const d = desk(g);
  const drawn = allSockets(d).map((s) => s.id);
  const all = sockets(g).map((s) => s.id);
  assert.deepEqual([...drawn].sort(), [...all].sort(), 'every socket in the graph is drawn');
  assert.equal(new Set(drawn).size, drawn.length, 'and only once');
  assert.equal(d.devices[0].id, 'ep-136');
  assert.equal(d.devices[0].sub, 'USB · 8 in · 4 out');
  assert.deepEqual(d.rows.map((r) => r.id), ['taps', 'tracks', 'back', 'midi']);
  assert.deepEqual(d.rows[0].sockets.map((s) => s.id), ['kit.usb', 'kit.tap.main', 'kit.tap.ch1', 'kit.tap.ch2', 'kit.tap.aux']);
  assert.equal(d.rows[0].title, 'From the Sidekick · USB taps');
});

test('every socket has a name a screen reader can say, with what is in it', () => {
  for (const s of allSockets(desk(g))) assert.ok(s.spoken && !/undefined/.test(s.spoken), `${s.id}: ${s.spoken}`);
  const t2 = allSockets(desk(g)).find((s) => s.id === 'kit.track.2');
  assert.match(t2.spoken, /^Track 2, armed, 2 cables, records the tape$/);
  const in1 = allSockets(desk(g)).find((s) => s.id === 'ep-136.in1');
  assert.match(in1.spoken, /guitar/);
});

test('the warning is on the tap and the armed track it reaches', () => {
  assert.equal(warningsAt(g, 'kit.tap.ch1').length, 1);
  assert.equal(warningsAt(g, 'kit.track.2').length, 1);
  assert.equal(warningsAt(g, 'kit.track.3').length, 0);
  assert.equal(cablesAt(g, 'kit.tap.ch1').length, 1);
});

test('titles and levels read as the inspector says them', () => {
  const by = (id) => sockets(g).find((s) => s.id === id);
  assert.equal(title(g, by('kit.tap.ch1')), 'CH1 tap · USB 3/4');
  assert.equal(title(g, by('kit.bus.A')), 'Bus A');
  assert.equal(title(g, by('ep-136.in1')), 'Sidekick · IN 1');
  assert.equal(levelWords(-32.4), '−32 dBFS peak');
  assert.equal(levelWords(-120), 'silent');
  assert.equal(levelWords(undefined), 'no reading');
});
