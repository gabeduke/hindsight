import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { keyMenu } from './keymenu.js';

function pair() {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, `
    <span id="pair"><button id="key">KEEP</button><button id="more">▾</button></span>
    <div id="pop" hidden><button id="a">30s</button><button id="b">2m</button></div>
    <button id="elsewhere">x</button>`).nodes);
  const $ = (id) => doc.getElementById(id);
  const win = { innerWidth: 1024, listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); } };
  const menu = keyMenu($('more'), $('pop'), { anchor: $('pair'), doc, win });
  const press = (el) => { for (const f of win.listeners.pointerdown || []) f({ target: el }); };
  const click = (el) => {
    el.dispatchEvent({ type: 'click', target: el });
    $('pair').dispatchEvent({ type: 'click', target: el }); // the pair hears it on its way up
  };
  return { doc, $, menu, press, click };
}

test('the ▾ opens the panel and shuts it again; the key says it has a panel', () => {
  const { $, menu, click } = pair();
  const more = $('more');
  assert.equal(more.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(more.getAttribute('aria-controls'), 'pop');
  click(more);
  assert.ok(menu.isOpen());
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  click(more);
  assert.ok(!menu.isOpen());
  assert.equal(more.getAttribute('aria-expanded'), 'false');
});

test('a press on the verb, elsewhere, or Escape shuts it; a press inside leaves it', () => {
  const { doc, $, menu, press, click } = pair();
  click($('more'));
  press($('a'));
  assert.ok(menu.isOpen(), 'a choice in the panel leaves it open, for the next');
  click($('key'));
  assert.ok(!menu.isOpen(), 'the verb goes with what is chosen, and the panel shuts');

  click($('more'));
  press($('elsewhere'));
  assert.ok(!menu.isOpen());

  click($('more'));
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.ok(!menu.isOpen());
});

test('↓ on the ▾ opens it with the focus on its first choice', () => {
  const { doc, $, menu } = pair();
  $('more').dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {} });
  assert.ok(menu.isOpen());
  assert.equal(doc.activeElement, $('a'));
});
