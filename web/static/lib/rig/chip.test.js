import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chipModel, chipOn, mountChip } from './chip.js';

const g = JSON.parse(readFileSync(new URL('./testdata/sidekick.json', import.meta.url), 'utf8'));

test('the chip names the interface and its channels, amber while something needs seeing to', () => {
  const m = chipModel(g);
  assert.equal(m.name, 'Sidekick');
  assert.equal(m.sub, '8 in · 4 out');
  assert.equal(m.state, 'warn', 'the tape is in a tap, and a cable waits for a restart');
  assert.match(m.label, /^The rig: Sidekick, 8 in · 4 out, the tape is in a tap$/);
  assert.equal(chipModel({ ...g, warnings: [], restart_needed: false }).state, 'ok');
  assert.equal(chipModel({ devices: [] }).state, 'none');
  assert.equal(chipModel(null).state, 'none');
});

test('the chip is in both rooms and nowhere else', () => {
  for (const p of ['/', '/index.html', '/tape.html', '/takes.html', '/wave.html']) assert.ok(chipOn(p), p);
  for (const p of ['/rig.html', '/guide.html', '/objects.html']) assert.ok(!chipOn(p), p);
  // Off its pages it touches nothing.
  const untouchable = new Proxy({}, { get(_, k) { throw new Error(`touched document.${String(k)}`); } });
  assert.equal(mountChip(untouchable, { pathname: '/rig.html', fetchFn: () => { throw new Error('fetched'); } }), null);
});

test('nav.js loads the chip only with the rooms on', () => {
  const nav = readFileSync(new URL('../nav.js', import.meta.url), 'utf8');
  assert.ok(!/^import .*rig\//m.test(nav), 'nav.js must not import the rig statically');
  assert.match(nav, /if \(rooms\) \{[\s\S]*?import\('\.\/rig\/chip\.js'\)[\s\S]*?\n {2}\}/, 'the chip is imported inside the rooms branch');
});
