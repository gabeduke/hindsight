// web/static/lib/room/select.test.js
// Holding a take selects, as the list's Select does -- ★, Delete, Export, and
// now Tag (docs/architecture/rooms.md, Vocabulary).
// The real lib/takes.js, loaded through abs-hook.js, on a stand-in document,
// observer, clock and Pi (fetch). Flag off is the list as it was: the same
// hold for any pointer, folded takes hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import './abs-hook.js';

const doc = fakeDoc();
globalThis.document = doc;
globalThis.IntersectionObserver = class { observe() {} unobserve() {} };

// The Pi: /api/take answers the patches it is sent; /api/jams the list.
const pi = { patches: [], failFor: new Set(), jams: [] };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('/api/take?')) {
    const name = decodeURIComponent(u.split('file=')[1]);
    pi.patches.push([name, JSON.parse(init.body)]);
    return { ok: !pi.failFor.has(name), status: pi.failFor.has(name) ? 500 : 200, json: async () => ({}) };
  }
  if (u.startsWith('/api/jams')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => pi.jams };
  if (u.startsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({ tags: [] }) };
  return { ok: false, status: 404, json: async () => ({}) };
};
const { TakesList } = await import('../takes.js');

const take = (n, extra = {}) => ({ name: `jam_${n}.wav`, label: n, duration_seconds: 10, sample_rate: 48000, has_preview: true, has_peaks: false, created: '2026-10-15T10:00:00Z', ...extra });

function list(opts = {}, takes = [take('a'), take('b'), take('c')], members = new Map()) {
  const root = doc.createElement('div');
  const empty = doc.createElement('p');
  const bar = doc.createElement('div');
  bar.innerHTML = '<button id="sel-done"></button><span id="select-count"></span><button id="sel-star"></button><button id="sel-export"></button><button id="sel-delete"></button>';
  doc.body.append(root, empty, bar);
  const toasts = [];
  const l = new TakesList(root, empty, { onToast: (m, k) => toasts.push([m, k]), selectBar: bar, spines: true, shape: (all) => [{ label: '', takes: all.filter((t) => !t.folded), members }], ...opts });
  pi.jams = takes; // what the Pi lists when the list asks again
  l.all = takes;
  l.reshape();
  return { l, root, bar, toasts };
}
const rowEl = (l, n) => l.rows.get(`jam_${n}.wav`).el;
const ev = (type, el, extra = {}) => ({ type, target: el, preventDefault() {}, stopPropagation() {}, ...extra });
const down = (el, pointerType, x = 5, y = 5) => el.dispatchEvent(ev('pointerdown', el, { button: 0, pointerType, clientX: x, clientY: y }));
const up = (el) => el.dispatchEvent(ev('pointerup', el));
const click = (el, extra = {}) => { const e = { type: 'click', target: el, detail: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; el.dispatchEvent(e); return e; };

test('a finger’s hold on a row selects it, and the lift that ends it does not also toggle it off', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = list({ touchHold: true });
  const el = rowEl(l, 'b');
  down(el, 'touch');
  t.mock.timers.tick(499);
  assert.equal(l.selecting, false);
  t.mock.timers.tick(1);
  assert.equal(l.selecting, true);
  assert.deepEqual([...l.selected], ['jam_b.wav']);
  up(el);
  click(el); // the lift's click
  assert.deepEqual([...l.selected], ['jam_b.wav'], 'still selected');
});

test('with touchHold on, a mouse’s press never selects', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = list({ touchHold: true });
  down(rowEl(l, 'b'), 'mouse');
  t.mock.timers.tick(5000);
  assert.equal(l.selecting, false);
});

test('flag off (no touchHold) a mouse’s hold selects, as it always did', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = list();
  down(rowEl(l, 'b'), 'mouse');
  t.mock.timers.tick(500);
  assert.equal(l.selecting, true);
});

test('a finger that moves off a row selects nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { l } = list({ touchHold: true });
  const el = rowEl(l, 'a');
  down(el, 'touch');
  el.dispatchEvent(ev('pointermove', el, { clientX: 60, clientY: 5 }));
  t.mock.timers.tick(1000);
  assert.equal(l.selecting, false);
});

