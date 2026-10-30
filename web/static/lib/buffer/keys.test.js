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
    addEventListener: () => { throw new Error('on the root element, not the document'); },
    listeners,
  };
}
// A stand-in element: `closest` answers for the selectors it's inside, as
// the page's own element would (▶ is #np-play, which no exemption names).
const el = (tag, { type = '', inside = '', id = '' } = {}) => {
  const self = {
    tagName: tag.toUpperCase(), type, id, isContentEditable: false,
    closest: (sel) => {
      const parts = sel.split(', ');
      if (inside && parts.includes(inside)) return self;
      if (parts.includes(tag)) return self;
      if (tag === 'button' && !id && parts.includes('button:not(#np-play)')) return self;
      return null;
    },
  };
  return self;
};

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
  // ↵ on a focused button is the button's -- a toast's Undo, Loop -- and a
  // link's, a menu item's; on the page, or on ▶ still focused from a click
  // (where it would stop the tape mid-jam), it's the buffer's DROP.
  assert.equal(blocked({ code: 'Enter', target: el('a', { inside: 'a[href]' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button', { inside: '.buffer-panel' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button', { inside: '[role="menuitem"]' }) }, doc), true);
  assert.equal(blocked({ code: 'Enter', target: el('button', { inside: 'button:not(#np-play)' }) }, doc), true, 'the toast’s Undo, Loop');
  assert.equal(blocked({ code: 'Enter', target: el('button', { id: 'np-play' }) }, doc), false, '▶');
  assert.equal(blocked({ code: 'Enter', target: el('body') }, doc), false);
});

test('bound, a key it takes stops there, ahead of the tape page’s, and one it doesn’t goes on', () => {
  const doc = fakeDoc();
  const ran = [];
  let open = true;
  const unbind = bindBufferKeys(doc, { state: () => ({ open, held: false }), run: (a) => ran.push(a) });
  const l = doc.listeners.find((x) => x.type === 'keydown');
  assert.equal(l.capture, true, 'in the capture phase on the root, before the page’s K (the click) and ⌫ (remove)');
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

test('a clicked button gives ↵ to DROP; one reached by Tab keeps it', () => {
  // Chrome focuses a button that's clicked: arm track 2 with its ●, press ↵
  // for DROP ON TRACK 2, and the ↵ went to the ● -- the track disarmed and
  // nothing dropped. Only a button the keyboard brought the focus to keeps
  // its own ↵ (a toast's Undo, reached by Tab, undoes).
  const doc = fakeDoc();
  const ran = [];
  bindBufferKeys(doc, { state: () => ({ open: true, held: true }), run: (a) => ran.push(a) });
  const on = (type) => doc.listeners.filter((x) => x.type === type);
  const fire = (type, e) => { for (const l of on(type)) l.fn(e); return e; };
  const press = (code, target) => {
    const e = { ...key(code), target, stopped: false };
    e.stopPropagation = () => { e.stopped = true; };
    e.preventDefault = () => {};
    return fire('keydown', e);
  };
  const arm = el('button', { inside: 'button:not(#play)' });
  fire('pointerdown', { target: arm });
  fire('focusin', { target: arm });
  const clicked = press('Enter', arm);
  assert.deepEqual(ran, ['drop'], 'the clicked ● gives ↵ to DROP');
  assert.equal(clicked.stopped, true);

  const undo = el('button', { inside: 'button:not(#play)' });
  press('Tab', arm);
  fire('focusin', { target: undo });
  const tabbed = press('Enter', undo);
  assert.deepEqual(ran, ['drop'], 'the Undo reached by Tab undoes');
  assert.equal(tabbed.stopped, false);

  // A link, a menu's item, a sheet: ↵ is theirs however they got the focus.
  const link = el('a', { inside: 'a[href]' });
  fire('pointerdown', { target: link });
  fire('focusin', { target: link });
  press('Enter', link);
  assert.deepEqual(ran, ['drop']);
});

// A cue clip's pad is a key like a button: ↵ launches it only when the
// keyboard went to it. Held with a mouse to open its drawer (which focuses
// it), ↵ is the drawer's DROP: it once launched the pad instead.
test('↵ on a cue pad is the pad’s only when the keyboard went to it', () => {
  const doc = fakeDoc();
  const pad = { tagName: 'DIV', type: '', id: '', isContentEditable: false, closest: (sel) => (sel.split(', ').includes('.cue-pad') ? pad : null) };
  assert.equal(blocked({ code: 'Enter', target: pad }, doc, () => true), true, 'tabbed to: ↵ launches it');
  assert.equal(blocked({ code: 'Enter', target: pad }, doc, () => false), false, 'pressed with a mouse: ↵ drops');
});
