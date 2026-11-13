// web/static/lib/components/transport/tape-keys.test.js
// The bar's ● and its ▾ in the Studio (tape-keys.js), which Catch is on
// since the calm Studio's step 7a: what ● says, drawn from the tape's
// snapshot, the recorder's and the Studio's hands; what ●'s menu holds (and
// on a phone, this phone's rows after Catch's); and what a press sends, on
// the tape's verbs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../../play/fake-dom.js';
import { createLayers } from '../../ui/layers.js';
import { catchState } from '../../tape/catch.js';
import { fill } from './index.js';
import { faces, catchRows, tapeKeys } from './tape-keys.js';
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
  assert.equal(phone.says.ready, true, 'the last pass stays pressable: the jam-only sheet explains');
  assert.equal(phone.says.bars, false);
});

test('faces: while this phone records, ● is pressed and says the time, whatever the tape does', () => {
  const f = faces({ snap: { tape: aTape(), live: null }, phone: { mode: 'recording', seconds: 75 } });
  assert.equal(f.rec.pressed, true);
  assert.equal(f.rec.disabled, false);
  assert.equal(f.rec.said, 'Stop recording from this phone, 1:15');
});

test('faces: ● and Catch’s state are all it says: the click is the Studio’s, and Catch has no key to draw', () => {
  const f = faces({ snap: { tape: aTape({ click: true }), live: playing() }, armed: [2] });
  assert.deepEqual(Object.keys(f).sort(), ['rec', 'says']);
  assert.equal(f.says.ready, true);
  const waits = faces({ snap: { tape: aTape(), live: playing({ cycles: [] }) }, armed: [2] });
  assert.equal(waits.says.ready, false);
  assert.match(waits.says.why, /whole pass/);
});

test('catchRows: its head says where a catch lands, then the last pass and the last 1, 2 and 4 bars', () => {
  const ready = catchState({ live: playing(), tape: aTape(), armed: true });
  const one = catchRows({ says: ready, armed: [2] });
  assert.equal(one.head, 'Catch onto track 2');
  assert.deepEqual(one.rows.map((r) => r.word), ['The last pass', 'The last 1 bar', 'The last 2 bars', 'The last 4 bars']);
  assert.deepEqual(one.rows.map((r) => r.what), [{ pass: 1 }, { bars: 1 }, { bars: 2 }, { bars: 4 }]);
  assert.ok(one.rows.every((r) => r.ok));
  assert.equal(catchRows({ says: ready, armed: [1, 3] }).head, 'Catch onto tracks 1, 3');
  assert.equal(catchRows({ says: ready, armed: [] }).head, 'Catch: no track is armed');
});