test('with a selection on, a tap on a row picks it in and out, and the others stay', () => {
  const { l } = list({ touchHold: true });
  l.enterSelect('jam_a.wav');
  click(rowEl(l, 'b'));
  assert.deepEqual([...l.selected].sort(), ['jam_a.wav', 'jam_b.wav']);
  click(rowEl(l, 'a'));
  assert.deepEqual([...l.selected], ['jam_b.wav']);
});

test('onSelected hears every change of the selection, so the room’s spines can follow it', () => {
  const heard = [];
  const { l } = list({ onSelected: () => heard.push([...l.selected].sort().join()) });
  l.enterSelect('jam_a.wav');
  l.toggleSelected('jam_b.wav');
  l.toggleSelected('jam_a.wav');
  l.exitSelect();
  assert.deepEqual(heard, ['jam_a.wav', 'jam_a.wav,jam_b.wav', 'jam_b.wav', '']);
});

test('Tag gives every selected take that tag, one request each, and leaves the selection on', async () => {
  pi.patches.length = 0;
  const { l, toasts } = list();
  l.enterSelect('jam_a.wav');
  l.toggleSelected('jam_c.wav');
  await l.bulkTag('tg1');
  assert.deepEqual(pi.patches, [['jam_a.wav', { tag: 'tg1' }], ['jam_c.wav', { tag: 'tg1' }]]);
  assert.equal(l.selecting, true, 'still selecting: ★ or Export can follow');
  assert.deepEqual([...l.selected].sort(), ['jam_a.wav', 'jam_c.wav']);
  assert.deepEqual(toasts, []);
});

test('an empty tag takes the tag off every selected take', async () => {
  pi.patches.length = 0;
  const { l } = list();
  l.enterSelect('jam_b.wav');
  await l.bulkTag('');
  assert.deepEqual(pi.patches, [['jam_b.wav', { tag: '' }]]);
});

test('Tag says how many it could not tag, and still tags the rest', async () => {
  pi.patches.length = 0;
  pi.failFor = new Set(['jam_a.wav']);
  const { l, toasts } = list();
  l.enterSelect('jam_a.wav');
  l.toggleSelected('jam_b.wav');
  await l.bulkTag('tg1');
  pi.failFor = new Set();
  assert.equal(pi.patches.length, 2, 'the failure did not stop the second');
  assert.deepEqual(toasts, [['Could not tag 1 of them', 'bad']]);
});

test('Tag with nothing selected does nothing', async () => {
  pi.patches.length = 0;
  const { l } = list();
  await l.bulkTag('tg1');
  assert.deepEqual(pi.patches, []);
});

test('a spine’s folded takes are rows of the list, shown and selectable, with showFolded; hidden as ever without', () => {
  const members = new Map([['jam_a.wav', [take('f', { folded: true })]]]);
  const all = [take('a'), take('b'), take('f', { folded: true })];
  const on = list({ showFolded: true }, all, members);
  assert.equal(on.l.rows.get('jam_f.wav').el.hidden, false);
  assert.ok(on.l.rows.get('jam_f.wav').el.classList.contains('folded'), 'still marked, for the page to indent it');
  on.l.enterSelect('jam_f.wav');
  on.l.reshape();
  assert.deepEqual([...on.l.selected], ['jam_f.wav'], 'a family’s line stays selected through a redraw');
  const off = list({}, all, members);
  assert.equal(off.l.rows.get('jam_f.wav').el.hidden, true);
  off.l.enterSelect('jam_f.wav');
  off.l.reshape();
  assert.deepEqual([...off.l.selected], [], 'as before: a folded take is not selected');
});

test('Escape closes a dialog and leaves the selection on; with none open it ends the selection (the rooms)', () => {
  const { l } = list({ touchHold: true });
  l.enterSelect('jam_a.wav');
  const dlg = doc.createElement('dialog');
  dlg.setAttribute('open', '');
  doc.body.append(dlg); // the Tag dialog, or the tag manager from Edit tags
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(l.selecting, true, 'the dialog owns this Escape');
  dlg.remove();
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(l.selecting, false);
});

test('flag off, Escape ends the selection as it always did, a dialog or not', () => {
  const { l } = list();
  l.enterSelect('jam_a.wav');
  const dlg = doc.createElement('dialog');
  dlg.setAttribute('open', '');
  doc.body.append(dlg);
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(l.selecting, false);
  dlg.remove();
});
