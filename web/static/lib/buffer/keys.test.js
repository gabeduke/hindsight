import test from 'node:test';
import assert from 'node:assert/strict';
import { BUFFER_KEYS, keyAction, typingInto, blocked, bindBufferKeys } from './keys.js';

const key = (code, more = {}) => ({ code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...more });

test('G grabs whenever the Studio is up; the rest only while the buffer is open', () => {
  assert.equal(keyAction(key('KeyG')), 'grab');
  for (const code of ['BracketLeft', 'BracketRight', 'KeyK', 'Backspace', 'Enter']) {
    assert.equal(keyAction(key(code), { open: false }), null, `${code} with the buffer shut`);
  }
  assert.equal(keyAction(key('BracketLeft'), { open: true }), 'in-back');
  assert.equal(keyAction(key('BracketRight'), { open: true }), 'in-on');
  assert.equal(keyAction(key('BracketLeft', { shiftKey: true }), { open: true }), 'out-back');
  assert.equal(keyAction(key('BracketRight', { shiftKey: true }), { open: true }), 'out-on');
  assert.equal(keyAction(key('KeyK'), { open: true }), 'keep');
  assert.equal(keyAction(key('Backspace'), { open: true }), 'toss');
  assert.equal(keyAction(key('Enter'), { open: true }), 'drop');
});

test('↵ drops again just after a drop, while the clipboard still holds it', () => {
  assert.equal(keyAction(key('Enter'), { open: false, held: true }), 'drop');
  // But K and ⌫ aren't the buffer's once it's closed: the click, and removing clips.
  assert.equal(keyAction(key('KeyK'), { open: false, held: true }), null);
  assert.equal(keyAction(key('Backspace'), { open: false, held: true }), null);
});

test('a modifier is the browser’s, and a held key only steps the edges on', () => {
  assert.equal(keyAction(key('KeyG', { metaKey: true })), null);
  assert.equal(keyAction(key('KeyK', { ctrlKey: true }), { open: true }), null);
  assert.equal(keyAction(key('KeyG', { repeat: true })), null);
  assert.equal(keyAction(key('Enter', { repeat: true }), { open: true }), null);
  assert.equal(keyAction(key('BracketLeft', { repeat: true }), { open: true }), 'in-back');
});

test('the table is one action per key and shift', () => {
  const seen = new Set();
  for (const k of BUFFER_KEYS) {
    const id = `${k.code}${k.shift ? '+shift' : ''}`;
    assert.ok(!seen.has(id), `${id} twice`);
    seen.add(id);
    assert.ok(['studio', 'open', 'held'].includes(k.when));
  }
});

// A stand-in document: its open dialogs, and listeners on its root element.
function fakeDoc({ dialogs = [] } = {}) {
  const listeners = [];
  return {
    documentElement: {
      addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
      removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    },
    querySelectorAll: (sel) => (sel === 'dialog[open]' ? dialogs : []),
    addEventListener: () => { throw new Error('on the document, Play mode’s keys come after these, not before'); },
    listeners,
  };
}
const el = (tag, { type = '', inside = '' } = {}) => ({
  tagName: tag.toUpperCase(), type, isContentEditable: false,
  closest: (sel) => (inside && sel.includes(inside) ? {} : sel.split(', ').some((s) => s === tag) ? {} : null),
});

test('never while typing in a field, or under a sheet', () => {
  assert.equal(typingInto(el('input', { type: 'text' })), true);
  assert.equal(typingInto(el('textarea')), true);
  assert.equal(typingInto(el('input', { type: 'range' })), false);
  assert.equal(typingInto({ isContentEditable: true }), true);
  const doc = fakeDoc();
  assert.equal(blocked({ code: 'KeyG', target: el('input', { type: 'search' }) }, doc), true);
  assert.equal(blocked({ code: 'KeyG', target: el('div') }, doc), false);
  const sheet = { classList: { contains: () => false } };
  const inspector = { classList: { contains: (c) => c === 'inspector' } };
  assert.equal(blocked({ code: 'KeyG', target: el('div') }, fakeDoc({ dialogs: [sheet] })), true);
  assert.equal(blocked({ code: 'KeyG', target: el('div') }, fakeDoc({ dialogs: [inspector] })), false);
  assert.equal(blocked({ code: 'KeyG', target: el('div', { inside: 'dialog.inspector' }) }, doc), true);
  // ↵ on a link, a menu item or the buffer's own keys is theirs; on the page,
  // or on ▶ still focused from a click, it's the buffer's DROP.
  assert.equal(blocked({ code: 'Enter', target: el('a', { inside: 'a[href]' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button', { inside: '.buffer-panel' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button', { inside: '[role="menuitem"]' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button') }, doc), false);
  assert.equal(blocked({ code: 'Enter', target: el('body') }, doc), false);
});

test('bound, a key it takes stops there, ahead of the tape page’s, and one it doesn’t goes on', () => {
  const doc = fakeDoc();
  const ran = [];
  let open = true;
  const unbind = bindBufferKeys(doc, { state: () => ({ open, held: false }), run: (a) => ran.push(a) });
  const l = doc.listeners.find((x) => x.type === 'keydown');
  assert.equal(l.capture, true, 'in the capture phase on the root, before the page’s K (the click) and ⌫ (remove), after Play mode’s');
  const press = (code, more) => {
    const e = { ...key(code, more), target: el('body'), stopped: false, prevented: false };
    e.stopPropagation = () => { e.stopped = true; };
    e.preventDefault = () => { e.prevented = true; };
    l.fn(e);
    return e;
  };
  const k = press('KeyK');
  assert.deepEqual(ran, ['keep']);
  assert.equal(k.stopped && k.prevented, true);
  open = false;
  const click = press('KeyK');
  assert.equal(click.stopped, false, 'with the buffer shut, K is the tape page’s click');
  assert.deepEqual(ran, ['keep']);
  const typed = press('KeyG', {});
  assert.deepEqual(ran, ['keep', 'grab']);
  assert.equal(typed.stopped, true);
  unbind();
  assert.equal(doc.listeners.length, 0);
});
