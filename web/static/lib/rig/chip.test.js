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

// The rig is in the header's menu (lib/nav.js mountHeaderTools): the
// rooms' pages show it, filled from /api/rig, and its lamp is the chip's.
// It once sat in Capture's header row, which the shell hides in both rooms,
// and neither room had a way to the rig.
test('in the shell, the header’s menu has the rig, with its interface and lamp', async () => {
  const { fakeDoc, parseHTML } = await import('../play/fake-dom.js');
  const { mountHeaderTools } = await import('../nav.js');
  const shell = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, /<header class="appbar">[\s\S]*?<\/header>/.exec(shell)[0]).nodes);
  mountHeaderTools(doc);
  const item = mountChip(doc, { pathname: '/tape.html', fetchFn: () => Promise.resolve({ ok: true, json: () => g }) });
  assert.ok(item && doc.getElementById('app-menu').contains(item), 'the rig is an item of the menu');
  assert.equal(item.hidden, false);
  assert.equal(item.getAttribute('href'), '/rig.html');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(item.querySelector('.rig-chip-sub').textContent, 'Sidekick · 8 in · 4 out');
  assert.equal(item.dataset.state, 'warn', 'its lamp, which puts a dot on the menu’s button');
  assert.equal(doc.querySelectorAll('.rig-chip').length, 0, 'no chip left in a header row');
  // A second call (the nav starts once per document) changes nothing.
  assert.equal(mountChip(doc, { pathname: '/tape.html', fetchFn: () => { throw new Error('fetched twice'); } }), null);
  // Off the rooms' pages the item stays hidden.
  const rig = fakeDoc();
  rig.body.append(...parseHTML(rig, /<header class="appbar">[\s\S]*?<\/header>/.exec(shell)[0]).nodes);
  mountHeaderTools(rig);
  assert.equal(mountChip(rig, { pathname: '/rig.html', fetchFn: () => { throw new Error('fetched'); } }), null);
  assert.equal(rig.querySelector('.app-menu-rig').hidden, true);
});