test('catchRows: a row that can’t go says why: the last pass waits for one, the bars for the tape to line up', () => {
  const waits = catchState({ live: playing({ cycles: [] }), tape: aTape(), armed: true });
  const r = catchRows({ says: waits, armed: [2] }).rows;
  assert.equal(r[0].ok, false);
  assert.equal(r[0].why, waits.why);
  assert.ok(r.slice(1).every((x) => x.ok), 'the last bars don’t wait for a pass');
  const unlined = catchState({ live: playing({ aligned: 'none', cycles: [] }), tape: aTape(), armed: true });
  assert.ok(catchRows({ says: unlined, armed: [2] }).rows.every((x) => !x.ok && x.why));
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
    setInput(id) { calls.push(`input:${id}`); },
    input: () => '',
    inputs: async () => { calls.push('inputs'); return [{ id: 'mic', label: 'Pixel’s microphone' }]; },
    state: () => s,
    snapshot: () => s,
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
// A tap on a row of an open menu: the menu's own pick first (on the panel,
// as a browser's capture), then the row's.
const pick = (panel, row) => {
  panel.dispatchEvent({ type: 'click', target: row });
  row.dispatchEvent({ type: 'click', target: row, detail: 1 });
};
const rowsOf = (panel) => panel.children.filter((k) => k.classList.contains('menu-item'));
const wordOf = (row) => row.querySelector('.menu-word').textContent;

// keys: the bar's keys on a tape (a tablet unless `phone`), with this
// phone's keys (phone-key.js) beside them as the bar makes them.
function keys(snap, { phone = false, playerUp = false, ...extra } = {}) {
  const { doc, layers } = shell();
  const root = doc.getElementById('np');
  const tape = aTapeModel(snap);
  const toasts = [];
  const r = aRecorder();
  const toast = (m, kind, opts) => { toasts.push([m, kind, opts]); return { classList: { add() {} } }; };
  const pk = phoneKey({ root, layers, recorder: () => r, playerUp: () => playerUp });
  const k = tapeKeys({ root, tape, whenRecorder: (fn) => fn(r), toast, phoneKeys: pk, phoneScreen: { matches: phone }, ...extra });
  return { doc, layers, tape, toasts, r, k, pk, panel: doc.getElementById('np-rec-menu'), more: doc.getElementById('np-rec-more'), rec: doc.getElementById('np-rec') };
}

test('tapeKeys: drawn only once the Studio lends its hands, from the tape and them', () => {
  const { doc, k, tape } = keys({ tape: aTape(), live: playing() });
  const rec = doc.getElementById('np-rec');
  const label = rec.getAttribute('aria-label');
  assert.equal(label, 'Record', 'no hands: the markup as it is');
  const off = k.lend(hands());
  assert.equal(rec.getAttribute('aria-label'), 'Record from IN 2');
  assert.equal(doc.getElementById('np-rec-more').getAttribute('aria-label'), 'What to catch');
  const on = { state: 'on', track: 2, source: 'IN 2' };
  tape.set({ tape: aTape(), live: playing({ record: on }) });
  assert.equal(rec.getAttribute('aria-pressed'), 'true', 'the tape’s change, drawn');
  off();
  tape.set({ tape: aTape(), live: playing() });
  assert.equal(rec.getAttribute('aria-pressed'), 'true', 'hands back: no longer drawn');
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

test('tapeKeys: a tap on ● records, and opens no menu', async () => {
  const { k, tape, rec, panel } = keys({ tape: aTape(), live: playing() }, { phone: true });
  k.lend(hands());
  rec.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  rec.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  rec.dispatchEvent({ type: 'click', detail: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  await settle();
  assert.deepEqual(tape.calls[0], ['record', { track: 2, source: 'IN 2', replace: false }]);
  assert.equal(panel.hidden, true);
});

// A hold on ● on a phone offers this phone, in ●'s own menu (one ▾ beside
// ●): the hold opens it, and the click its lift sends, which ●'s press
// swallows, must not shut it again (lib/ui/menu.js splitKey).
test('tapeKeys: a hold on ● on a phone opens ●’s menu, with this phone’s rows, and its lift leaves it open', async () => {
  const { k, tape, r, rec, panel, pk } = keys({ tape: aTape(), live: playing() }, { phone: true });
  k.lend(hands());
  // ARM_PRESS's hold: a pointer held past it.
  rec.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, timeStamp: 0 });
  await new Promise((done) => setTimeout(done, 700));
  rec.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  rec.dispatchEvent({ type: 'click', detail: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  await settle();
  assert.equal(panel.hidden, false, '●’s menu is open, and stays open as the finger lifts');
  assert.ok(!pk.menu.isOpen(), 'the phone’s own ▾ is not the one');
  assert.ok(rowsOf(panel).some((row) => wordOf(row) === 'Record from this phone'));
  assert.ok(r.calls.includes('inputs'), 'this phone’s inputs are asked for');
  assert.deepEqual(tape.calls, [], 'nothing recorded');
});

test('tapeKeys: a hold on ● with the phone’s player pulled up opens the recorder’s sheet, as it did', async () => {
  const { k, r, rec, panel } = keys({ tape: aTape(), live: playing() }, { phone: true, playerUp: true });
  k.lend(hands());
  rec.dispatchEvent({ type: 'pointerdown', button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, timeStamp: 0 });
  await new Promise((done) => setTimeout(done, 700));
  rec.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  assert.ok(r.calls.includes('open'));
  assert.equal(panel.hidden, true);
});

test('tapeKeys: ●’s ▾ on a tablet is Catch’s rows: its head, then the last pass and the last bars', async () => {
  const { k, tape, more, panel } = keys({ tape: aTape(), live: playing() });
  k.lend(hands());
  click(more);
  assert.equal(panel.hidden, false, 'the ▾ opens its menu');
  assert.equal(panel.children[0].textContent, 'Catch onto track 2');
  assert.deepEqual(rowsOf(panel).map(wordOf), ['The last pass', 'The last 1 bar', 'The last 2 bars', 'The last 4 bars']);
  assert.ok(!panel.children.some((x) => x.getAttribute('role') === 'separator'), 'nothing of the phone’s');
  pick(panel, rowsOf(panel)[0]);
  await settle();
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, pass: 1 }]);
  assert.equal(panel.hidden, true, 'a pick shuts it');
});

test('tapeKeys: a row of ●’s menu that can’t go says why under it, and a tap says it again and leaves the menu open', async () => {
  const { k, tape, toasts, more, panel } = keys({ tape: aTape(), live: playing({ cycles: [] }) });
  k.lend(hands());
  click(more);
  const pass = rowsOf(panel)[0];
  assert.equal(pass.getAttribute('aria-disabled'), 'true');
  assert.match(pass.querySelector('.menu-sub').textContent, /whole pass/);
  assert.equal(rowsOf(panel)[1].getAttribute('aria-disabled'), 'false', 'the last bars don’t wait');
  pick(panel, pass);
  await settle();
  assert.deepEqual(tape.calls, []);
  assert.equal(toasts[0][1], 'warn');
  assert.match(toasts[0][0], /whole pass/);
  assert.equal(panel.hidden, false, 'it stays open');
});

// ●'s menu open while the loop plays went stale: The last pass stayed
// waiting after the pass had gone round, and the head named the tracks
// armed as it opened (review of step 7a).
test('tapeKeys: ●’s menu, open, follows the tape and the armed tracks, the keyboard staying on its row', () => {
  const { k, tape, more, panel } = keys({ tape: aTape(), live: playing({ cycles: [] }) });
  let armed = [2];
  k.lend(hands({ armed: () => armed }));
  click(more);
  const row = (w) => rowsOf(panel).find((x) => wordOf(x) === w);
  assert.equal(row('The last pass').getAttribute('aria-disabled'), 'true', 'no pass yet');
  row('The last 2 bars').focus();
  tape.set({ tape: aTape(), live: playing() }); // a pass has gone round
  assert.equal(panel.hidden, false, 'still open');
  assert.equal(row('The last pass').getAttribute('aria-disabled'), 'false', 'The last pass can go now');
  assert.equal(row('The last pass').querySelector('.menu-sub'), null, 'and says no reason');
  // (=== , not assert.equal: a failing diff of two fake elements runs out of memory)
  assert.ok(panel.ownerDocument.activeElement === row('The last 2 bars'), 'the keyboard is where it was');
  armed = [2, 3];
  k.draw(); // the Studio armed another track
  assert.equal(panel.children[0].textContent, 'Catch onto tracks 2, 3');
  const before = rowsOf(panel)[0];
  tape.set({ tape: aTape(), live: playing({ heard: 1234 }) });
  assert.ok(rowsOf(panel)[0] === before, 'nothing it shows changed: the rows are left be');
});

test('tapeKeys: on a phone, ●’s menu asks for this phone’s inputs however it opens: the ▾, the keyboard', async () => {
  const { k, r, more, panel } = keys({ tape: aTape(), live: playing() }, { phone: true });
  k.lend(hands());
  more.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
  assert.equal(panel.hidden, false, '↓ on the ▾ opens it');
  assert.deepEqual(r.calls.filter((c) => c === 'inputs'), ['inputs'], 'and asks for the inputs');
  await settle();
  assert.ok(rowsOf(panel).some((x) => wordOf(x) === 'Pixel’s microphone'), 'which fill it as they come');
  k.closeMenu();
  click(more);
  assert.deepEqual(r.calls.filter((c) => c === 'inputs'), ['inputs', 'inputs'], 'the ▾ asks too, once');
});

test('tapeKeys: ●’s ▾ on a phone is Catch’s rows, a line, then this phone’s, which do what they do in its own ▾', async () => {
  const { k, r, more, panel } = keys({ tape: aTape(), live: playing() }, { phone: true });
  k.lend(hands());
  click(more);
  await settle(); // the inputs come
  assert.equal(more.getAttribute('aria-label'), 'What to catch, or record from this phone');
  const kids = panel.children;
  const line = kids.findIndex((x) => x.getAttribute('role') === 'separator');
  assert.ok(line > 0, 'a line, a child of the menu itself');
  const words = (els) => els.filter((x) => x.classList.contains('menu-item')).map(wordOf);
  assert.deepEqual(words(kids.slice(0, line)), ['The last pass', 'The last 1 bar', 'The last 2 bars', 'The last 4 bars']);
  const phone = words(kids.slice(line + 1));
  assert.deepEqual(phone, ['Record from this phone', 'Pixel’s microphone', 'The level and input…']);
  const row = (w) => rowsOf(panel).find((x) => wordOf(x) === w);
  pick(panel, row('The level and input…'));
  assert.ok(r.calls.includes('open'), 'the level and input: the recorder’s sheet');
  click(more);
  await settle();
  pick(panel, row('Record from this phone'));
  assert.ok(r.calls.includes('quick'), 'Record from this phone records');
  // While it records, the rows say so, the menu filled again as it changes.
  click(more);
  await settle();
  r.set({ mode: 'recording', seconds: 4 });
  assert.equal(wordOf(row('Stop recording')), 'Stop recording');
});

test('tapeKeys: C waiting for a pass says why, with the last 4 bars on offer, and catches nothing; ready, it catches the last pass', async () => {
  const { k, tape, toasts } = keys({ tape: aTape(), live: playing({ cycles: [] }) });
  const h = hands();
  k.lend(h);
  k.press('catch');
  await settle();
  assert.deepEqual(tape.calls, []);
  assert.equal(toasts[0][1], 'warn');
  assert.deepEqual(toasts[0][2].actions.map((a) => a.label), ['Last 4 bars']);
  toasts[0][2].actions[0].run();
  await settle();
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, bars: 4 }]);
  tape.set({ tape: aTape(), live: playing() });
  k.press('catch');
  await settle();
  assert.deepEqual(tape.calls.filter((c) => c[0] === 'catch')[1], ['catch', { track: 2, source: 'IN 2', replace: false, pass: 1 }]);
  assert.deepEqual(h.log.at(-1)[2].what, { pass: 1 });
});

