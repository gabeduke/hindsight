import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wsURL, meterWidth, fmtClock, canRecordHere } from './recorder.js';

test('the socket follows the page: wss on https, ws on http', () => {
  assert.equal(wsURL({ protocol: 'https:', host: 'pi.tail1234.ts.net' }), 'wss://pi.tail1234.ts.net/api/phone');
  assert.equal(wsURL({ protocol: 'http:', host: '192.168.1.20:5000' }), 'ws://192.168.1.20:5000/api/phone');
});

test('the meter spans 60 dB', () => {
  assert.equal(meterWidth(0), 0);
  assert.equal(meterWidth(1), 1);
  assert.equal(meterWidth(2), 1);
  assert.ok(Math.abs(meterWidth(0.001) - 0) < 1e-9);
  assert.ok(Math.abs(meterWidth(Math.pow(10, -30 / 20)) - 0.5) < 1e-9);
});

test('elapsed time reads m:ss', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(61.9), '1:01');
  assert.equal(fmtClock(3600), '60:00');
});

test('plain http explains itself instead of failing', () => {
  assert.match(canRecordHere({ isSecureContext: false }), /HTTPS/);
  assert.match(canRecordHere({ isSecureContext: true, navigator: {} }), /browser/);
  assert.equal(canRecordHere({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } }, AudioWorkletNode: class {} }), '');
});

test('plain http points at the hub\'s secure address when there is one', () => {
  assert.match(canRecordHere({ isSecureContext: false }, 'https://mike.hindsight.leetserve.com'), /secure address to record/);
  assert.doesNotMatch(canRecordHere({ isSecureContext: false }, 'https://mike.hindsight.leetserve.com'), /tailscale/);
});
