// The display's keys (lib/components/display), mounted on a transport made
// over the saved answers in testdata/protocol/tape/. What they look like at
// each size is the harness's (node scripts/components.mjs display).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc } from '../play/fake-dom.js';
import { createLayers } from '../ui/layers.js';
import { mountComponent, lacks } from './mount.js';
import { fixture, fixtureModels } from '../models/fixture.js';
import display, { KEYS, words } from './display/index.js';

const saved = (name) => JSON.parse(readFileSync(new URL(`../../../../testdata/protocol/tape/${name}.json`, import.meta.url), 'utf8'));

function ctxIn(doc) {
  return { on: (t, ty, fn) => { t.addEventListener(ty, fn); return () => t.removeEventListener(ty, fn); }, loop: () => ({ start() {}, stop() {}, running: false }), layers: createLayers({ doc }).scope() };
}

async function mounted(name, props = {}) {
  const doc = fakeDoc();
  const root = doc.createElement('div');
  root.id = 'np';
  doc.body.append(root);
  const fx = fixture({ tape: saved(name) });
  const made = fixtureModels(fx, display.needs);
  await made.ready;
  const c = mountComponent(display, root, made.models, ctxIn(doc), props);
  const text = (part) => root.querySelector(`[data-part="${part}"]`).textContent;
  return { doc, root, fx, made, c, text, done() { c.unmount(); made.stop(); } };
}

test('it is a component, needing only the transport', () => {
  assert.deepEqual(lacks(display), []);
  assert.deepEqual(display.needs, ['transport']);
  assert.equal(display.css, 'css/display.css');
});

test('a stopped tape: its tempo, its name and the jam room, in both forms, said in full to a screen reader', async () => {
  const m = await mounted('stopped');
  assert.equal(m.text('tempo-short'), '96');
  assert.equal(m.text('tempo-long'), '96 BPM · 4 BARS');
  assert.equal(m.text('source-short'), 'TAPE');
  assert.equal(m.text('source-long'), 'TAPE · Tape 1');
  assert.equal(m.text('output-val'), 'JAM ROOM');
  assert.equal(m.doc.getElementById('np-tempo').getAttribute('aria-label'), 'Tempo: 96 BPM, 4 bars');
  assert.equal(m.doc.getElementById('np-output').getAttribute('aria-label'), 'Plays in the jam room: choose where');
  m.done();
});

test('no tempo yet, and a tape playing on a phone', async () => {
  const none = await mounted('no-tempo');
  assert.equal(none.text('tempo-short'), '–');
  assert.equal(none.text('tempo-long'), 'NO TEMPO');
  assert.equal(none.text('output-val'), 'BOTH');
  none.done();
  const phone = await mounted('playing-on-a-phone');
  assert.equal(phone.text('output-val'), 'PHONE');
  assert.equal(phone.text('tempo-long'), '83.2 BPM · 8 BARS', 'the loop’s bars, not the grid’s');
  phone.done();
});

test('it redraws when the Pi’s state moves', async () => {
  const m = await mounted('stopped');
  m.fx.set('tape', saved('playing-on-a-phone'));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(m.text('output-val'), 'PHONE');
  assert.equal(m.text('source-long'), 'TAPE · Sunday night, the long one with the Stylophone');
  m.done();
});

test('a key opens what the surface hands it; one it hands nothing is disabled', async () => {
  const pressed = [];
  const m = await mounted('stopped', { source: (key) => pressed.push(key.id) });
  assert.deepEqual(KEYS.map((k) => m.doc.getElementById(`np-${k}`).disabled), [true, false, true]);
  m.doc.getElementById('np-source').dispatchEvent({ type: 'click' });
  assert.deepEqual(pressed, ['np-source']);
  m.done();
  assert.equal(m.root.textContent, '');
});

test('words are the bar’s, before a tape is in too', () => {
  assert.equal(words(null).tempo.long, 'NO TEMPO');
  assert.equal(words({ tape: null, live: null }).out, 'JAM ROOM');
});