test('tapeKeys: the Studio’s own catches (a pass, the last bars) go through the same verb', async () => {
  const { k, tape } = keys({ tape: aTape(), live: playing() });
  k.lend(hands());
  k.catch({ bars: 2 });
  await settle();
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, bars: 2 }]);
});

test('tapeKeys: there is no click on the bar: press(click) does nothing (the click is the Studio’s, M and the tempo’s panel)', async () => {
  const { k, tape } = keys({ tape: aTape({ click: false }), live: playing() });
  k.lend(hands());
  k.press('click');
  await settle();
  assert.deepEqual(tape.calls, []);
});

test('tapeKeys: pointing at The last pass is the Studio’s outline, and it goes as the menu shuts', () => {
  const { k, more, panel } = keys({ tape: aTape(), live: playing() });
  const seen = [];
  k.lend(hands({ hover: (on) => seen.push(on) }));
  click(more);
  const pass = rowsOf(panel)[0];
  pass.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
  pass.dispatchEvent({ type: 'pointerleave', pointerType: 'mouse' });
  assert.deepEqual(seen, [true, false]);
  pass.dispatchEvent({ type: 'pointerenter', pointerType: 'touch' });
  assert.deepEqual(seen, [true, false], 'a finger points at nothing');
  pass.dispatchEvent({ type: 'focus' });
  assert.deepEqual(seen, [true, false], 'a finger’s tap focuses it: no outline');
  pass.matches = (sel) => sel === ':focus-visible';
  pass.dispatchEvent({ type: 'focus' });
  assert.deepEqual(seen, [true, false, true], 'the keyboard on it');
  k.closeMenu();
  assert.deepEqual(seen, [true, false, true, false], 'the menu shut');
  rowsOf(panel)[1].dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
  assert.equal(seen.length, 4, 'the last bars outline nothing');
});

