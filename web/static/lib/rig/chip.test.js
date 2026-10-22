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

test('nav.js loads the chip on demand, never statically', () => {
  const nav = readFileSync(new URL('../nav.js', import.meta.url), 'utf8');
  assert.ok(!/^import .*rig\//m.test(nav), 'nav.js must not import the rig statically');
  assert.match(nav, /import\('\.\/rig\/chip\.js'\)/, 'the chip is imported when the nav starts');
});

// The shell has a header row per room (Capture's, the Studio's, the
// Listening Room's) and shows one at a time: a chip in only one of them
// left the rig with no way in from the other rooms.
test('in the shell, every room\'s header row has the chip', async () => {
  const { fakeDoc, parseHTML } = await import('../play/fake-dom.js');
  const shell = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, /<header class="appbar">[\s\S]*?<\/header>/.exec(shell)[0]).nodes);
  mountChip(doc, { pathname: '/tape.html', fetchFn: () => Promise.resolve({ ok: false }) });
  for (const id of ['header-capture', 'header-studio', 'header-room']) {
    assert.equal(doc.getElementById(id).querySelectorAll('.rig-chip').length, 1, id);
  }
  // A second call (the nav starts once per document) adds none.
  mountChip(doc, { pathname: '/tape.html', fetchFn: () => Promise.resolve({ ok: false }) });
  assert.equal(doc.querySelectorAll('.rig-chip').length, 3);
});
