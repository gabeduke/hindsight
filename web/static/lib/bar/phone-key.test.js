// web/static/lib/bar/phone-key.test.js
// Recording from a phone, from its mini player (phone-key.js): what the ▾
// offers for each state of the recorder, what ● says, and the keys wired to
// the page's one recorder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { createLayers } from '../ui/layers.js';
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
  doc.body.append(...parseHTML(doc, readFileSync(new URL('../../shell.html', import.meta.url), 'utf8')).nodes);
  const win = { addEventListener() {}, removeEventListener() {} };
  return { doc, layers: createLayers({ doc, win, CloseWatcher: undefined, history: undefined }) };
}

test('phoneKey: ● asks the page’s recorder; it shows the recording, wherever it was started', () => {
  const { doc, layers } = shell();
  const r = aRecorder();
  const k = phoneKey({ doc, layers, recorder: () => r });
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
  phoneKey({ doc, layers, recorder: () => null, whenRecorder: (fn) => { hand = fn; } });
  hand(r); // a room makes the page's recorder
  r.set({ mode: 'recording', seconds: 3 });
  assert.equal(doc.getElementById('np-phone-rec').getAttribute('aria-pressed'), 'true');
});

test('phoneKey: a page without the keys (Open) has none', () => {
  assert.equal(phoneKey({ doc: fakeDoc(), layers: {}, recorder: () => null }), null);
});
