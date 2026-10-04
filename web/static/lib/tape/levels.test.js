import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterFill, quietNote, levelText } from './levels.js';

test('meterFill maps -60..0 dB onto the meter', () => {
  assert.equal(meterFill(-120), 0);
  assert.equal(meterFill(-60), 0);
  assert.equal(meterFill(-30), 0.5);
  assert.equal(meterFill(0), 1);
  assert.equal(meterFill(3), 1);
  assert.equal(meterFill(undefined), 0);
});

test('quietNote speaks up for a silent or very quiet catch only', () => {
  assert.match(quietNote({ source: 'aux', peak_db: -120 }), /nothing came in on aux/);
  assert.match(quietNote({ source: 'ch2', peak_db: -62.4 }), /very quiet on ch2 \(peak -62 dB\)/);
  assert.equal(quietNote({ source: 'ch2', peak_db: -12 }), null);
  assert.equal(quietNote({ source: 'aux' }), null); // a drop: the Pi didn't say
  assert.equal(quietNote(null), null);
});

test('levelText reads a meter', () => {
  assert.equal(levelText(-120), 'silent');
  assert.equal(levelText(-6.4), 'peak -6 dB');
  assert.equal(levelText(undefined), '');
});
