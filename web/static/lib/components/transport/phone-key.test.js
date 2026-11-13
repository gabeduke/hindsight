// web/static/lib/components/transport/phone-key.test.js
// Recording from a phone, from its mini player (phone-key.js): what the ▾
// offers for each state of the recorder, what ● says, and the keys wired to
// the page's one recorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../../play/fake-dom.js';
import { createLayers } from '../../ui/layers.js';
import { fill } from './index.js';
import { phoneRows, said, phoneKey } from './phone-key.js';

test('phoneRows: put away, ● records; recording, it stops, with the time; saving, it says so', () => {
  assert.equal(phoneRows({}).now.id, 'record');
  const rec = phoneRows({ state: { mode: 'recording', seconds: 73 } });
  assert.equal(rec.now.id, 'stop');
  assert.match(rec.now.sub, /1:13/);
  assert.equal(phoneRows({ state: { mode: 'saving', seconds: 9 } }).now.id, 'sheet');
});

test('phoneRows: the inputs, the one kept ticked, or the first; none while it records', () => {
  const inputs = [{ id: 'a', label: 'iPhone Microphone' }, { id: 'b', label: 'Orchid' }];
  assert.deepEqual(phoneRows({ inputs, input: 'b' }).inputs.map((r) => [r.id, r.checked]), [['input:a', false], ['input:b', true]]);
  assert.deepEqual(phoneRows({ inputs, input: 'gone' }).inputs.map((r) => r.checked), [true, false], 'a kept input that has gone: the default');
  assert.ok(phoneRows({ inputs, state: { mode: 'recording', seconds: 1 } }).inputs.every((r) => r.disabled));
  // Before the page may use the mic, the browser names no inputs.
  assert.deepEqual(phoneRows({}).inputs.map((r) => r.word), ['This phone’s microphone']);
  assert.equal(phoneRows({}).sheet.id, 'sheet');
});

test('said: ● says what a tap does now', () => {
  assert.equal(said({ mode: 'closed' }), 'Record from this phone');
  assert.equal(said({ mode: 'recording', seconds: 5 }), 'Stop recording from this phone, 0:05');
  assert.equal(said({ mode: 'saving' }), 'Saving the phone’s take');
});

function aRecorder() {
  const calls = [];
  let fns = [];
  let state = { mode: 'closed', seconds: 0 };
  return {
    calls,
    set(s) { state = s; for (const f of fns) f(s); },
    quick() { calls.push('quick'); },
    open() { calls.push('open'); },
    setInput(id) { calls.push(`input:${id}`); },
    input: () => '',
    inputs: async () => [],
    state: () => state,
    onChange(f) { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; },
  };
}

function shell() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, readFileSync(new URL('../../../shell.html', import.meta.url), 'utf8')).nodes);
  // The bar's markup is the Transport's template, filled as its mount fills it.
  fill(doc.getElementById('np'));
  const win = { addEventListener() {}, removeEventListener() {} };
  return { doc, layers: createLayers({ doc, win, CloseWatcher: undefined, history: undefined }) };
}

test('phoneKey: ● asks the page’s recorder; it shows the recording, wherever it was started', () => {
  const { doc, layers } = shell();
  const r = aRecorder();
  const k = phoneKey({ root: doc.getElementById('np'), layers, recorder: () => r });
  assert.ok(k, 'the shell has the keys');
  const rec = doc.getElementById('np-phone-rec');
  rec.dispatchEvent({ type: 'click' });
  assert.deepEqual(r.calls, ['quick']);
  r.set({ mode: 'recording', seconds: 12 });
  assert.equal(rec.getAttribute('aria-pressed'), 'true');
  assert.equal(rec.getAttribute('aria-label'), 'Stop recording from this phone, 0:12');
  assert.ok(doc.getElementById('np-phone-more').classList.contains('recording'), 'its ▾ too');
  r.set({ mode: 'closed', seconds: 0 });
  assert.equal(rec.getAttribute('aria-pressed'), 'false');
});

test('phoneKey: a recording started before ● was pressed (Capture’s ● Phone, the sheet) shows on it', () => {
  const { doc, layers } = shell();
  const r = aRecorder();
  let hand = null;
  phoneKey({ root: doc.getElementById('np'), layers, recorder: () => null, whenRecorder: (fn) => { hand = fn; } });
  hand(r); // a room makes the page's recorder
  r.set({ mode: 'recording', seconds: 3 });
  assert.equal(doc.getElementById('np-phone-rec').getAttribute('aria-pressed'), 'true');
});

// ●'s ▾ in the Studio holds these rows after Catch's (tape-keys.js): one
// ▾ beside ●, never two. Its rows are this ▾'s, made by it, doing what they
// do here.
test('phoneKey: rows(panel) puts its rows in another menu, each doing what it does in its own', () => {
  const { doc, layers } = shell();
  const r = aRecorder();
  const k = phoneKey({ root: doc.getElementById('np'), layers, recorder: () => r });
  const panel = doc.createElement('div');
  const head = doc.createElement('p');
  panel.append(head);
  k.rows(panel);
  assert.equal(panel.children[0], head, 'after what the menu had');
  const rows = panel.children.filter((x) => x.classList.contains('menu-item'));
  const words = rows.map((x) => x.querySelector('.menu-word').textContent);
  assert.deepEqual(words, ['Record from this phone', 'This phone’s microphone', 'The level and input…']);
  for (const row of rows) row.dispatchEvent({ type: 'click' });
  assert.deepEqual(r.calls, ['quick', 'input:', 'open']);
});

test('phoneKey: offer(host) opens the host, which says so (opened), and the inputs are asked for, filling it again as they come; with the player up, the sheet', async () => {
  const { doc, layers } = shell();
  const r = aRecorder();
  r.inputs = async () => { r.calls.push('inputs'); return [{ id: 'usb', label: 'USB interface' }]; };
  let up = false;
  const k = phoneKey({ root: doc.getElementById('np'), layers, recorder: () => r, playerUp: () => up });
  const panel = doc.createElement('div');
  let open = false;
  // The host as menu() is one: filled as it opens, then its onOpen says so.
  const host = { isOpen: () => open, open: () => { open = true; host.refresh(); k.opened(host); }, refresh: () => { panel.replaceChildren(); k.rows(panel); } };
  k.offer(host);
  assert.ok(open, 'the host opens');
  await new Promise((done) => setImmediate(done));
  assert.ok(panel.children.some((x) => x.textContent.includes('USB interface')), 'filled again with the inputs');
  r.set({ mode: 'recording', seconds: 2 });
  assert.ok(panel.children.some((x) => x.textContent.includes('Stop recording')), 'and as the recorder changes');
  open = false;
  up = true;
  r.calls.length = 0;
  k.offer(host);
  assert.deepEqual(r.calls, ['open'], 'the player up: the recorder’s sheet');
  assert.ok(!open);
  assert.ok(!k.menu.isOpen(), 'never its own ▾, which the Studio doesn’t show');
});

test('phoneKey: a page without the keys (Open) has none', () => {
  const np = fakeDoc().createElement('section');
  np.id = 'np';
  assert.equal(phoneKey({ root: np, layers: {}, recorder: () => null }), null);
});