test('tapeKeys: the Studio focuses ▶ through it, never by its id (step 5c)', () => {
  const { k, doc } = keys({ tape: aTape(), live: playing() });
  k.focusPlay();
  assert.equal(doc.activeElement, doc.getElementById('np-play'));
});

test('tapeKeys: the Studio’s tempo panel comes with its hands, made on the display’s tempo key, and goes with them (the calm Studio’s step 7b)', () => {
  const { k, doc } = keys({ tape: aTape(), live: playing() });
  assert.equal(typeof k.tempo, 'undefined', 'no way to the key but the hands');
  assert.equal(k.panel(), null, 'no hands, no panel');
  const handed = [];
  const shut = [];
  const panel = { close: () => shut.push('closed'), press() {} };
  const off = k.lend(hands({ tempo: (key) => { handed.push(key); return panel; } }));
  assert.deepEqual(handed, [doc.getElementById('np-tempo')], 'the hands are handed the tempo key, once, as they are lent');
  assert.equal(k.panel(), panel, 'and the bar has the panel they made');
  off();
  assert.deepEqual(shut, ['closed'], 'taking the hands back shuts it');
  assert.equal(k.panel(), null, 'and the bar has none');
  k.lend(hands());
  assert.equal(k.panel(), null, 'hands with no panel lend none');
});

test('tapeKeys: a page without the keys, or without a tape, has none', () => {
  const bare = fakeDoc().createElement('section');
  bare.id = 'np';
  assert.equal(tapeKeys({ root: bare, tape: aTapeModel({}) }), null);
  assert.equal(tapeKeys({ root: shell().doc.getElementById('np'), tape: null }), null);
});

test('tapeKeys: C with ●’s ▾ open catches and shuts it, as a pick does', async () => {
  const { k, more, panel, tape } = keys({ tape: aTape(), live: playing() });
  k.lend(hands());
  click(more);
  assert.equal(panel.hidden, false, 'the ▾ opens its menu');
  k.press('catch');
  await settle();
  assert.equal(panel.hidden, true, 'C shuts it');
  assert.deepEqual(tape.calls[0], ['catch', { track: 2, source: 'IN 2', replace: false, pass: 1 }]);
});
