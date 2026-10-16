// web/static/lib/room/tagpick.test.js
// Tag, the selection's fourth key (docs/superpowers/specs/2026-10-15-flow-
// design.md, "A tap plays": holding selects ★, Delete, Export, and now Tag).
// The select bar and the dialog are elements of a stand-in document; the
// take list and the tag manager are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { tagKey } from './tagpick.js';

const TAGS = [{ id: 'g1', name: 'Funk', color: 2 }, { id: 'g2', name: 'Ideas', color: 5 }];

function stage({ tags = TAGS, takeTags = { 'jam_a.wav': 'g1', 'jam_b.wav': 'g1', 'jam_c.wav': '' } } = {}) {
  const doc = fakeDoc();
  const bar = doc.createElement('div');
  bar.innerHTML = '<button id="sel-done"></button><span id="select-count"></span><button id="sel-star"></button><button id="sel-export"></button><button id="sel-delete"></button>';
  doc.body.append(bar);
  const calls = [];
  const takes = {
    all: Object.entries(takeTags).map(([name, tag]) => ({ name, tag })),
    selected: new Set(),
    bulkTag: async (id) => { calls.push(['bulkTag', id]); },
  };
  const manager = [];
  const key = tagKey({ doc, bar, takes, tags: { get list() { return tags; } }, manage: (o) => { manager.push(o); } });
  const dialog = () => doc.querySelector('dialog');
  const chips = () => (dialog() ? dialog().querySelectorAll('button') : []);
  const chip = (words) => chips().find((b) => b.textContent.includes(words));
  const press = (b) => b.dispatchEvent({ type: 'click', target: b, preventDefault() {} });
  return { doc, bar, takes, calls, manager, key, dialog, chips, chip, press };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('Tag is a key on the select bar, between ★ and Export, with a tip', () => {
  const s = stage();
  const ids = s.bar.children.map((b) => b.id);
  assert.deepEqual(ids, ['sel-done', 'select-count', 'sel-star', 'sel-tag', 'sel-export', 'sel-delete']);
  assert.equal(s.key.key.textContent, 'Tag');
  assert.equal(s.key.key.dataset.tip, 'bulk-tag');
});

test('it is off with nothing selected, as ★ and Export are, and on once something is', () => {
  const s = stage();
  assert.equal(s.key.key.disabled, true);
  s.takes.selected.add('jam_a.wav');
  s.key.sync();
  assert.equal(s.key.key.disabled, false);
  s.takes.selected.clear();
  s.key.sync();
  assert.equal(s.key.key.disabled, true);
});

test('pressing it lists the tags, and lights the one every selected take wears', () => {
  const s = stage();
  s.takes.selected = new Set(['jam_a.wav', 'jam_b.wav']);
  s.press(s.key.key);
  assert.ok(s.dialog(), 'a dialog');
  assert.equal(s.chip('Funk').getAttribute('aria-pressed'), 'true', 'both wear it');
  assert.equal(s.chip('Ideas').getAttribute('aria-pressed'), 'false');
  // One that doesn't wear it: not lit.
  s.dialog().remove();
  s.takes.selected = new Set(['jam_a.wav', 'jam_c.wav']);
  s.press(s.key.key);
  assert.equal(s.chip('Funk').getAttribute('aria-pressed'), 'false');
});

test('pressing a tag gives it to every selected take, and puts the dialog away', async () => {
  const s = stage();
  s.takes.selected = new Set(['jam_a.wav', 'jam_c.wav']);
  s.press(s.key.key);
  s.press(s.chip('Ideas'));
  await settle();
  assert.deepEqual(s.calls, [['bulkTag', 'g2']]);
  assert.equal(s.dialog(), null);
});

test('pressing the tag they all wear takes it off, as the sheet’s chip did', async () => {
  const s = stage();
  s.takes.selected = new Set(['jam_a.wav', 'jam_b.wav']);
  s.press(s.key.key);
  s.press(s.chip('Funk'));
  await settle();
  assert.deepEqual(s.calls, [['bulkTag', '']]);
});

test('No tag takes the tag off all of them', async () => {
  const s = stage();
  s.takes.selected = new Set(['jam_a.wav', 'jam_c.wav']);
  s.press(s.key.key);
  s.press(s.chip('No tag'));
  await settle();
  assert.deepEqual(s.calls, [['bulkTag', '']]);
});

test('Edit tags opens the tag manager, and a tag it makes is given to the selection', async () => {
  const s = stage();
  s.takes.selected = new Set(['jam_c.wav']);
  s.press(s.key.key);
  s.press(s.chip('Edit tags'));
  assert.equal(s.manager.length, 1);
  assert.equal(s.dialog(), null, 'the picker steps aside for the manager');
  s.manager[0].onCreated({ id: 'g9', name: 'Late', color: 3 });
  await settle();
  assert.deepEqual(s.calls, [['bulkTag', 'g9']]);
});

test('with no tags yet, only + New tag is offered (it opens the manager), and the dialog says how many takes', () => {
  const s = stage({ tags: [] });
  s.takes.selected = new Set(['jam_a.wav', 'jam_b.wav']);
  s.press(s.key.key);
  assert.ok(s.chip('New tag'));
  assert.equal(s.chip('No tag'), undefined, 'nothing to take off yet');
  assert.match(s.dialog().querySelector('h3').textContent, /2 takes/);
});
