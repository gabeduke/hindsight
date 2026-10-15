import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  writeFor, unplugFor, replugFor, addName, removeName, fixWrite, armWrite, keepWrite, offerWrite, labelWrite, outputWrite, role,
} from './patch.js';
import { socketById } from './graph.js';

const fixture = () => JSON.parse(readFileSync(new URL('./testdata/sidekick.json', import.meta.url), 'utf8'));
const g = fixture();
const cable = (id) => g.cables.find((c) => c.id === id);
const URL_ = '/api/tapes?id=2026-10-15_rig-demo';

// The table in the spec's *Cables are settings*, row by row.
test('tap → track sets the track’s input and arms it too, either way round', () => {
  const want = { method: 'PATCH', url: URL_, body: { input: { n: 1, source: 'aux' }, rec_tracks: [1, 2, 3] } };
  assert.deepEqual(writeFor(g, 'kit.tap.aux', 'kit.track.1'), want);
  assert.deepEqual(writeFor(g, 'kit.track.1', 'kit.tap.aux'), want);
});

test('track → bus moves it, at once and undoably; its own bus is nothing', () => {
  assert.deepEqual(writeFor(g, 'kit.track.4', 'kit.bus.B'), { method: 'PATCH', url: URL_, body: { track: { n: 4, bus: 'B' } } });
  assert.equal(writeFor(g, 'kit.track.4', 'kit.bus.A'), null);
});

test('OUT → a phone plays it there as well', () => {
  assert.deepEqual(writeFor(g, 'phones.in', 'kit.out'), { method: 'PUT', url: '/api/tapes/output', body: { mode: 'both' } });
  assert.deepEqual(outputWrite('jam').body, { mode: 'jam' });
});

test('the kit’s clock into a device: TAPE_CLOCK=lead and the device into TAPE_CLOCK_OUT, on restart', () => {
  const w = writeFor(g, 'kit.clock-out', 'ep-136.midi-in');
  assert.equal(w.restart, true);
  assert.deepEqual(w.body, { TAPE_CLOCK: 'lead', TAPE_CLOCK_OUT: 'Demo sequencer,EP-136' });
});

test('a device’s clock into the kit: MIDI_CLOCK_DEVICE; the interface’s own is the default', () => {
  assert.deepEqual(writeFor(g, 'midi-demo-sequencer.midi-out', 'kit.clock-in').body, { MIDI_CLOCK_DEVICE: 'Demo sequencer' });
  assert.deepEqual(writeFor(g, 'ep-136.midi-out', 'kit.clock-in').body, { MIDI_CLOCK_DEVICE: null });
});

test('what a KEEP writes: one tap’s pair, or every input', () => {
  assert.deepEqual(writeFor(g, 'kit.tap.ch2', 'kit.keep').body, { SAVE_CHANNELS: '5,6', SAVE_ALL_CHANNELS: 'false' });
  assert.deepEqual(writeFor(g, 'ep-136.usb', 'kit.keep').body, { SAVE_ALL_CHANNELS: 'true' });
  assert.deepEqual(keepWrite(g, 'aux').body, { SAVE_CHANNELS: '7,8', SAVE_ALL_CHANNELS: 'false' });
  assert.deepEqual(keepWrite(g, 'all').body, { SAVE_ALL_CHANNELS: 'true' });
});

test('things that don’t go together plug nothing', () => {
  assert.equal(writeFor(g, 'kit.tap.main', 'kit.tap.ch1'), null);
  assert.equal(writeFor(g, 'kit.bus.A', 'ep-136.in2'), null, 'a return is the interface’s, not a setting');
  assert.equal(writeFor(g, 'ep-136.in1', 'kit.track.1'), null, 'a jack is a label, never a route');
  assert.equal(writeFor(g, 'kit.clock-out', 'kit.clock-in'), null);
});

test('unplugging writes the setting back', () => {
  assert.deepEqual(unplugFor(g, cable('input:2')).body, { input: { n: 2, source: '' }, rec_tracks: [3] });
  // The only clock out goes: the tape runs free.
  assert.deepEqual(unplugFor(g, cable('clock-out:midi-demo-sequencer')).body, { TAPE_CLOCK: 'free', TAPE_CLOCK_OUT: null });
  assert.deepEqual(unplugFor(g, cable('midi:midi-demo-sequencer')).body, { MIDI_IGNORE: 'Demo sequencer' });
  assert.deepEqual(unplugFor(g, cable('jack:ep-136.in1')), { method: 'PUT', url: '/api/rig/labels', body: { 'ep-136.in1': '' } });
  for (const id of ['usb:ep-136', 'return:A', 'bus:1', 'keep:main']) assert.equal(unplugFor(g, cable(id)), null, `${id} can't be pulled`);
});

test('a cable unplugged and still on until the restart can be plugged back', () => {
  const c = { ...cable('midi:midi-demo-sequencer'), pending: 'unplug' };
  const h = fixture();
  h.settings.find((l) => l.key === 'MIDI_IGNORE').value = 'demo';
  assert.equal(unplugFor(h, c), null);
  assert.deepEqual(replugFor(h, c).body, { MIDI_IGNORE: '' });
});

test('names go into and out of a list setting by the device they match, nudges and all', () => {
  const bento = { name: '1010music Bento', midi: ['Bento MIDI 1'], match: 'Bento' };
  assert.equal(addName('', bento), 'Bento');
  assert.equal(addName('bento:-4,smk', bento), 'bento:-4,smk');
  assert.equal(addName('smk', bento), 'smk,Bento');
  assert.equal(removeName('bento:-4, smk', bento), 'smk');
  assert.equal(removeName('ben,smk', bento), 'smk');
});

test('the inspector’s writes: the fix, arming, the offer, a label', () => {
  const w = { fix: { label: 'Move tracks 1, 4 to bus B', buses: [{ n: 1, bus: 'B' }, { n: 4, bus: 'B' }] } };
  assert.deepEqual(fixWrite(g, w), { method: 'PATCH', url: URL_, body: { buses: w.fix.buses } });
  assert.equal(fixWrite(g, { fix: null }), null);
  assert.deepEqual(armWrite(g, 4, true).body, { rec_tracks: [2, 3, 4] });
  assert.deepEqual(armWrite(g, 2, false).body, { rec_tracks: [3] });
  assert.equal(offerWrite(g), null, 'the Sidekick’s taps already are TAPE_SOURCES');
  assert.deepEqual(offerWrite({ ...g, offer: { settings: { TAPE_SOURCES: 'usb1-2=1,2' } } }).body, { TAPE_SOURCES: 'usb1-2=1,2' });
  assert.deepEqual(labelWrite('ep-136.in2', '  synth '), { method: 'PUT', url: '/api/rig/labels', body: { 'ep-136.in2': 'synth' } });
});

test('roles: what each socket does in a patch', () => {
  const r = (id) => role({ ...socketById(g, id), device: id.split('.')[0] });
  assert.equal(r('kit.tap.ch1'), 'tap');
  assert.equal(r('kit.clock-out'), 'clock-out');
  assert.equal(r('ep-136.in1'), 'jack');
  assert.equal(r('ep-136.midi-out'), 'dev-midi-out');
  assert.equal(r('phones.in'), 'listener');
});
