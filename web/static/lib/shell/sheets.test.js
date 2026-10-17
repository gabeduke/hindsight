// web/static/lib/shell/sheets.test.js
// The Capture view recorded from a phone through #phone-sheet, which shell.html
// only carries inside studio-sheets-tpl: with no Studio mounted first, the
// sheet was not in the document and initPhone threw on its null Close button.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureSheets } from './sheets.js';

// A document with a body and one template, enough for getElementById.
function fakeDoc(templateNodes, bodyIds = []) {
  const live = new Map(bodyIds.map((id) => [id, { id }]));
  const body = { append: (n) => live.set(n.id, n) };
  const content = { cloneNode: () => ({ children: templateNodes.map((n) => ({ ...n })) }) };
  return {
    body,
    live,
    getElementById: (id) => (id === 'tpl' ? { content } : live.get(id) ?? null),
  };
}

test('a sheet that only the template carries is put in the document', () => {
  const doc = fakeDoc([{ id: 'phone-sheet' }, { id: 'rb-flag-sheet' }]);
  assert.equal(doc.getElementById('phone-sheet'), null);
  assert.equal(ensureSheets(doc, 'tpl'), true);
  assert.ok(doc.getElementById('phone-sheet'));
  assert.ok(doc.getElementById('rb-flag-sheet'));
});

test('a sheet already in the document is not added twice', () => {
  const mine = { id: 'phone-sheet' };
  const doc = fakeDoc([{ id: 'phone-sheet' }]);
  doc.live.set('phone-sheet', mine);
  ensureSheets(doc, 'tpl');
  assert.equal(doc.getElementById('phone-sheet'), mine);
});

test('a page without the template says so and adds nothing', () => {
  const doc = fakeDoc([]);
  doc.getElementById = () => null;
  assert.equal(ensureSheets(doc, 'tpl'), false);
});

test('Capture puts the sheets in the document before it starts the phone', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  const ensure = app.indexOf("ensureSheets(document, 'studio-sheets-tpl')");
  const phone = app.indexOf('initPhone({');
  assert.ok(ensure > 0 && ensure < phone, 'app.js must call ensureSheets before initPhone');
});

test('Capture hands ctx.every a function first, then the interval', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.ok(!/ctx\.every\(\s*\d/.test(app), 'ctx.every(fn, ms): a number first throws "every needs a function"');
});
