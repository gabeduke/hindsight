// web/static/lib/meter-readouts.test.js
// Capture's monitor in words (lib/meter.js readouts), which the Studio's
// feed draws too, and when a capture error is worth a toast (heldError).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readouts, heldError, CAPTURE_ERR_HOLD_MS } from './meter.js';

const base = {
  capture_healthy: true, capture_waiting: false, last_error: '',
  disk_free_gb: 229.4, min_free_gb: 2, xruns: 0, midi_bpm: 96, midi_connected: true, midi_devices: [],
};

test('a healthy ring reads as recording, with the readings plain', () => {
  const r = readouts(base);
  assert.deepEqual(r.health, { state: 'ok', text: 'recording', detail: '', error: '' });
  assert.deepEqual(r.disk, { text: '229 GB', level: '' });
  assert.deepEqual(r.xruns, { text: '0', level: '' });
  assert.deepEqual(r.tempo, { text: '96.0', level: '' });
  assert.equal(r.midi, 'none');
});

test('an interface switched off is waiting, not an error', () => {
  const r = readouts({ ...base, capture_healthy: false, capture_waiting: true, last_error: 'no device' });
  assert.equal(r.health.state, 'wait');
  assert.equal(r.health.text, 'waiting for the interface');
  assert.equal(r.health.error, '', 'nothing to toast');
});

test('a capture error says so, and carries the full text', () => {
  const r = readouts({ ...base, capture_healthy: false, last_error: 'Illegal combination of I/O devices' });
  assert.deepEqual(r.health, { state: 'bad', text: 'capture error', detail: 'Illegal combination of I/O devices', error: 'Illegal combination of I/O devices' });
  assert.equal(readouts({ ...base, capture_healthy: false }).health.text, 'no capture');
});

test('the readings warn as Capture’s tiles always have', () => {
  assert.deepEqual(readouts({ ...base, disk_free_gb: 12.34 }).disk, { text: '12.3 GB', level: '' });
  assert.equal(readouts({ ...base, disk_free_gb: 5 }).disk.level, 'warn');
  assert.equal(readouts({ ...base, disk_free_gb: 1.5 }).disk.level, 'bad');
  assert.deepEqual(readouts({ ...base, xruns: 3 }).xruns, { text: '3', level: 'warn' });
  assert.deepEqual(readouts({ ...base, midi_bpm: null, midi_connected: false }).tempo, { text: '–', level: 'warn' });
  assert.equal(readouts({ ...base, midi_devices: [{ name: 'EP-133', connected: true, clock: true }, { name: 'Gone', connected: false }, { name: 'Keys', connected: true }] }).midi, 'EP-133 (clock), Keys');
});

test('a capture error is toasted once, after it has stood a while', () => {
  let st = { text: '', since: 0, shown: false };
  let h = heldError(st, 'boom', 1000);
  assert.equal(h.show, '', 'not the moment it appears');
  st = h.state;
  h = heldError(st, 'boom', 1000 + CAPTURE_ERR_HOLD_MS - 1);
  assert.equal(h.show, '');
  h = heldError(h.state, 'boom', 1000 + CAPTURE_ERR_HOLD_MS);
  assert.equal(h.show, 'boom');
  h = heldError(h.state, 'boom', 1000 + CAPTURE_ERR_HOLD_MS * 3);
  assert.equal(h.show, '', 'once per failure');
  h = heldError(h.state, '', 9e9);
  h = heldError(h.state, 'boom', 9e9);
  h = heldError(h.state, 'boom', 9e9 + CAPTURE_ERR_HOLD_MS);
  assert.equal(h.show, 'boom', 'a repeat after a recovery toasts again');
});

// The Studio's feed lamp (docs/plan/the-studio-on-one-screen.md): its
// readouts moved behind it, so it is what says something is wrong.
test('the feed lamp is green while it records, amber or red when a readout says so', async () => {
  const { lampState } = await import('./meter.js');
  assert.equal(lampState(null), 'none', 'dark before the Pi has answered');
  assert.equal(lampState(readouts(base)), 'ok');
  assert.equal(lampState(readouts({ ...base, capture_healthy: false, capture_waiting: true })), 'warn', 'waiting for the interface');
  assert.equal(lampState(readouts({ ...base, capture_healthy: false, last_error: 'device lost' })), 'bad');
  assert.equal(lampState(readouts({ ...base, disk_free_gb: 1 })), readouts({ ...base, disk_free_gb: 1 }).disk.level === 'bad' ? 'bad' : 'warn', 'low disk lights it');
  assert.notEqual(lampState(readouts({ ...base, xruns: 40 })), 'ok', 'dropped buffers light it');
});
