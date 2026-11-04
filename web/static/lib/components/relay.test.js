// The relay (relay.js): what a surface hands a component to provide, and
// the page presses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relay } from './relay.js';

test('a relay calls what is provided, and nothing before or after', () => {
  const r = relay(['press', 'tempo']);
  assert.deepEqual(Object.keys(r.api), ['press', 'tempo']);
  assert.equal(r.api.press('rec'), undefined, 'nothing provided: nothing pressed');
  const log = [];
  const off = r.provide({ press: (n) => { log.push(n); return true; }, tempo: (fn) => fn('key') });
  assert.equal(r.api.press('rec'), true);
  assert.equal(r.api.tempo((k) => `menu on ${k}`), 'menu on key');
  off();
  assert.equal(r.api.press('catch'), undefined);
  assert.deepEqual(log, ['rec']);
});

test('a relay only names its methods, and a later provide replaces the first', () => {
  const r = relay(['press']);
  assert.ok(Object.isFrozen(r.api));
  assert.equal(r.api.lend, undefined, 'not one of its names');
  const offA = r.provide({ press: () => 'a' });
  r.provide({ press: () => 'b' });
  offA();
  assert.equal(r.api.press(), 'b', 'the earlier off takes nothing back');
  r.provide({});
  assert.equal(r.api.press(), undefined, 'a provider without the method');
});
