// web/static/lib/bar/tape-keys.test.js
// The bar's ●, Catch and the click in the Studio (tape-keys.js): what they
// say, drawn from the tape's snapshot, the recorder's and the Studio's
// hands, and what a press sends, on the tape's verbs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { createLayers } from '../ui/layers.js';
import { faces, tapeKeys } from './tape-keys.js';
import { phoneKey } from './phone-key.js';

const GRID = { frames: 192000, bars: 4 };
const aTape = (extra = {}) => ({ id: 't1', grid: GRID, click: false, sample_rate: 48000, loop: { on: true, in: 0, out: 192000 }, ...extra });
const playing = (extra = {}) => ({ playing: true, aligned: 'locked', cycles: [{ out: 192000 }], count_in: 0, output_mode: 'jam', ...extra });

test('faces: ● says what it records and from where, or that a track must be armed', () => {
  const none = faces({ snap: { tape: aTape(), live: playing() } });
  assert.equal(none.rec.said, 'Record: arm a track first');
  const armed = faces({ snap: { tape: aTape(), live: playing() }, armed: [2, 3], inputOf: (n) => `IN ${n}` });
  assert.equal(armed.rec.said, 'Record from IN 2 + IN 3');
  const on = faces({ snap: { tape: aTape(), live: playing({ record: { state: 'on', track: 2, source: 'IN 2' } }) }, armed: [2] });
  assert.equal(on.rec.said, 'Recording 2 from IN 2');
  assert.equal(on.rec.pressed, true);
  const ready = faces({ snap: { tape: aTape(), live: playing({ record: { state: 'armed', track: 1, source: 'IN 1' } }) }, armed: [1] });
  assert.equal(ready.rec.armed, true);
  assert.equal(ready.rec.pressed, false);
});

test('faces: ● can’t record before the tape is lined up or has a tempo, nor through a mixdown; on a phone it stays pressable', () => {
  assert.equal(faces({ snap: { tape: aTape(), live: null } }).rec.disabled, true);
  assert.equal(faces({ snap: { tape: aTape(), live: playing({ aligned: 'none' }) } }).rec.disabled, true);
  assert.equal(faces({ snap: { tape: aTape({ grid: null }), live: playing() } }).rec.disabled, true);
  assert.equal(faces({ snap: { tape: aTape(), live: playing({ mixdown: { tape: 't1', state: 'playing' } }) } }).rec.disabled, true);
  assert.equal(faces({ snap: { tape: aTape(), live: playing() } }).rec.disabled, false);
  const phone = faces({ snap: { tape: aTape(), live: playing({ aligned: 'none', output_mode: 'phone' }) } });
  assert.equal(phone.rec.disabled, false);
  assert.equal(phone.rec.dim, true);
  assert.equal(phone.catch.jamOnly, true);
  assert.equal(phone.catch.said, 'Catch: needs the jam room');
});

test('faces: while this phone records, ● is pressed and says the time, whatever the tape does', () => {
  const f = faces({ snap: { tape: aTape(), live: null }, phone: { mode: 'recording', seconds: 75 } });
  assert.equal(f.rec.pressed, true);
  assert.equal(f.rec.disabled, false);
  assert.equal(f.rec.said, 'Stop recording from this phone, 1:15');
});

test('faces: Catch says where the last pass goes, or why it waits; the click is the tape’s', () => {
  const f = faces({ snap: { tape: aTape({ click: true }), live: playing() }, armed: [2], catchTip: 'TIP' });
  assert.equal(f.catch.waits, false);
  assert.equal(f.catch.sub, 'last pass → 2');
  assert.equal(f.catch.mini, '→ 2');
  assert.equal(f.catch.title, 'TIP');
  assert.equal(f.catch.said, 'Catch the last pass onto track 2');
  assert.deepEqual(f.click, { pressed: true, disabled: false });
  const waits = faces({ snap: { tape: aTape(), live: playing({ cycles: [] }) }, armed: [2] });
  assert.equal(waits.catch.waits, true);
  assert.equal(waits.catch.title, waits.says.why);
  assert.equal(faces({ snap: { tape: aTape({ grid: null }), live: null } }).click.disabled, true);
});

function aTapeModel(snap) {
  const calls = [];
  const fns = new Set();
  return {
    calls,
    snap,
    snapshot: () => snap,
    set(s) { snap = s; for (const f of fns) f(s); },
    onChange(f) { fns.add(f); return () => fns.delete(f); },
    refresh: (force) => { calls.push(['refresh', !!force]); },
    record: async (body) => { calls.push(['record', body]); return { record: { state: 'armed', track: body.track, source: body.source } }; },
    punchOut: async () => { calls.push(['punchOut']); return { kept: null }; },
    catch: async (body) => { calls.push(['catch', body]); return { clip: { clean: true } }; },
    setClick: async (on) => { calls.push(['setClick', on]); },
  };
}

