import test from 'node:test';
import assert from 'node:assert/strict';
import { bindStudioKeys } from './keys.js';

// A stand-in document: listeners on its root element, and what it dispatches.
function fakeDoc({ dialogs = [] } = {}) {
  const listeners = [];
  const sent = [];
  return {
    documentElement: {
      addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
      removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    },
    querySelectorAll: (sel) => (sel === 'dialog[open]' ? dialogs : []),
    dispatchEvent: (e) => sent.push(e.detail.verb),
    key(code, more = {}) {
      let stopped = false;
      const e = { code, target: { tagName: 'BODY', closest: () => null }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, ...more };
      for (const l of listeners) l.fn(e);
      return stopped;
    },
    listeners,
    sent,
  };
}

test('with the rooms on, C catches and K keeps: the Studio’s verbs, while the page has the keys', () => {
  const doc = fakeDoc();
  bindStudioKeys(doc);
  assert.equal(doc.listeners[0].capture, true, 'ahead of the tape page’s own listener');
  assert.equal(doc.key('KeyC'), true);
  assert.equal(doc.key('KeyK'), true, 'K is KEEP now: the tape page never sees it as the click');
  assert.deepEqual(doc.sent, ['catch', 'keep']);
  // M is the click's, and the tape page's to press.
  assert.equal(doc.key('KeyM'), false);
  assert.deepEqual(doc.sent, ['catch', 'keep']);
});

test('not while typing, under a sheet, repeating, or when the buffer already took K', () => {
  const doc = fakeDoc();
  bindStudioKeys(doc);
  doc.key('KeyK', { target: { tagName: 'INPUT', type: 'text', closest: () => null } });
  doc.key('KeyK', { repeat: true });
  doc.key('KeyK', { defaultPrevented: true });
  doc.key('KeyC', { metaKey: true });
  assert.deepEqual(doc.sent, []);
  const sheet = fakeDoc({ dialogs: [{ classList: { contains: () => false } }] });
  bindStudioKeys(sheet);
  sheet.key('KeyC');
  assert.deepEqual(sheet.sent, []);
});