function aRecorder() {
  const calls = [];
  let fns = [];
  let s = { mode: 'closed', seconds: 0 };
  return {
    calls,
    set(x) { s = x; for (const f of fns) f(x); },
    quick() { calls.push('quick'); },
    open() { calls.push('open'); },
    input: () => '',
    inputs: async () => [],
    state: () => s,
    snapshot: () => s,
    onChange(f) { fns.push(f); return () => { fns = fns.filter((x) => x !== f); }; },
  };
}

function shell() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, readFileSync(new URL('../../shell.html', import.meta.url), 'utf8')).nodes);
  const win = { addEventListener() {}, removeEventListener() {} };
  return { doc, layers: createLayers({ doc, win, CloseWatcher: undefined, history: undefined }) };
}

function hands(over = {}) {
  const log = [];
  return {
    log,
    layers: null,
    armed: () => [2],
    inputOf: (n) => `IN ${n}`,
    playsHere: () => false,
    body: (what) => ({ track: 2, source: 'IN 2', replace: false, ...what }),
    said: (verb, answer, extra) => log.push([verb, answer, extra]),
    hover() {},
    ...over,
  };
}

const settle = () => new Promise((r) => setImmediate(r));
const click = (el) => el.dispatchEvent({ type: 'click', detail: 0 });

function keys(snap, extra = {}) {
  const { doc, layers } = shell();
  const tape = aTapeModel(snap);
  const toasts = [];
  const r = aRecorder();
  const k = tapeKeys({ doc, tape, whenRecorder: (fn) => fn(r), toast: (m, kind) => { toasts.push([m, kind]); return { classList: { add() {} } }; }, matchMedia: () => ({ matches: false }), ...extra });
  return { doc, layers, tape, toasts, r, k };
}

test('tapeKeys: drawn only once the Studio lends its hands, from the tape and them', () => {
  const { doc, k, tape } = keys({ tape: aTape({ click: true }), live: playing() });
  const rec = doc.getElementById('np-rec');
  const label = rec.getAttribute('aria-label');
  assert.equal(label, 'Record', 'no hands: the markup as it is');
  const off = k.lend(hands());
  assert.equal(rec.getAttribute('aria-label'), 'Record from IN 2');
  assert.equal(doc.getElementById('np-click').getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById('np-catch-pass').querySelector('.np-catch-sub').textContent, 'last pass → 2');
  assert.equal(doc.getElementById('np-catch-pass').querySelector('.np-catch-mini').textContent, '→ 2');
  tape.set({ tape: aTape({ click: false }), live: playing() });
  assert.equal(doc.getElementById('np-click').getAttribute('aria-pressed'), 'false', 'the tape’s change, drawn');
  off();
  tape.set({ tape: aTape({ click: true }), live: playing() });
  assert.equal(doc.getElementById('np-click').getAttribute('aria-pressed'), 'false', 'hands back: no longer drawn');
});

test('tapeKeys: ● sends the Studio’s body on the tape’s record, and the Studio says the answer', async () => {
  const { k, tape } = keys({ tape: aTape(), live: playing() });
  const h = hands();
  k.lend(h);
  k.press('rec');
  await settle();
  assert.deepEqual(tape.calls[0], ['record', { track: 2, source: 'IN 2', replace: false }]);
  assert.equal(h.log[0][0], 'record');
  assert.deepEqual(tape.calls[1], ['refresh', false]);
});

test('tapeKeys: ● during a punch ends it (punchOut), whatever is armed', async () => {
  const r = { state: 'on', track: 2, source: 'IN 2' };
  const { k, tape } = keys({ tape: aTape(), live: playing({ record: r }) });
  const h = hands({ body: () => assert.fail('no body for a punch out') });
  k.lend(h);
  k.press('rec');
  await settle();
  assert.deepEqual(tape.calls[0], ['punchOut']);
  assert.deepEqual(h.log[0][2], { before: r });
});

test('tapeKeys: ● the Studio refuses (body null) sends nothing', async () => {
  const { k, tape } = keys({ tape: aTape(), live: playing() });
  k.lend(hands({ body: () => null }));
  k.press('rec');
  await settle();
  assert.deepEqual(tape.calls, []);
});

test('tapeKeys: ● with the tape on this phone, or while it records, is this phone’s recorder', async () => {
  const { k, tape, r } = keys({ tape: aTape(), live: playing({ output_mode: 'phone' }) });
  k.lend(hands({ playsHere: () => true }));
  k.press('rec');
  await settle();
  assert.deepEqual(r.calls, ['quick']);
  assert.deepEqual(tape.calls, []);
});

test('tapeKeys: a hold on ● on a phone offers this phone’s ▾', () => {
  const { doc, layers } = shell();
  const tape = aTapeModel({ tape: aTape(), live: playing() });
  const phone = phoneKey({ doc, layers, recorder: () => aRecorder() });
  let offered = 0;
  const k = tapeKeys({ doc, tape, whenRecorder: () => {}, offer: () => { offered++; phone.offer(); }, matchMedia: () => ({ matches: true }) });
  k.lend(hands());
  const rec = doc.getElementById('np-rec');
  // ARM_PRESS's hold: a pointer held past it.
  rec.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, timeStamp: 0 });
  return new Promise((done) => setTimeout(() => {
    rec.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
    assert.equal(offered, 1);
    assert.ok(phone.menu.isOpen(), 'the mini player’s ▾ opens');
    assert.deepEqual(tape.calls, [], 'nothing recorded');
    done();
  }, 700));
});

test('tapeKeys: Catch waiting for a pass says why and catches nothing; ready, it catches the last pass', async () => {
  const { k, tape, toasts } = keys({ tape: aTape(), live: playing({ cycles: [] }) });
  const h = hands();
  k.lend(h);
  k.press('catch');
  await settle();
  assert.deepEqual(tape.calls, []);
  assert.equal(toasts[0][1], 'warn');
  tape.set({ tape: aTape(), live: playing() });
  k.press('catch');
  await settle();
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, pass: 1 }]);
  assert.deepEqual(h.log[0][2].what, { pass: 1 });
});

test('tapeKeys: the Studio’s own catches (a pass, the last bars) go through the same verb', async () => {
  const { k, tape } = keys({ tape: aTape(), live: playing() });
  k.lend(hands());
  k.catch({ bars: 2 });
  await settle();
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, bars: 2 }]);
});

test('tapeKeys: the click sends the tape’s setClick; not while it has no tempo, nor with no hands', async () => {
  const { k, tape, doc } = keys({ tape: aTape({ click: false }), live: playing() });
  k.press('click');
  assert.deepEqual(tape.calls, [], 'no hands');
  k.lend(hands());
  click(doc.getElementById('np-click'));
  await settle();
  assert.deepEqual(tape.calls[0], ['setClick', true]);
  tape.set({ tape: aTape({ grid: null }), live: playing() });
  k.press('click');
  await settle();
  assert.equal(tape.calls.filter((c) => c[0] === 'setClick').length, 1, 'disabled: nothing');
});

test('tapeKeys: pointing at Catch is the Studio’s outline', () => {
  const { k, doc } = keys({ tape: aTape(), live: playing() });
  const seen = [];
  k.lend(hands({ hover: (on) => seen.push(on) }));
  const pass = doc.getElementById('np-catch-pass');
  pass.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
  pass.dispatchEvent({ type: 'pointerleave', pointerType: 'mouse' });
  assert.deepEqual(seen, [true, false]);
});

test('tapeKeys: the Studio focuses ▶ and wires its tempo menu on the bar’s key through it, never by their ids (step 5c)', () => {
  const { k, doc } = keys({ tape: aTape(), live: playing() });
  k.focusPlay();
  assert.equal(doc.activeElement, doc.getElementById('np-play'));
  const handed = [];
  const made = k.tempo((key) => { handed.push(key); return 'the menu'; });
  assert.deepEqual(handed, [doc.getElementById('np-tempo')], 'fn is handed the tempo key');
  assert.equal(made, 'the menu', 'and tempo answers what fn made');
});

test('tapeKeys: a page without the keys, or without a tape, has none', () => {
  assert.equal(tapeKeys({ doc: fakeDoc(), tape: aTapeModel({}) }), null);
  assert.equal(tapeKeys({ doc: shell().doc, tape: null }), null);
});

test('tapeKeys: C with Catch’s ▾ open catches and shuts it, as a tap on Catch does', async () => {
  const { k, doc } = keys({ tape: aTape(), live: playing() });
  k.lend(hands());
  const panel = doc.getElementById('catch-menu');
  click(doc.getElementById('np-catch-more'));
  assert.equal(panel.hidden, false, 'the ▾ opens its menu');
  k.press('catch');
  await settle();
  assert.equal(panel.hidden, true, 'C shuts it');
});
